from __future__ import annotations

"""Unified TikTok crawler interface.

Route giữa Apify và yt-dlp dựa trên TIKTOK_CRAWLER_MODE:
- "apify"  → chỉ dùng Apify (lỗi nếu token chưa cấu hình)
- "ytdlp"  → chỉ dùng yt-dlp
- "auto"   → thử Apify trước, fallback sang yt-dlp nếu Apify fail

API contract giống yt-dlp_crawler để campaign_jobs.py không cần thay đổi nhiều.
"""

from app.core.config import settings
from app.services.observability import record_event


def extract_metadata(source_url: str) -> dict:
    """Lấy metadata video/danh sách video từ TikTok URL.

    Returns dict tương thích format yt-dlp:
    - Single video: dict với 'id', 'title', 'description', 'webpage_url', '_apify_download_url' (nếu Apify)
    - Profile/playlist: dict với 'entries' list
    """
    mode = settings.TIKTOK_CRAWLER_MODE.lower()

    if mode == "apify":
        return _extract_via_apify(source_url)
    elif mode == "ytdlp":
        return _extract_via_ytdlp(source_url)
    else:  # auto
        return _extract_auto(source_url)


def download_video(url: str, filename_prefix: str = "tiktok") -> tuple[str | None, str | None]:
    """Download video từ TikTok URL hoặc direct download URL.

    Nếu url là Apify CDN URL (đã lấy từ extract_metadata), download trực tiếp.
    Nếu url là TikTok URL thông thường, dùng yt-dlp.

    Returns: (out_path, video_id) hoặc (None, None) nếu thất bại.
    """
    mode = settings.TIKTOK_CRAWLER_MODE.lower()

    if mode == "ytdlp":
        return _download_via_ytdlp(url, filename_prefix)
    elif mode == "apify":
        return _download_via_apify(url, filename_prefix)
    else:  # auto
        return _download_auto(url, filename_prefix)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_via_apify(source_url: str) -> dict:
    from app.services.apify_crawler import extract_metadata_apify
    result = extract_metadata_apify(source_url)
    record_event(
        "crawler",
        "info",
        "Đã lấy metadata TikTok qua Apify.",
        details={"source_url": source_url, "entries": len(result.get("entries", [result]))},
    )
    return result


def _extract_via_ytdlp(source_url: str) -> dict:
    from app.services.ytdlp_crawler import extract_metadata
    result = extract_metadata(source_url)
    record_event(
        "crawler",
        "info",
        "Đã lấy metadata TikTok qua yt-dlp.",
        details={"source_url": source_url},
    )
    return result


def _extract_auto(source_url: str) -> dict:
    """Thử Apify trước nếu token có, fallback sang yt-dlp."""
    if settings.APIFY_API_TOKEN:
        try:
            result = _extract_via_apify(source_url)
            if result.get("entries") or result.get("id"):
                return result
        except Exception as exc:
            record_event(
                "crawler",
                "warning",
                "Apify extract thất bại, chuyển sang yt-dlp.",
                details={"source_url": source_url, "error": str(exc)},
            )
    return _extract_via_ytdlp(source_url)


def _download_via_apify(url: str, filename_prefix: str) -> tuple[str | None, str | None]:
    from app.services.apify_crawler import download_video_apify
    out_path, video_id = download_video_apify(url, filename_prefix)
    if out_path:
        record_event(
            "crawler",
            "info",
            "Đã tải video qua Apify.",
            details={"url": url},
        )
    return out_path, video_id


def _download_via_ytdlp(url: str, filename_prefix: str) -> tuple[str | None, str | None]:
    from app.services.ytdlp_crawler import download_video
    out_path, video_id = download_video(url, filename_prefix)
    if out_path:
        record_event(
            "crawler",
            "info",
            "Đã tải video qua yt-dlp.",
            details={"url": url},
        )
    return out_path, video_id


def _download_auto(url: str, filename_prefix: str) -> tuple[str | None, str | None]:
    """Thử Apify download URL trực tiếp nếu url là CDN link, fallback yt-dlp."""
    # Nếu url trông như CDN URL (không phải tiktok.com) → thử download trực tiếp qua Apify module
    if settings.APIFY_API_TOKEN and "tiktok.com" not in url:
        out_path, video_id = _download_via_apify(url, filename_prefix)
        if out_path:
            return out_path, video_id
        record_event(
            "crawler",
            "warning",
            "Apify download thất bại, chuyển sang yt-dlp.",
            details={"url": url},
        )
    return _download_via_ytdlp(url, filename_prefix)
