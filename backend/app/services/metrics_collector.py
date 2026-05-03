import logging
import time
from datetime import datetime, timezone
import requests
from sqlalchemy.orm import Session
from tenacity import retry, wait_exponential, stop_after_attempt, retry_if_exception_type

from app.models.models import Video, VideoStatus, VideoMetrics, FacebookPage
from app.services.security import decrypt_secret
from app.services.observability import record_event

logger = logging.getLogger(__name__)

class RateLimitError(Exception):
    pass

class AuthFailedError(Exception):
    pass

@retry(
    wait=wait_exponential(multiplier=1, min=4, max=60),
    stop=stop_after_attempt(3),
    retry=retry_if_exception_type((requests.RequestException, RateLimitError)),
    reraise=True
)
def _fetch_batch_metrics(url: str, params: dict):
    resp = requests.get(url, params=params, timeout=30)
    data = resp.json()
    
    if "error" in data:
        err_code = data["error"].get("code")
        if err_code in [190, 102]:
            raise AuthFailedError(f"Token expired or invalid: {data['error']}")
        elif err_code in [4, 17, 32, 613]:
            raise RateLimitError(f"Rate limited by Facebook: {data['error']}")
        else:
            logger.error(f"Graph API error: {data['error']}")
            return {} # Other errors, return empty to skip
            
    if resp.status_code != 200:
        logger.error(f"HTTP error {resp.status_code}: {resp.text}")
        return {}

    return data

def fetch_metrics_for_page_videos(db: Session, page: FacebookPage, videos: list[Video]):
    try:
        access_token = decrypt_secret(page.long_lived_access_token)
    except Exception as e:
        logger.error(f"Cannot decrypt token for page {page.page_id}: {e}")
        record_event("metrics_collector", "error", "AUTH_FAILED", db=db, details={"page_id": page.page_id, "error": str(e)})
        return

    chunk_size = 50
    for i in range(0, len(videos), chunk_size):
        chunk = videos[i:i+chunk_size]
        ids = [v.fb_post_id for v in chunk if v.fb_post_id]
        if not ids:
            continue
            
        url = "https://graph.facebook.com/v21.0/"
        params = {
            "ids": ",".join(ids),
            "fields": "likes.summary(true),comments.summary(true),shares,video_insights",
            "access_token": access_token
        }
        
        try:
            # Token Bucket / Rate Limiter logic: max 200 calls/hour.
            # To be safe, we sleep 18s per request (200 requests/3600s = 1 request/18s).
            # We sleep BEFORE the call to ensure spacing.
            time.sleep(18)
            
            data = _fetch_batch_metrics(url, params)
            
            for video in chunk:
                fb_id = video.fb_post_id
                v_data = data.get(fb_id)
                if not v_data:
                    continue
                
                if "error" in v_data:
                    logger.warning(f"Error fetching metrics for video {fb_id}: {v_data['error']}")
                    continue
                
                likes = v_data.get("likes", {}).get("summary", {}).get("total_count", 0)
                comments = v_data.get("comments", {}).get("summary", {}).get("total_count", 0)
                shares = v_data.get("shares", {}).get("count", 0)
                
                insights = v_data.get("video_insights", {}).get("data", [])
                views = 0
                reach = 0
                for insight in insights:
                    name = insight.get("name")
                    values = insight.get("values", [])
                    if not values:
                        continue
                    val = values[0].get("value", 0)
                    if name == "post_video_views":
                        views = val
                    elif name in ["post_impressions_unique", "post_video_views_unique"]:
                        reach = val
                        
                metrics = VideoMetrics(
                    video_id=video.id,
                    fb_post_id=fb_id,
                    views=views,
                    likes=likes,
                    comments=comments,
                    shares=shares,
                    reach=reach,
                    fetched_at=datetime.now(timezone.utc).replace(tzinfo=None)
                )
                db.add(metrics)
            
            db.commit()
            
        except AuthFailedError as e:
            logger.error(f"AUTH_FAILED for page {page.page_id}: {e}")
            record_event("metrics_collector", "error", "AUTH_FAILED", db=db, details={"page_id": page.page_id, "error": str(e)})
            # Disable fetching for this page by removing auto_refresh or adding a flag.
            # Assuming auto_refresh_enabled = False temporarily disables background tasks.
            page.auto_refresh_enabled = False
            db.commit()
            break # Stop processing this page
        except RateLimitError as e:
            logger.error(f"RATE_LIMITED for page {page.page_id}: {e}")
            record_event("metrics_collector", "error", "RATE_LIMITED", db=db, details={"page_id": page.page_id, "error": str(e)})
            break # Stop processing this page, retry next time
        except Exception as e:
            logger.error(f"Exception fetching metrics for page {page.page_id}: {e}")
            db.rollback()

def collect_metrics_job(db: Session):
    logger.info("Starting metrics collection job...")
    videos = db.query(Video).filter(
        Video.status.in_([VideoStatus.posted, VideoStatus.published]),
        Video.fb_post_id.isnot(None)
    ).all()
    
    videos_by_page = {}
    for v in videos:
        if v.campaign and v.campaign.target_page_id:
            page_id = v.campaign.target_page_id
            videos_by_page.setdefault(page_id, []).append(v)
            
    for page_id, vids in videos_by_page.items():
        page = db.query(FacebookPage).filter_by(page_id=page_id).first()
        # Only collect if auto_refresh_enabled is not explicitly False? 
        # The requirement says "tắt cron fetching cho Page bị lỗi". 
        # We will use auto_refresh_enabled as a proxy for "active" page, or just check it.
        # But to be safe, if we set auto_refresh_enabled to False on Auth error, we should skip it.
        if page and page.auto_refresh_enabled is not False:
            fetch_metrics_for_page_videos(db, page, vids)
            
    logger.info("Finished metrics collection job.")
