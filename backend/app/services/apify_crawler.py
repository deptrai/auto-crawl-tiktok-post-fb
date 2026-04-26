from __future__ import annotations

import logging
import os
import re
import uuid
import requests
from pathlib import Path
from urllib.parse import urlparse

from app.core.config import settings

logger = logging.getLogger(__name__)
DOWNLOAD_DIR = settings.DOWNLOAD_DIR
# H6: Đọc từ settings (không module-level os.getenv) để timeout có thể được cấu hình đúng

_ALLOWED_DOWNLOAD_HOSTS = {"api.apify.com"}
_ALLOWED_DOWNLOAD_SUFFIXES = (".tiktok.com", ".tiktokcdn.com", ".tiktokv.com")


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
            # F-06: Giới hạn số lượng video theo results_per_page
            return {"videoUrls": video_urls[:results_per_page]}
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

    # F-13: Validate dataset ID trước khi dùng
    dataset_id = run.get("defaultDatasetId")
    if not dataset_id:
        raise RuntimeError(f"Apify actor run returned no dataset. Run status: {run.get('status')}")

    # F-09: Pagination để lấy toàn bộ items (list_items() mặc định chỉ trả page đầu)
    dataset = client.dataset(dataset_id)
    items = []
    _offset = 0
    _page_size = 1000
    while True:
        page = dataset.list_items(offset=_offset, limit=_page_size)
        items.extend(page.items)
        if len(page.items) < _page_size:
            break
        _offset += _page_size

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

        # F-11: Thêm engagement metrics và duration
        entry = {
            "id": video_id,
            "webpage_url": webpage_url,
            "title": description,
            "description": description,
            "_apify_download_url": download_url,
            "view_count": item.get("playCount") or item.get("views") or 0,
            "like_count": item.get("diggCount") or item.get("likes") or 0,
            "comment_count": item.get("commentCount") or item.get("comments") or 0,
            "share_count": item.get("shareCount") or item.get("shares") or 0,
            "duration": item.get("videoMeta", {}).get("duration") or item.get("duration") or 0,
        }
        entries.append(entry)

    return {"entries": entries}


def download_video_apify(download_url: str, filename_prefix: str = "tiktok") -> tuple[str | None, str | None]:
    """Download video từ Apify HD URL (direct CDN, không cần proxy).

    Returns: (out_path, video_id) hoặc (None, None) nếu thất bại.
    """
    if not download_url:
        return None, None

    # F-04 + F-14: SSRF protection — chỉ cho phép download từ allowlisted hosts
    parsed_url = urlparse(download_url)
    hostname = parsed_url.hostname or ""
    if not (
        hostname in _ALLOWED_DOWNLOAD_HOSTS
        or any(hostname.endswith(s) for s in _ALLOWED_DOWNLOAD_SUFFIXES)
    ):
        raise ValueError(f"SSRF protection: hostname '{hostname}' not in allowlist")

    Path(DOWNLOAD_DIR).mkdir(parents=True, exist_ok=True)
    video_id = str(uuid.uuid4())

    # F-03: Sanitize filename_prefix để tránh path traversal
    safe_prefix = re.sub(r"[^a-zA-Z0-9_-]", "_", filename_prefix)
    filename = f"{safe_prefix}_{video_id}.mp4"
    out_path = os.path.join(DOWNLOAD_DIR, filename)

    try:
        # F-05: Dùng exact hostname match thay vì substring "in url"
        headers = {}
        if hostname == "api.apify.com" and settings.APIFY_API_TOKEN:
            headers["Authorization"] = f"Bearer {settings.APIFY_API_TOKEN}"
        resp = requests.get(download_url, stream=True, timeout=120, headers=headers)
        resp.raise_for_status()

        # F-15: Validate Content-Type trước khi ghi file
        content_type = resp.headers.get("Content-Type", "")
        if not content_type.startswith("video/"):
            raise ValueError(f"Unexpected Content-Type: {content_type!r}")

        # F-15: Validate Content-Length để tránh lưu file quá lớn
        content_length = resp.headers.get("Content-Length")
        if content_length and int(content_length) > 500 * 1024 * 1024:
            raise ValueError("Video size exceeds 500MB limit")

        with open(out_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        return out_path, video_id
    except Exception as e:
        logger.error("Lỗi tải video từ Apify URL: %s", type(e).__name__)
        if os.path.exists(out_path):
            try:
                os.remove(out_path)
            except OSError:
                pass
        return None, None
