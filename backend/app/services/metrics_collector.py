"""
Service thu thập Engagement Metrics từ Facebook Graph API.
Hỗ trợ đa nền tảng qua bảng VideoPost.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Dict, Any

import requests
from sqlalchemy.orm import Session
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.models.models import Campaign, FacebookPage, Video, VideoMetrics, VideoStatus, VideoPost, PlatformType
from app.services.observability import record_event
from app.services.security import decrypt_secret

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Custom errors
# ---------------------------------------------------------------------------

class RateLimitError(Exception):
    """Facebook Graph API rate limit."""

class AuthFailedError(Exception):
    """Token expired/invalid."""

# ---------------------------------------------------------------------------
# Token Bucket rate limiter — max 200 req/hour
# ---------------------------------------------------------------------------

class TokenBucket:
    def __init__(self, capacity: int, refill_rate_per_second: float):
        self.capacity = capacity
        self.refill_rate = refill_rate_per_second
        self._tokens = float(capacity)
        self._last_refill = time.monotonic()
        self._lock = threading.Lock()

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_refill
        self._tokens = min(self.capacity, self._tokens + elapsed * self.refill_rate)
        self._last_refill = now

    def try_acquire(self, n: int = 1) -> bool:
        with self._lock:
            self._refill()
            if self._tokens >= n:
                self._tokens -= n
                return True
            return False

    def available(self) -> float:
        with self._lock:
            self._refill()
            return self._tokens

_RATE_LIMITER = TokenBucket(capacity=200, refill_rate_per_second=200 / 3600)

def get_rate_limiter() -> TokenBucket:
    return _RATE_LIMITER

# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------

@retry(
    wait=wait_exponential(multiplier=1, min=4, max=60),
    stop=stop_after_attempt(3),
    retry=retry_if_exception_type((requests.RequestException,)),
    reraise=True,
)
def _fetch_batch_metrics(url: str, params: dict, access_token: str) -> dict:
    headers = {"Authorization": f"Bearer {access_token}"}
    resp = requests.get(url, params=params, headers=headers, timeout=30)

    if resp.status_code == 429:
        raise RateLimitError("HTTP 429 from Graph API")

    try:
        data = resp.json()
    except ValueError:
        logger.error(f"Invalid JSON response (status={resp.status_code})")
        return {}

    err_obj = data.get("error")
    if err_obj:
        if isinstance(err_obj, dict):
            code = err_obj.get("code")
            if code in [190, 102]:
                raise AuthFailedError(f"Token expired/invalid (code={code})")
            if code in [4, 17, 32, 613]:
                raise RateLimitError(f"Rate limited (code={code})")
        logger.error(f"Graph API error: {err_obj}")
        return {}

    if resp.status_code != 200:
        logger.error(f"HTTP error {resp.status_code}")
        return {}

    return data

# ---------------------------------------------------------------------------
# Logic
# ---------------------------------------------------------------------------

def _parse_video_metrics(v_data: dict) -> dict:
    """Trích xuất counts từ FB Graph response object cho 1 video."""
    likes = (v_data.get("likes") or {}).get("summary", {}).get("total_count", 0) or 0
    comments = (v_data.get("comments") or {}).get("summary", {}).get("total_count", 0) or 0
    shares = (v_data.get("shares") or {}).get("count", 0) or 0

    insights = (v_data.get("video_insights") or {}).get("data") or []
    views = 0
    reach = 0
    for insight in insights:
        if not isinstance(insight, dict):
            continue
        name = insight.get("name")
        values = insight.get("values") or []
        if not values:
            continue
        first = values[0]
        if not isinstance(first, dict):
            continue
        val = first.get("value", 0) or 0
        try:
            val = int(val)
        except (TypeError, ValueError):
            val = 0
        if name in ["post_video_views", "total_video_views"]:
            views = max(views, val)
        elif name in ["post_impressions_unique", "post_video_views_unique"]:
            reach = max(reach, val)

    return {
        "views": views,
        "likes": int(likes or 0),
        "comments": int(comments or 0),
        "shares": int(shares or 0),
        "reach": reach,
    }


def fetch_metrics_for_page_videos(db: Session, page: FacebookPage, videos: list[Video]):
    """Wrapper for legacy tests and logic."""
    # Convert list[Video] to list[VideoPost] dummy objects for _fetch_metrics_for_posts
    # but the tests mock everything, so let's just use the logic directly here or call it.
    records = []
    for v in videos:
        # Create a transient VideoPost object
        pr = VideoPost(video_id=v.id, platform=PlatformType.facebook, external_id=v.fb_post_id)
        # Link it to the mock video
        pr.video = v
        records.append(pr)
    
    return _fetch_metrics_for_posts(db, page, records)


def _videos_to_collect(db: Session, campaign_ids: list, last_id=None) -> list[Video]:
    """Expose for tests."""
    q = db.query(Video).filter(
        Video.campaign_id.in_(campaign_ids),
        Video.status == VideoStatus.posted,
        Video.fb_post_id.isnot(None),
    )
    if last_id is not None:
        q = q.filter(Video.id > last_id)
    return q.order_by(Video.id.asc()).limit(1000).all()


def _fetch_metrics_for_posts(db: Session, page: FacebookPage, records: list[VideoPost]):
    try:
        access_token = decrypt_secret(page.long_lived_access_token)
    except Exception as e:
        logger.error(f"Cannot decrypt token for page {page.page_id}: {e}")
        return False # Return False on auth error

    chunk_size = 50
    for i in range(0, len(records), chunk_size):
        chunk = records[i:i+chunk_size]
        ids = [r.external_id for r in chunk if r.external_id]
        if not ids:
            continue
            
        if not _RATE_LIMITER.try_acquire():
            logger.warning("Rate limit bucket empty, skipping chunk.")
            return False # Return False on rate limit

        url = "https://graph.facebook.com/v21.0/"
        params = {
            "ids": ",".join(ids),
            "fields": "likes.summary(true),comments.summary(true),shares,video_insights",
        }
        
        try:
            data = _fetch_batch_metrics(url, params, access_token)
            
            for record in chunk:
                fb_id = record.external_id
                if not fb_id: continue
                v_data = data.get(fb_id)
                if not v_data: continue
                
                m = _parse_video_metrics(v_data)
                        
                metrics = VideoMetrics(
                    video_id=record.video_id,
                    fb_post_id=fb_id,
                    views=m["views"], likes=m["likes"], comments=m["comments"], shares=m["shares"], reach=m["reach"],
                    fetched_at=datetime.now(timezone.utc).replace(tzinfo=None)
                )
                db.add(metrics)
            db.commit()
        except RateLimitError as e:
            logger.error(f"Rate limited for page {page.page_id}: {e}")
            db.rollback()
            record_event("metrics_collector", "error", "RATE_LIMITED", db=db, details={"page_id": page.page_id})
            db.commit()
            return False
        except AuthFailedError as e:
            logger.error(f"Auth failed for page {page.page_id}: {e}")
            db.rollback()
            record_event("metrics_collector", "error", "AUTH_FAILED", db=db, details={"page_id": page.page_id})
            db.commit()
            return False
        except Exception as e:
            logger.error(f"Error in metrics chunk: {e}")
            db.rollback()
            return False

    return True

def collect_metrics_job(db: Session):
    logger.info("Starting metrics collection job...")
    
    # Process Facebook posts (Facebook and Instagram use Graph API)
    post_records = db.query(VideoPost).filter(
        VideoPost.status == VideoStatus.posted,
        VideoPost.platform.in_([PlatformType.facebook, PlatformType.instagram]),
        VideoPost.external_id.isnot(None)
    ).order_by(VideoPost.id.asc()).all()
    
    posts_by_page = {}
    for pr in post_records:
        if pr.video and pr.video.campaign:
            # For IG, we still use the Page's token.
            # But the 'page_id' needed for the token lookup is from platform_targets['facebook'] 
            # or target_page_id if it's the same linked business account.
            target_id = (pr.video.campaign.platform_targets or {}).get("facebook")
            if not target_id: target_id = pr.video.campaign.target_page_id
            if target_id:
                posts_by_page.setdefault(target_id, []).append(pr)

    for page_id, records in posts_by_page.items():
        page = db.query(FacebookPage).filter_by(page_id=page_id).first()
        if page and page.auto_refresh_enabled is not False:
            _fetch_metrics_for_posts(db, page, records)
            
    logger.info("Finished metrics collection job.")
