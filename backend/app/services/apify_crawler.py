from __future__ import annotations

import logging
import os
import uuid
import requests
from pathlib import Path
from urllib.parse import urlparse

from app.core.config import settings

logger = logging.getLogger(__name__)
DOWNLOAD_DIR = settings.DOWNLOAD_DIR
# H6: Đọc từ settings (không module-level os.getenv) để timeout có thể được cấu hình đúng


def _get_client():
    """Trả về ApifyClient đã xác thực. Raise nếu token chưa cấu hình."""
    from apify_client import ApifyClient

    token = settings.APIFY_API_TOKEN
    if not token:
        raise ValueError("APIFY_API_TOKEN chưa được cấu hình.")
    return ApifyClient(token)


def _is_profile_url(url: str) -> bool:
    """Kiểm tra xem URL là profile/channel TikTok hay single video.
    L2: Dùng urlparse để chỉ kiểm tra path, tránh bị lừa bởi query params.
    """
    try:
        path = urlparse(url).path
    except Exception:
        path = url
    return "/video/" not in path


def _is_hashtag_url(url: str) -> bool:
    """Kiểm tra xem URL/string là hashtag TikTok."""
    return "/tag/" in url or url.startswith("#")


def _extract_hashtag_name(url: str) -> str:
    """Trích xuất tên hashtag từ URL hoặc string."""
    if "/tag/" in url:
        return url.split("/tag/")[-1].split("?")[0].strip("/")
    return url.lstrip("#").split("?")[0].strip()


def _is_clockworks_actor(actor_id: str) -> bool:
    """Kiểm tra xem actor ID là clockworks/tiktok-scraper."""
    return "clockworks" in actor_id.lower() or actor_id in ("GdWCkxBtKWOsKjdch",)


def _extract_video_urls_flat(profile_url: str) -> list[str]:
    """Dùng yt-dlp extract_flat=True để lấy danh sách video URLs từ profile.
    Dùng làm fallback cho kingscraper actor (cần video URL list).
    extract_flat không bị TikTok block vì không fetch video data."""
    import yt_dlp
    from app.services.ytdlp_crawler import _get_base_opts

    opts = _get_base_opts()
    opts.update({
        "skip_download": True,
        "extract_flat": True,
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 30,
    })
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(profile_url, download=False)

    entries = info.get("entries", [])
    urls = []
    for entry in entries:
        url = entry.get("webpage_url") or entry.get("url")
        if url:
            urls.append(url)
    return urls


def _build_run_input(source_url: str, actor_id: str, results_per_page: int = 20) -> dict:
    """Tạo run_input phù hợp với từng actor."""
    if _is_clockworks_actor(actor_id):
        # clockworks/tiktok-scraper format
        base = {"shouldDownloadVideos": True, "resultsPerPage": results_per_page}
        if _is_hashtag_url(source_url):
            base["hashtags"] = [_extract_hashtag_name(source_url)]
        elif _is_profile_url(source_url):
            base["profiles"] = [source_url]
        else:
            base["postURLs"] = [source_url]
        return base
    else:
        # kingscraper format — cần video URL list
        if _is_profile_url(source_url):
            video_urls = _extract_video_urls_flat(source_url)
            return {"videoUrls": video_urls}
        return {"videoUrls": [source_url]}


def extract_metadata_apify(source_url: str, results_per_page: int = 20) -> dict:
    """Lấy metadata video từ Apify actor.

    Hỗ trợ cả clockworks/tiktok-scraper và kingscraper actor.
    clockworks: nhận profile URL, hashtag, hoặc postURLs trực tiếp.
    kingscraper: nhận videoUrls array.

    Returns dict tương thích với yt-dlp info format:
    {
        "entries": [
            {
                "id": "...",
                "webpage_url": "...",
                "title": "...",
                "description": "...",
                "_apify_download_url": "..."   # HD no-watermark URL
            },
            ...
        ]
    }
    """
    client = _get_client()
    actor_id = settings.APIFY_ACTOR_ID

    run_input = _build_run_input(source_url, actor_id, results_per_page)

    # Nếu kingscraper và không có video URL nào → trả về rỗng
    if not _is_clockworks_actor(actor_id) and not run_input.get("videoUrls"):
        return {"entries": []}

    run = client.actor(actor_id).call(
        run_input=run_input,
        timeout_secs=settings.APIFY_ACTOR_TIMEOUT,
    )

    items = client.dataset(run["defaultDatasetId"]).list_items().items

    entries = []
    for item in items:
        video_id = str(item.get("id", ""))
        # mediaUrls: clockworks field khi shouldDownloadVideos=True (Apify KV store URL)
        # downloadLink: clockworks field (thường None, fallback)
        # noWatermarkHdUrl/noWatermarkSdUrl: kingscraper fields
        media_urls = item.get("mediaUrls") or []
        download_url = (
            (media_urls[0] if media_urls else None)
            or item.get("downloadLink")
            or item.get("noWatermarkHdUrl")
            or item.get("noWatermarkSdUrl")
            or ""
        )
        description = (
            item.get("text")           # clockworks field
            or item.get("description") # kingscraper field
            or item.get("title")
            or ""
        ).strip()
        author_name = (item.get("authorMeta") or {}).get("name", "unknown")
        webpage_url = item.get("webVideoUrl") or f"https://www.tiktok.com/@{author_name}/video/{video_id}"
        entries.append({
            "id": video_id,
            "webpage_url": webpage_url,
            "title": description,
            "description": description,
            "_apify_download_url": download_url,
        })

    return {"entries": entries}


def download_video_apify(download_url: str, filename_prefix: str = "tiktok") -> tuple[str | None, str | None]:
    """Download video từ Apify HD URL (direct CDN, không cần proxy).

    Returns: (out_path, video_id) hoặc (None, None) nếu thất bại.
    """
    if not download_url:
        return None, None

    Path(DOWNLOAD_DIR).mkdir(parents=True, exist_ok=True)
    video_id = str(uuid.uuid4())
    filename = f"{filename_prefix}_{video_id}.mp4"
    out_path = os.path.join(DOWNLOAD_DIR, filename)

    try:
        # Apify KV store URLs cần bearer token auth
        headers = {}
        if "api.apify.com" in download_url and settings.APIFY_API_TOKEN:
            headers["Authorization"] = f"Bearer {settings.APIFY_API_TOKEN}"
        resp = requests.get(download_url, stream=True, timeout=120, headers=headers)
        resp.raise_for_status()
        with open(out_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        return out_path, video_id
    except Exception as e:
        logger.error(f"Lỗi tải video từ Apify URL: {e}")
        if os.path.exists(out_path):
            try:
                os.remove(out_path)
            except OSError:
                pass
        return None, None
