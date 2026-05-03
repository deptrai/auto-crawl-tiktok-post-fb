"""Engagement metrics collector — Story 11.1.

Job chạy mỗi 6h, fetch likes/comments/shares/views/reach từ Facebook Graph API
cho mỗi video đã `posted` có `fb_post_id`. Append-only time-series vào bảng
`video_metrics`.

Round 2 review patches:
- Token Bucket rate limiter 200 req/hour (preventative, AC5).
- Bỏ reference `VideoStatus.published` (enum không có value này).
- KHÔNG mutate `auto_refresh_enabled` của Page khi auth fail (decoupling
  metrics từ token refresh logic).
- Move `access_token` từ query string sang `Authorization: Bearer` header để
  tránh leak qua logs.
- HTTP 429 raise `RateLimitError` thay vì silent return `{}`.
- Graph API error → record_event thay vì silent skip.
- `reach` dùng max() thay vì last-write-wins.
- Keyset pagination thay OFFSET.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Iterable

import requests
from sqlalchemy.orm import Session
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.models.models import Campaign, FacebookPage, Video, VideoMetrics, VideoStatus
from app.services.observability import record_event
from app.services.security import decrypt_secret

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Custom errors
# ---------------------------------------------------------------------------


class RateLimitError(Exception):
    """Facebook Graph API rate limit (codes 4/17/32/613 hoặc HTTP 429)."""


class AuthFailedError(Exception):
    """Token expired/invalid (codes 190/102)."""


# ---------------------------------------------------------------------------
# Token Bucket rate limiter — AC5: max 200 req/hour
# ---------------------------------------------------------------------------


class TokenBucket:
    """Thread-safe in-process token bucket. Refills tokens linearly.

    Default: capacity=200, refill_rate=200/3600 ≈ 0.0556 token/sec.
    Khi worker scale horizontally (>1 pod), mỗi pod độc lập — vẫn tốt vì
    spec nói "max 200 calls/hour" là per-process budget cho metrics_job.
    """

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
        """Non-blocking. True nếu có đủ tokens."""
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


# Module-level singleton — shared across job runs trong cùng process.
# Refill rate: 200 / 3600s ≈ 0.0556 token/giây.
_RATE_LIMITER = TokenBucket(capacity=200, refill_rate_per_second=200 / 3600)

# Field shape values FB Graph API có thể dùng cho reach (lấy max).
_REACH_METRIC_NAMES = {"post_impressions_unique", "post_video_views_unique"}
_VIEWS_METRIC_NAMES = {"post_video_views", "total_video_views"}

# Auth/rate-limit error codes from Graph API.
_AUTH_FAIL_CODES = {190, 102}
_RATE_LIMIT_CODES = {4, 17, 32, 613}

# Batch size — FB Graph `?ids=` accepts up to 50 per request.
_CHUNK_SIZE = 50

# Pagination: số video tối đa fetch từ DB cho mỗi page mỗi cycle.
_MAX_VIDEOS_PER_PAGE = 1000


def get_rate_limiter() -> TokenBucket:
    """Expose for tests."""
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
def _fetch_batch_metrics(url: str, params: dict, headers: dict) -> dict:
    """GET batch metrics. Raise AuthFailedError / RateLimitError; return {} on
    other errors (caller log)."""
    resp = requests.get(url, params=params, headers=headers, timeout=30)

    # HTTP 429 → rate limit (FB ngoài JSON error.code đôi khi dùng status code).
    if resp.status_code == 429:
        raise RateLimitError(f"HTTP 429 from Graph API")

    try:
        data = resp.json()
    except ValueError:
        # Don't log resp.text raw — có thể chứa request echo / token.
        logger.error("Invalid JSON response (status=%s, len=%s)", resp.status_code, len(resp.text or ""))
        return {}

    err_obj = data.get("error")
    if err_obj:
        if isinstance(err_obj, dict):
            code = err_obj.get("code")
            if code in _AUTH_FAIL_CODES:
                raise AuthFailedError(f"Token expired/invalid (code={code})")
            if code in _RATE_LIMIT_CODES:
                raise RateLimitError(f"Rate limited (code={code})")
            logger.error("Graph API error code=%s type=%s", code, err_obj.get("type"))
        else:
            logger.error("Graph API error (non-dict): %r", str(err_obj)[:200])
        return {}

    if resp.status_code != 200:
        logger.error("HTTP error %s (no JSON error body)", resp.status_code)
        return {}

    return data


# ---------------------------------------------------------------------------
# Parser
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
        if name in _VIEWS_METRIC_NAMES:
            views = max(views, val)
        elif name in _REACH_METRIC_NAMES:
            reach = max(reach, val)

    return {
        "views": views,
        "likes": int(likes or 0),
        "comments": int(comments or 0),
        "shares": int(shares or 0),
        "reach": reach,
    }


# ---------------------------------------------------------------------------
# Per-page fetch
# ---------------------------------------------------------------------------


def fetch_metrics_for_page_videos(db: Session, page: FacebookPage, videos: list[Video]) -> bool:
    """Fetch + persist metrics cho 1 page's videos.

    Returns True nếu page nên tiếp tục cycle (có thể có chunks khác);
    False nếu page bị auth fail / rate limit và outer loop nên break ngay.
    """
    try:
        access_token = decrypt_secret(page.long_lived_access_token)
    except Exception as exc:
        logger.error("Cannot decrypt token for page %s", page.page_id)
        record_event(
            "metrics_collector",
            "error",
            "AUTH_FAILED",
            db=db,
            details={"page_id": page.page_id, "error": str(exc)[:200]},
        )
        return False

    url = "https://graph.facebook.com/v21.0/"

    for i in range(0, len(videos), _CHUNK_SIZE):
        chunk = videos[i:i + _CHUNK_SIZE]
        ids = [v.fb_post_id for v in chunk if v.fb_post_id]
        if not ids:
            continue

        # Preventative rate limit: 1 token per request, capacity 200/hour.
        if not _RATE_LIMITER.try_acquire(1):
            logger.warning(
                "metrics_collector: rate limit budget cạn (≤%.1f tokens), bỏ qua phần còn lại của cycle",
                _RATE_LIMITER.available(),
            )
            record_event(
                "metrics_collector",
                "warning",
                "RATE_LIMIT_BUDGET_EXHAUSTED",
                db=db,
                details={"page_id": page.page_id, "remaining_videos": len(videos) - i},
            )
            return False

        params = {
            "ids": ",".join(ids),
            "fields": "likes.summary(true),comments.summary(true),shares,video_insights",
        }
        headers = {"Authorization": f"Bearer {access_token}"}

        try:
            data = _fetch_batch_metrics(url, params, headers)

            now = datetime.now(timezone.utc).replace(tzinfo=None)
            for video in chunk:
                fb_id = video.fb_post_id
                if not fb_id:
                    continue
                v_data = data.get(fb_id)
                if not v_data:
                    continue
                if isinstance(v_data, dict) and "error" in v_data:
                    logger.warning("Per-video error for %s: code=%s", fb_id, v_data["error"].get("code") if isinstance(v_data["error"], dict) else "?")
                    continue
                parsed = _parse_video_metrics(v_data)
                db.add(VideoMetrics(
                    video_id=video.id,
                    fb_post_id=fb_id,
                    fetched_at=now,
                    **parsed,
                ))

            try:
                db.commit()
            except Exception as commit_exc:
                db.rollback()
                logger.error("Commit fail cho page %s: %s", page.page_id, commit_exc)
                record_event(
                    "metrics_collector",
                    "error",
                    "DB_COMMIT_FAILED",
                    db=db,
                    details={"page_id": page.page_id, "error": str(commit_exc)[:200]},
                )
                return False

        except AuthFailedError as exc:
            logger.error("AUTH_FAILED for page %s: %s", page.page_id, exc)
            record_event(
                "metrics_collector",
                "error",
                "AUTH_FAILED",
                db=db,
                details={"page_id": page.page_id, "error": str(exc)},
            )
            # KHÔNG mutate page.auto_refresh_enabled — token_health_check_job
            # sẽ tự handle invalid token. Chỉ skip page này cho cycle này.
            return False

        except RateLimitError as exc:
            logger.error("RATE_LIMITED for page %s: %s", page.page_id, exc)
            record_event(
                "metrics_collector",
                "error",
                "RATE_LIMITED",
                db=db,
                details={"page_id": page.page_id, "error": str(exc)},
            )
            return False

        except Exception as exc:
            logger.exception("Lỗi không mong đợi khi fetch metrics page %s", page.page_id)
            try:
                db.rollback()
            except Exception:
                pass
            record_event(
                "metrics_collector",
                "error",
                "UNEXPECTED_ERROR",
                db=db,
                details={"page_id": page.page_id, "error": str(exc)[:200]},
            )
            return False

    return True


# ---------------------------------------------------------------------------
# Job entry point
# ---------------------------------------------------------------------------


def _videos_to_collect(db: Session, campaign_ids: list, last_id=None) -> list[Video]:
    """Keyset pagination — `WHERE id > last_id` thay vì OFFSET (faster + stable
    khi rows được thêm/xóa giữa các batches)."""
    q = db.query(Video).filter(
        Video.campaign_id.in_(campaign_ids),
        Video.status == VideoStatus.posted,
        Video.fb_post_id.isnot(None),
    )
    if last_id is not None:
        q = q.filter(Video.id > last_id)
    return q.order_by(Video.id.asc()).limit(_MAX_VIDEOS_PER_PAGE).all()


def collect_metrics_job(db: Session) -> None:
    """Cron entry point. Loop từng page → fetch metrics cho videos đã posted."""
    logger.info(
        "Starting metrics collection job (rate limit budget: %.1f/200 tokens)",
        _RATE_LIMITER.available(),
    )
    pages = db.query(FacebookPage).all()

    for page in pages:
        campaign_ids = [
            c.id for c in db.query(Campaign.id).filter(Campaign.target_page_id == page.page_id).all()
        ]
        if not campaign_ids:
            continue

        last_id = None
        while True:
            vids = _videos_to_collect(db, campaign_ids, last_id=last_id)
            if not vids:
                break
            should_continue = fetch_metrics_for_page_videos(db, page, vids)
            if not should_continue:
                # Page bị auth fail / rate limit / unexpected error — sang page kế.
                break
            last_id = vids[-1].id

    logger.info("Finished metrics collection job (remaining budget: %.1f)", _RATE_LIMITER.available())
