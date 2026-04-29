from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
import uuid

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.models import Campaign, CampaignStatus, FacebookPage, InteractionLog, InteractionStatus, Video, VideoStatus
from app.services.ai_generator import generate_reply
from app.services.fb_graph import reply_to_comment
from app.services.observability import record_event
from app.services.security import decrypt_secret
from app.services.content_filter import CrossCampaignDedup, get_default_filters, run_filters
from app.services.tiktok_crawler import download_video, extract_metadata


def parse_uuid_or_none(raw_id: str):
    try:
        return uuid.UUID(raw_id)
    except ValueError:
        return None


def safe_remove_file(path: str | None):
    if path and os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass


def mark_video_failed(video: Video, message: str):
    video.status = VideoStatus.failed
    video.last_error = message[:1000]
    video.retry_count = (video.retry_count or 0) + 1


def set_campaign_sync_state(campaign: Campaign, status: str, error: str | None = None, finished_at: datetime | None = None):
    campaign.last_sync_status = status
    campaign.last_sync_error = error[:1000] if error else None
    if finished_at:
        campaign.last_synced_at = finished_at


def build_source_page_publish_time(db: Session, page_id: str | None, schedule_interval: int):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    start_time = now

    if page_id and schedule_interval > 0:
        last_publish = (
            db.query(func.max(Video.publish_time))
            .join(Campaign)
            .filter(
                Campaign.target_page_id == page_id,
                Campaign.status == CampaignStatus.active,
                Video.status == VideoStatus.ready,
            )
            .scalar()
        )
        if last_publish and last_publish > now:
            start_time = last_publish + timedelta(minutes=schedule_interval)
    return start_time


def retry_video_download(video_id: str) -> dict:
    db: Session = SessionLocal()
    video = None
    try:
        video_uuid = parse_uuid_or_none(video_id)
        if not video_uuid:
            raise ValueError("Mã video không hợp lệ.")

        video = db.query(Video).filter(Video.id == video_uuid).first()
        if not video:
            raise ValueError("Không tìm thấy video cần thử lại.")

        out_path, _ = download_video(video.source_video_url, "tiktok")
        if out_path:
            safe_remove_file(video.file_path)
            video.file_path = out_path
            video.status = VideoStatus.ready
            video.publish_time = datetime.now(timezone.utc).replace(tzinfo=None)
            video.last_error = None
            db.commit()
            record_event(
                "video",
                "info",
                "Đã tải lại video thành công.",
                db=db,
                details={"video_id": str(video.id), "original_id": video.original_id},
            )
            return {"ok": True, "video_id": str(video.id)}

        mark_video_failed(video, "Tải lại video thất bại.")
        db.commit()
        record_event(
            "video",
            "warning",
            "Tải lại video không thành công.",
            db=db,
            details={"video_id": str(video.id), "original_id": video.original_id},
        )
        return {"ok": False, "video_id": str(video.id)}
    except Exception as exc:
        if video:
            mark_video_failed(video, str(exc))
            db.commit()
        record_event(
            "video",
            "error",
            "Tiến trình thử tải lại video gặp lỗi.",
            db=db,
            details={"video_id": video_id, "error": str(exc)},
        )
        raise
    finally:
        db.close()


def sync_campaign_content(campaign_id: str, source_url: str, allow_paused: bool = False) -> dict:
    db: Session = SessionLocal()
    try:
        campaign_uuid = parse_uuid_or_none(campaign_id)
        if not campaign_uuid:
            raise ValueError("Mã chiến dịch không hợp lệ.")

        campaign = db.query(Campaign).filter(Campaign.id == campaign_uuid).first()
        if not campaign:
            raise ValueError("Không tìm thấy chiến dịch cần đồng bộ.")

        set_campaign_sync_state(campaign, "syncing")
        db.commit()
        record_event(
            "campaign",
            "info",
            "Bắt đầu đồng bộ chiến dịch.",
            db=db,
            details={"campaign_id": campaign_id, "campaign_name": campaign.name},
        )

        info = extract_metadata(source_url)
        entries = info.get("entries", [info]) if "entries" in info else [info]
        entries = list(reversed(entries))

        start_time = build_source_page_publish_time(
            db,
            campaign.target_page_id,
            campaign.schedule_interval or 0,
        )
        added_count = 0
        filtered_by_quality = 0
        filtered_by_keyword = 0
        filtered_by_dedup = 0
        interrupted_reason = None
        # Hoist filter chain outside loop — avoid re-instantiating per-iteration.
        # CrossCampaignDedup receives the DB session so it can query cross-campaign videos.
        content_filters = get_default_filters(db=db)

        for entry in entries:
            db.expire_all()
            campaign = db.query(Campaign).filter(Campaign.id == campaign_uuid).first()
            if not campaign:
                interrupted_reason = "Chiến dịch đã bị xóa trong lúc đồng bộ."
                break
            if campaign.status != CampaignStatus.active and not allow_paused:
                interrupted_reason = "Chiến dịch đã bị tạm dừng trong lúc đồng bộ."
                break

            video_url = entry.get("webpage_url", entry.get("url"))
            if not video_url:
                continue
            # Khi Apify trả về, dùng direct CDN URL để download thay vì TikTok URL
            download_url = entry.get("_apify_download_url") or video_url

            original_id = entry.get("id", str(uuid.uuid4()))
            existing_vid = (
                db.query(Video)
                .filter(Video.campaign_id == campaign_uuid, Video.original_id == original_id)
                .first()
            )
            if existing_vid:
                continue

            # Content filter pipeline — short-circuit before any download work.
            # Per-entry log in run_filters (logger.info). KHÔNG ghi event per video.
            # Only summary at end of sync (anti-pattern: event per video).
            filter_result = run_filters(entry, campaign, content_filters)
            if not filter_result.accepted:
                # Use filter_name as discriminator (P2 review: avoids brittle reason.startswith())
                if filter_result.filter_name == "quality":
                    filtered_by_quality += 1
                elif filter_result.filter_name == "cross_campaign_dedup":
                    filtered_by_dedup += 1
                elif filter_result.filter_name == "keyword":
                    filtered_by_keyword += 1
                else:
                    import logging as _logging
                    _logging.getLogger(__name__).warning(
                        "unknown filter rejected entry: filter_name=%s reason=%s",
                        filter_result.filter_name,
                        filter_result.reason,
                    )
                    filtered_by_keyword += 1
                continue

            publish_time = start_time + timedelta(minutes=added_count * (campaign.schedule_interval or 0))
            title = (entry.get("title") or "").strip()
            description = (entry.get("description") or "").strip()
            original_caption = description if description else title

            db_video = Video(
                campaign_id=campaign_uuid,
                original_id=original_id,
                source_video_url=video_url,
                original_caption=original_caption,
                status=VideoStatus.downloading,
                publish_time=publish_time,
            )
            db.add(db_video)
            db.commit()
            db.refresh(db_video)
            added_count += 1

            out_path, _ = download_video(download_url, "tiktok")
            if out_path:
                db_video.file_path = out_path
                db_video.status = VideoStatus.ready
                db_video.last_error = None
            else:
                mark_video_failed(db_video, "Tải video thất bại.")
            db.commit()

        campaign = db.query(Campaign).filter(Campaign.id == campaign_uuid).first()
        if campaign:
            if interrupted_reason:
                set_campaign_sync_state(campaign, "failed", interrupted_reason, datetime.now(timezone.utc).replace(tzinfo=None))
                record_event(
                    "campaign",
                    "warning",
                    "Đồng bộ chiến dịch bị dừng giữa chừng.",
                    db=db,
                    details={
                        "campaign_id": campaign_id,
                        "reason": interrupted_reason,
                        "videos_added": added_count,
                        "filtered_by_quality": filtered_by_quality,
                        "filtered_by_keyword": filtered_by_keyword,
                        "filtered_by_dedup": filtered_by_dedup,
                        "filtered_total": filtered_by_quality + filtered_by_keyword + filtered_by_dedup,
                    },
                )
            else:
                set_campaign_sync_state(campaign, "completed", None, datetime.now(timezone.utc).replace(tzinfo=None))
                record_event(
                    "campaign",
                    "info",
                    "Đồng bộ chiến dịch hoàn tất.",
                    db=db,
                    details={
                        "campaign_id": campaign_id,
                        "videos_added": added_count,
                        "filtered_by_quality": filtered_by_quality,
                        "filtered_by_keyword": filtered_by_keyword,
                        "filtered_by_dedup": filtered_by_dedup,
                        "filtered_total": filtered_by_quality + filtered_by_keyword + filtered_by_dedup,
                    },
                )
                # P1 (review): AC5 — summary event when keyword filter rejected any video
                if filtered_by_keyword > 0:
                    record_event(
                        "campaign",
                        "info",
                        f"{filtered_by_keyword} video bị lọc bởi từ khóa",
                        db=db,
                        details={
                            "campaign_id": campaign_id,
                            "count": filtered_by_keyword,
                        },
                    )
            db.commit()

        return {"ok": interrupted_reason is None, "campaign_id": campaign_id, "videos_added": added_count}
    except Exception as exc:
        campaign_uuid = parse_uuid_or_none(campaign_id)
        if campaign_uuid:
            campaign = db.query(Campaign).filter(Campaign.id == campaign_uuid).first()
            if campaign:
                set_campaign_sync_state(campaign, "failed", str(exc), datetime.now(timezone.utc).replace(tzinfo=None))
                db.commit()
        record_event(
            "campaign",
            "error",
            "Tiến trình đồng bộ chiến dịch gặp lỗi.",
            db=db,
            details={"campaign_id": campaign_id, "error": str(exc)},
        )
        raise
    finally:
        db.close()


def reply_to_comment_job(interaction_log_id: str) -> dict:
    db: Session = SessionLocal()
    try:
        log_uuid = parse_uuid_or_none(interaction_log_id)
        if not log_uuid:
            raise ValueError("Mã nhật ký bình luận không hợp lệ.")

        log = db.query(InteractionLog).filter(InteractionLog.id == log_uuid).first()
        if not log:
            raise ValueError("Không tìm thấy bình luận cần phản hồi.")

        page_config = db.query(FacebookPage).filter(FacebookPage.page_id == log.page_id).first()
        if not page_config or not page_config.long_lived_access_token:
            log.status = InteractionStatus.failed
            log.ai_reply = "Trang Facebook chưa có mã truy cập hợp lệ."
            db.commit()
            return {"ok": False, "log_id": interaction_log_id}

        access_token = decrypt_secret(page_config.long_lived_access_token)
        ai_reply = generate_reply(log.user_message)
        log.ai_reply = ai_reply

        res = reply_to_comment(log.comment_id, ai_reply, access_token)
        if res and "id" in res:
            log.status = InteractionStatus.replied
            record_event(
                "webhook",
                "info",
                "Đã phản hồi bình luận thành công.",
                db=db,
                details={"comment_id": log.comment_id, "page_id": log.page_id},
            )
        else:
            log.status = InteractionStatus.failed
            record_event(
                "webhook",
                "warning",
                "Phản hồi bình luận không thành công.",
                db=db,
                details={"comment_id": log.comment_id, "page_id": log.page_id, "response": res},
            )

        db.commit()
        return {"ok": log.status == InteractionStatus.replied, "log_id": interaction_log_id}
    except Exception as exc:
        record_event(
            "webhook",
            "error",
            "Tiến trình phản hồi bình luận gặp lỗi.",
            db=db,
            details={"log_id": interaction_log_id, "error": str(exc)},
        )
        raise
    finally:
        db.close()
