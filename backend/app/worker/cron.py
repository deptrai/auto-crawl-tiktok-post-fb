from __future__ import annotations
import os
import socket
import traceback
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.models import Campaign, CampaignStatus, FacebookPage, Video, VideoStatus
from app.services.ai_generator import generate_caption
from app.services.fb_graph import upload_video_to_facebook
from app.services.observability import record_event, update_worker_heartbeat
from app.services.security import decrypt_secret
from app.worker.tasks import process_task_queue
from app.services.token_lifecycle import check_token_health, refresh_long_lived_token

scheduler = BackgroundScheduler()
WORKER_NAME = f"{settings.APP_ROLE}@{socket.gethostname()}"


def auto_post_job():
    db: Session = SessionLocal()
    update_worker_heartbeat(WORKER_NAME, app_role=settings.APP_ROLE, status="quét lịch đăng", db=db)
    try:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        pages = db.query(FacebookPage).all()

        for page in pages:
            vid = (
                db.query(Video)
                .join(Campaign)
                .filter(
                    Campaign.target_page_id == page.page_id,
                    Campaign.status == CampaignStatus.active,
                    Video.status == VideoStatus.ready,
                    Video.publish_time <= now,
                )
                .order_by(Video.publish_time.asc())
                .first()
            )

            if not vid or not vid.campaign.auto_post:
                continue

            update_worker_heartbeat(
                WORKER_NAME,
                app_role=settings.APP_ROLE,
                status="đang đăng video",
                current_task_type="auto_post",
                current_task_id=str(vid.id),
                details={"page_id": page.page_id, "video_id": str(vid.id)},
                db=db,
            )

            try:
                access_token = decrypt_secret(page.long_lived_access_token)
            except ValueError as exc:
                vid.status = VideoStatus.failed
                vid.last_error = str(exc)
                vid.retry_count = (vid.retry_count or 0) + 1
                db.commit()
                continue

            if not access_token:
                vid.status = VideoStatus.failed
                vid.last_error = "Trang Facebook chưa có mã truy cập hợp lệ."
                vid.retry_count = (vid.retry_count or 0) + 1
                db.commit()
                continue

            if not vid.ai_caption:
                try:
                    vid.ai_caption = generate_caption(vid.original_caption)
                    db.commit()
                except Exception as exc:
                    vid.status = VideoStatus.failed
                    vid.last_error = f"Không thể tạo chú thích AI: {exc}"
                    vid.retry_count = (vid.retry_count or 0) + 1
                    db.commit()
                    record_event(
                        "video",
                        "error",
                        "Tạo chú thích AI trước khi đăng thất bại.",
                        db=db,
                        details={"video_id": str(vid.id), "page_id": page.page_id, "error": str(exc)},
                    )
                    continue

            if not vid.file_path or not os.path.exists(vid.file_path):
                vid.status = VideoStatus.failed
                vid.last_error = "Tệp video không tồn tại hoặc đã bị xóa."
                vid.retry_count = (vid.retry_count or 0) + 1
                db.commit()
                record_event(
                    "video",
                    "warning",
                    "Bỏ qua video do tệp không tồn tại.",
                    db=db,
                    details={"video_id": str(vid.id), "file_path": vid.file_path},
                )
                continue

            res = upload_video_to_facebook(
                file_path=vid.file_path,
                caption=vid.ai_caption,
                page_id=page.page_id,
                access_token=access_token,
            )

            if "id" in res:
                vid.fb_post_id = res["id"]
                vid.status = VideoStatus.posted
                vid.last_error = None
                record_event(
                    "video",
                    "info",
                    "Đã đăng video thành công.",
                    db=db,
                    details={"video_id": str(vid.id), "page_id": page.page_id, "fb_post_id": vid.fb_post_id},
                )
                if vid.file_path and os.path.exists(vid.file_path):
                    try:
                        os.remove(vid.file_path)
                    except Exception as exc:
                        record_event(
                            "video",
                            "warning",
                            "Không thể xóa tệp tạm sau khi đăng.",
                            db=db,
                            details={"video_id": str(vid.id), "file_path": vid.file_path, "error": str(exc)},
                        )
            else:
                vid.status = VideoStatus.failed
                vid.last_error = str(res.get("error", res))
                vid.retry_count = (vid.retry_count or 0) + 1
                record_event(
                    "video",
                    "error",
                    "Đăng video lên Facebook thất bại.",
                    db=db,
                    details={"video_id": str(vid.id), "page_id": page.page_id, "response": res},
                )

            db.commit()
    except Exception as exc:
        record_event(
            "worker",
            "error",
            "Tác vụ quét lịch đăng gặp lỗi.",
            db=db,
            details={"error": str(exc), "traceback": traceback.format_exc()},
        )
    finally:
        update_worker_heartbeat(WORKER_NAME, app_role=settings.APP_ROLE, status="idle", db=db)
        db.close()


def process_task_queue_job():
    processed = process_task_queue(WORKER_NAME)
    if processed:
        record_event(
            "queue",
            "info",
            "Đã xử lý xong một đợt tác vụ nền.",
            details={"worker_name": WORKER_NAME, "processed": processed},
        )


def heartbeat_job():
    update_worker_heartbeat(WORKER_NAME, app_role=settings.APP_ROLE, status="idle")


def token_health_check_job():
    db: Session = SessionLocal()
    update_worker_heartbeat(WORKER_NAME, app_role=settings.APP_ROLE, status="kiểm tra token health", db=db)
    try:
        pages = db.query(FacebookPage).filter(FacebookPage.long_lived_access_token.isnot(None)).all()
        for page in pages:
            res = check_token_health(page.page_id, db)
            if not res:
                continue
            if res.health_status in ["expired", "invalid"]:
                campaigns = db.query(Campaign).filter(
                    Campaign.target_page_id == page.page_id,
                    Campaign.status == CampaignStatus.active
                ).all()
                for c in campaigns:
                    c.status = CampaignStatus.paused
                    record_event(
                        "campaign", "warning", f"Tự động tạm dừng chiến dịch do token {res.health_status}.",
                        db=db, details={"campaign_id": str(c.id), "page_id": page.page_id}
                    )
                db.commit()
                record_event(
                    "token", "error", f"Token {res.health_status}.",
                    db=db, details={"page_id": page.page_id, "token_type": res.token_type, "scopes": res.scopes}
                )
            elif res.health_status == "expiring_soon":
                days_left = res.days_remaining if res.days_remaining is not None else 0
                if page.auto_refresh_enabled and days_left <= settings.TOKEN_REFRESH_DAYS_BEFORE:
                    # Tự động làm mới token
                    refresh_result = refresh_long_lived_token(page.page_id, db)
                    if not refresh_result.success:
                        # Refresh thất bại — chỉ ghi warning, KHÔNG pause campaign
                        record_event(
                            "token", "warning",
                            f"Token sắp hết hạn (còn {days_left} ngày), auto-refresh thất bại: {refresh_result.message}",
                            db=db,
                            details={"page_id": page.page_id, "token_type": res.token_type, "days_remaining": days_left}
                        )
                    # Nếu thành công thì refresh_long_lived_token đã ghi event info rồi
                else:
                    # auto_refresh_enabled = False hoặc chưa đến ngưỡng refresh
                    record_event(
                        "token", "warning", f"Token sắp hết hạn (còn {days_left} ngày).",
                        db=db, details={"page_id": page.page_id, "token_type": res.token_type, "days_remaining": days_left}
                    )
    except Exception as exc:
        record_event("worker", "error", "Lỗi khi kiểm tra token health.", db=db, details={"error": str(exc)})
    finally:
        update_worker_heartbeat(WORKER_NAME, app_role=settings.APP_ROLE, status="idle", db=db)
        db.close()


def start_scheduler():
    if not scheduler.get_job("auto_post_job"):
        scheduler.add_job(
            auto_post_job,
            "interval",
            id="auto_post_job",
            minutes=settings.SCHEDULER_INTERVAL_MINUTES,
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
    if not scheduler.get_job("process_task_queue_job"):
        scheduler.add_job(
            process_task_queue_job,
            "interval",
            id="process_task_queue_job",
            seconds=settings.TASK_QUEUE_POLL_SECONDS,
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
    if not scheduler.get_job("heartbeat_job"):
        scheduler.add_job(
            heartbeat_job,
            "interval",
            id="heartbeat_job",
            seconds=max(10, settings.TASK_QUEUE_POLL_SECONDS),
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
    if not scheduler.get_job("token_health_check_job"):
        scheduler.add_job(
            token_health_check_job,
            "interval",
            hours=settings.TOKEN_CHECK_INTERVAL_HOURS,
            id="token_health_check_job",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
            next_run_time=datetime.now(timezone.utc).replace(tzinfo=None)
        )
    if not scheduler.running:
        scheduler.start()
