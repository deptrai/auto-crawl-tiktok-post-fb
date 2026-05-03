from __future__ import annotations
import logging
import os
import socket
import traceback
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.models import Campaign, CampaignStatus, FacebookPage, Video, VideoStatus, TaskQueue, TaskStatus, VideoPost, PlatformType
from app.services.ai_generator import generate_caption
from app.services.publishers.facebook import FacebookPublisher
from app.services.publishers.youtube import YouTubePublisher
from app.models.models import YouTubeChannel
from app.services.observability import record_event, update_worker_heartbeat
from app.services.security import decrypt_secret
from app.services.storage_backend import get_storage
from app.worker.tasks import process_task_queue
from app.services.token_lifecycle import (
    check_all_tokens,
    refresh_long_lived_token,
    HEALTH_EXPIRED,
    HEALTH_INVALID,
    HEALTH_EXPIRING_SOON,
)

scheduler = BackgroundScheduler()
WORKER_NAME = f"{settings.APP_ROLE}@{socket.gethostname()}"


def auto_post_job():
    db: Session = SessionLocal()
    update_worker_heartbeat(WORKER_NAME, app_role=settings.APP_ROLE, status="quét lịch đăng", db=db)
    storage = get_storage()
    try:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        
        # Get active auto_post campaigns
        campaigns = db.query(Campaign).filter(
            Campaign.status == CampaignStatus.active,
            Campaign.auto_post == True
        ).all()

        for campaign in campaigns:
            # Story 12.3: Support multiple platforms
            target_platforms = campaign.target_platforms or []
            if not target_platforms and campaign.target_platform: # Fallback to legacy
                target_platforms = [campaign.target_platform]
            
            if not target_platforms:
                continue

            # Find videos ready to post that haven't finished all platforms
            # For simplicity, we find videos with status=ready or in_progress (partially posted)
            videos = (
                db.query(Video)
                .filter(
                    Video.campaign_id == campaign.id,
                    Video.status.in_([VideoStatus.ready, VideoStatus.posted]), # posted if partially done
                    Video.publish_time <= now,
                )
                .order_by(Video.publish_time.asc())
                .limit(5) # Process small batches
                .all()
            )

            for vid in videos:
                # Check which platforms still need posting
                for platform in target_platforms:
                    if hasattr(platform, "value"): platform = platform.value
                    
                    # Check if already posted or failed max retries
                    post_record = db.query(VideoPost).filter_by(video_id=vid.id, platform=platform).first()
                    if post_record and post_record.status == VideoStatus.posted:
                        continue
                    
                    if not post_record:
                        post_record = VideoPost(video_id=vid.id, platform=platform, status=VideoStatus.pending)
                        db.add(post_record)
                        db.commit()

                    update_worker_heartbeat(
                        WORKER_NAME,
                        app_role=settings.APP_ROLE,
                        status=f"đang đăng {platform}",
                        current_task_type="auto_post",
                        current_task_id=str(vid.id),
                        details={"campaign_id": str(campaign.id), "video_id": str(vid.id), "platform": platform},
                        db=db,
                    )

                    # Get credentials for this platform
                    access_token = None
                    refresh_token = None
                    target_id = (campaign.platform_targets or {}).get(platform)
                    if not target_id and platform == "facebook": target_id = campaign.target_page_id # Fallback
                    
                    brand_voice = None
                    brand_voice_preset = "casual"
                    client_id = None
                    client_secret = None

                    if platform == "youtube":
                        channel = db.query(YouTubeChannel).filter(YouTubeChannel.channel_id == target_id).first()
                        if not channel:
                            post_record.status = VideoStatus.failed
                            post_record.last_error = "YouTube Channel chưa được cấu hình."
                            db.commit()
                            continue
                        access_token = channel.access_token
                        refresh_token = channel.refresh_token
                        client_id = os.environ.get("GOOGLE_CLIENT_ID")
                        client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
                    elif platform in ["facebook", "instagram"]:
                        page = db.query(FacebookPage).filter(FacebookPage.page_id == target_id).first()
                        if not page:
                            post_record.status = VideoStatus.failed
                            post_record.last_error = f"Trang Facebook {target_id} chưa được cấu hình."
                            db.commit()
                            continue
                        try:
                            access_token = decrypt_secret(page.long_lived_access_token)
                        except ValueError as exc:
                            post_record.status = VideoStatus.failed
                            post_record.last_error = str(exc)
                            db.commit()
                            continue
                        brand_voice = page.brand_voice
                        brand_voice_preset = page.brand_voice_preset
                    
                    if not access_token:
                        post_record.status = VideoStatus.failed
                        post_record.last_error = "Chưa có mã truy cập hợp lệ."
                        db.commit()
                        continue

                    # Generate caption if missing
                    if not vid.ai_caption:
                        try:
                            vid.ai_caption = generate_caption(
                                vid.original_caption,
                                brand_voice=brand_voice,
                                brand_voice_preset=brand_voice_preset,
                                target_language=campaign.caption_language or "auto",
                                optimize_hashtags=campaign.hashtag_optimization or False
                            )
                            db.commit()
                        except Exception as exc:
                            post_record.status = VideoStatus.failed
                            post_record.last_error = f"Không thể tạo chú thích AI: {exc}"
                            db.commit()
                            continue

                    # File copy and upload logic
                    try:
                        file_exists = bool(vid.file_path) and storage.exists(vid.file_path)
                        if not file_exists:
                            post_record.status = VideoStatus.failed
                            post_record.last_error = "Tệp video không tồn tại."
                            db.commit()
                            continue

                        local_path = storage.get_local_copy(vid.file_path)
                        is_temp_copy = storage.requires_temp_copy()
                        
                        try:
                            res = {"error": "Unknown platform"}
                            if platform == "youtube":
                                res = YouTubePublisher().upload_video(
                                    file_path=local_path, caption=vid.ai_caption,
                                    account_id=target_id, access_token=access_token,
                                    refresh_token=refresh_token, client_id=client_id, client_secret=client_secret
                                )
                            elif platform == "instagram":
                                public_url = storage.get_public_url(vid.file_path)
                                res = InstagramPublisher().upload_video(
                                    file_path=local_path, video_url=public_url,
                                    caption=vid.ai_caption, account_id=target_id, access_token=access_token
                                )
                            elif platform == "facebook":
                                res = FacebookPublisher().upload_video(
                                    file_path=local_path, caption=vid.ai_caption,
                                    account_id=target_id, access_token=access_token
                                )

                            if "id" in res:
                                post_record.external_id = res["id"]
                                post_record.status = VideoStatus.posted
                                post_record.last_error = None
                                db.commit()
                                record_event("video", "info", f"Đăng {platform} thành công.", db=db, details={"video_id": str(vid.id), "post_id": res["id"]})
                            else:
                                post_record.status = VideoStatus.failed
                                post_record.last_error = str(res.get("error", res))
                                db.commit()
                        finally:
                            if is_temp_copy and local_path and os.path.exists(local_path):
                                os.remove(local_path)
                    except Exception as upload_exc:
                        post_record.status = VideoStatus.failed
                        post_record.last_error = str(upload_exc)
                        db.commit()

                # Final check: if all target platforms are 'posted', set video status to 'posted' and cleanup
                target_platform_count = len(target_platforms)
                posted_count = db.query(VideoPost).filter_by(video_id=vid.id, status=VideoStatus.posted).count()
                
                if posted_count >= target_platform_count:
                    vid.status = VideoStatus.posted
                    # Cleanup storage
                    try:
                        storage.delete(vid.file_path)
                        vid.file_path = None
                    except: pass
                    db.commit()

    except Exception as exc:
        record_event("worker", "error", "Tác vụ quét lịch đăng gặp lỗi.", db=db, details={"error": str(exc), "traceback": traceback.format_exc()})
    finally:
        update_worker_heartbeat(WORKER_NAME, app_role=settings.APP_ROLE, status="idle", db=db)
        db.close()


_RETRY_TASK_TYPES = ("retry_video_download",)

_CLEANUP_BATCH_SIZE = 100


def _cleanup_one(db: Session, storage, video: Video) -> bool:
    """Xóa file của 1 video qua storage. Trả True nếu file_path nên được clear.

    Phân biệt:
    - delete trả True → xóa thành công, clear DB ref.
    - delete trả False (file đã không còn / lỗi đã log) → vẫn clear DB ref vì
      mục tiêu cleanup là DB-storage consistent; file thực tế không tồn tại
      nên giữ path là vô nghĩa.
    - delete raise → giữ DB ref, lần cleanup sau sẽ retry.
    """
    try:
        storage.delete(video.file_path)
        return True
    except Exception as exc:
        logger.warning("storage_cleanup_job: lỗi khi xóa %s: %s", video.file_path, exc)
        return False


def storage_cleanup_job():
    db: Session = SessionLocal()
    storage = get_storage()
    cleaned_posted = 0
    cleaned_failed = 0

    try:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        cutoff = now - timedelta(hours=24)

        # 1. Dọn dẹp video đã posted > 24h. ORDER BY publish_time ASC để đảm bảo
        # video cũ nhất được xử lý trước (tránh starve khi backlog lớn).
        # Filter publish_time NULLS-LAST: NULL coi như đủ tuổi (cleanup được).
        from sqlalchemy import or_

        posted_videos = (
            db.query(Video)
            .filter(
                Video.status == VideoStatus.posted,
                Video.file_path.isnot(None),
                Video.file_path != "",
                or_(Video.publish_time < cutoff, Video.publish_time.is_(None)),
            )
            .order_by(Video.publish_time.asc().nullsfirst())
            .limit(_CLEANUP_BATCH_SIZE)
            .all()
        )

        for video in posted_videos:
            # Skip nếu đang có active retry task cho chính video này.
            active_task = (
                db.query(TaskQueue)
                .filter(
                    TaskQueue.entity_id == str(video.id),
                    TaskQueue.task_type.in_(_RETRY_TASK_TYPES),
                    TaskQueue.status.in_([TaskStatus.queued, TaskStatus.processing]),
                )
                .first()
            )
            if active_task:
                logger.debug("Skip dọn dẹp video %s — đang trong retry queue.", video.id)
                continue

            if _cleanup_one(db, storage, video):
                video.file_path = None
                cleaned_posted += 1

        # Commit nhóm posted trước khi sang nhóm failed — tránh exception
        # ở nhóm failed làm rollback luôn nhóm posted (orphan ngược).
        try:
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.error("storage_cleanup_job: commit nhóm posted thất bại: %s", exc)
            raise

        # 2. Dọn dẹp video failed lâu ngày (nếu cấu hình).
        if settings.CLEANUP_FAILED_VIDEO_DAYS > 0:
            failed_cutoff = now - timedelta(days=settings.CLEANUP_FAILED_VIDEO_DAYS)
            failed_videos = (
                db.query(Video)
                .filter(
                    Video.status == VideoStatus.failed,
                    Video.file_path.isnot(None),
                    Video.file_path != "",
                    Video.updated_at < failed_cutoff,
                )
                .order_by(Video.updated_at.asc())
                .limit(_CLEANUP_BATCH_SIZE)
                .all()
            )
            for video in failed_videos:
                if _cleanup_one(db, storage, video):
                    video.file_path = None
                    cleaned_failed += 1

            try:
                db.commit()
            except Exception as exc:
                db.rollback()
                logger.error("storage_cleanup_job: commit nhóm failed thất bại: %s", exc)

        cleaned_count = cleaned_posted + cleaned_failed
        # Debug log mỗi lần chạy (không tạo DB event nếu 0 — tránh spam).
        logger.info(
            "storage_cleanup_job hoàn tất: cleaned_posted=%s cleaned_failed=%s",
            cleaned_posted, cleaned_failed,
        )

        if cleaned_count > 0:
            record_event(
                "cleanup",
                "info",
                f"Đã dọn dẹp {cleaned_count} file video.",
                db=db,
                details={
                    "cleaned_count": cleaned_count,
                    "cleaned_posted": cleaned_posted,
                    "cleaned_failed": cleaned_failed,
                },
            )

    except Exception as exc:
        try:
            db.rollback()
        except Exception:
            pass
        record_event(
            "cleanup",
            "error",
            "Tác vụ dọn dẹp file gặp lỗi.",
            db=db,
            details={"error": str(exc), "traceback": traceback.format_exc()},
        )
    finally:
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
    # L3: Bọc try/except để tránh APScheduler unschedule job khi DB lỗi tạm thời
    try:
        update_worker_heartbeat(WORKER_NAME, app_role=settings.APP_ROLE, status="idle")
    except Exception as exc:
        logger.warning(f"Heartbeat job gặp lỗi: {exc}")


def token_health_check_job():
    db: Session = SessionLocal()
    update_worker_heartbeat(WORKER_NAME, app_role=settings.APP_ROLE, status="kiểm tra token health", db=db)
    try:
        # AC5 (Story 7.3): use check_all_tokens() for smart event logging —
        # only writes events when status changes, preventing 24h spam.
        results = check_all_tokens(db)
        for res in results:
            page = db.query(FacebookPage).filter_by(page_id=res.page_id).first()
            if not page:
                continue
            if res.health_status in [HEALTH_EXPIRED, HEALTH_INVALID]:
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
            elif res.health_status == HEALTH_EXPIRING_SOON:
                days_left = res.days_remaining if res.days_remaining is not None else 0
                if page.auto_refresh_enabled and days_left <= settings.TOKEN_REFRESH_DAYS_BEFORE:
                    refresh_result = refresh_long_lived_token(page.page_id, db)
                    if not refresh_result.success:
                        record_event(
                            "token", "warning",
                            f"Token sắp hết hạn (còn {days_left} ngày), auto-refresh thất bại: {refresh_result.message}",
                            db=db,
                            details={"page_id": page.page_id, "token_type": res.token_type, "days_remaining": days_left}
                        )
                    # Refresh thành công: refresh_long_lived_token đã ghi event info rồi
                else:
                    record_event(
                        "token", "warning", f"Token sắp hết hạn (còn {days_left} ngày).",
                        db=db, details={"page_id": page.page_id, "token_type": res.token_type, "days_remaining": days_left}
                    )
    except Exception as exc:
        # M4: Rollback để tránh PendingRollbackError trên session sau khi exception
        db.rollback()
        record_event("worker", "error", "Lỗi khi kiểm tra token health.", db=db, details={"error": str(exc)})
    finally:
        update_worker_heartbeat(WORKER_NAME, app_role=settings.APP_ROLE, status="idle", db=db)
        db.close()


def metrics_job():
    db: Session = SessionLocal()
    update_worker_heartbeat(WORKER_NAME, app_role=settings.APP_ROLE, status="thu thập metrics", db=db)
    
    try:
        collect_metrics_job(db)
    except Exception as exc:
        logger.error(f"Lỗi trong metrics_job: {exc}")
        logger.error(traceback.format_exc())
        db.rollback()
        record_event(
            "system",
            "error",
            "Lỗi khi thu thập engagement metrics.",
            db=db,
            details={"error": str(exc)[:500], "traceback": traceback.format_exc()[:1000]}
        )
        db.commit()
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
    if not scheduler.get_job("storage_cleanup_job"):
        scheduler.add_job(
            storage_cleanup_job,
            "interval",
            hours=6,
            id="storage_cleanup_job",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
            # First run sau 10 phút từ lúc khởi động
            next_run_time=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=10)
        )
    if not scheduler.get_job("metrics_job"):
        # Jitter ±5 phút để tránh thundering herd khi multi-pod start cùng lúc.
        import random as _random
        jitter_seconds = _random.randint(-300, 300)
        scheduler.add_job(
            metrics_job,
            "interval",
            hours=6,
            id="metrics_job",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
            jitter=300,  # APScheduler built-in: ±300s ngẫu nhiên cho mỗi lần fire
            next_run_time=datetime.now(timezone.utc).replace(tzinfo=None)
            + timedelta(minutes=15, seconds=jitter_seconds),
        )
    if not scheduler.running:
        scheduler.start()
