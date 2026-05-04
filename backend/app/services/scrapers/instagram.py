from __future__ import annotations
import logging
import os
import re
import uuid
import requests
from pathlib import Path

from app.core.config import settings
from app.services.scrapers.base import BaseScraper

logger = logging.getLogger(__name__)

def _get_apify_client():
    token = settings.APIFY_API_TOKEN
    if not token:
        raise ValueError("APIFY_API_TOKEN chưa được cấu hình.")
    from apify_client import ApifyClient
    return ApifyClient(token)

class InstagramScraper(BaseScraper):
    """Scraper cho Instagram Reels — dùng Apify actor."""

    def __init__(self, actor_id: str = "apify/instagram-scraper"):
        self.actor_id = actor_id

    def extract_metadata(self, source_url: str) -> dict:
        client = _get_apify_client()
        logger.info("InstagramScraper.extract_metadata url=%s actor=%s", source_url, self.actor_id)

        # Cấu hình input cho apify/instagram-scraper
        run_input = {
            "directUrls": [source_url],
            "resultsType": "posts",
            "resultsLimit": 20,
            "searchType": "hashtag" if "/explore/tags/" in source_url else "user",
        }

        run = client.actor(self.actor_id).call(
            run_input=run_input,
            timeout_secs=settings.APIFY_ACTOR_TIMEOUT,
        )

        dataset_id = run.get("defaultDatasetId")
        if not dataset_id:
            raise RuntimeError(f"Apify actor run returned no dataset. Run status: {run.get('status')}")

        dataset = client.dataset(dataset_id)
        items = dataset.list_items().items

        entries = []
        for item in items:
            # Chỉ lấy các post là Video hoặc Reels
            post_type = item.get("type") or item.get("productType") or ""
            if post_type.lower() not in ("video", "reels", "igtv", "clips"):
                # Có thể 'type' là 'Image', 'Sidecar'. Kiểm tra thêm isVideo.
                if not item.get("isVideo"):
                    continue

            video_id = str(item.get("id") or item.get("shortCode") or "")
            if not video_id:
                continue

            download_url = item.get("videoUrl") or ""
            if not download_url:
                continue

            description = item.get("caption") or item.get("title") or ""
            webpage_url = item.get("url") or f"https://www.instagram.com/reel/{video_id}/"

            # Fallbacks cho view, like, comment
            view_count = int(item.get("videoViewCount") or item.get("viewCount") or item.get("playCount") or 0)
            like_count = int(item.get("likesCount") or item.get("likeCount") or 0)
            comment_count = int(item.get("commentsCount") or item.get("commentCount") or 0)
            duration = int(item.get("videoDuration") or 0)

            entry = {
                "id": video_id,
                "webpage_url": webpage_url,
                "title": description,
                "description": description,
                "_apify_download_url": download_url,
                "view_count": view_count,
                "like_count": like_count,
                "comment_count": comment_count,
                "share_count": 0,
                "duration": duration,
            }
            entries.append(entry)

        logger.info("InstagramScraper trích xuất được %d video(s) từ %s", len(entries), source_url)
        return {"entries": entries}

    def download_video(self, url: str, filename_prefix: str = "instagram") -> tuple[str | None, str | None]:
        if not url:
            return None, None

        logger.info("InstagramScraper.download_video url=%s", url)
        Path(settings.DOWNLOAD_DIR).mkdir(parents=True, exist_ok=True)
        video_id = str(uuid.uuid4())

        safe_prefix = re.sub(r"[^a-zA-Z0-9_-]", "_", filename_prefix)
        filename = f"{safe_prefix}_{video_id}.mp4"
        out_path = os.path.join(settings.DOWNLOAD_DIR, filename)

        try:
            # Download video directly
            resp = requests.get(url, stream=True, timeout=120)
            resp.raise_for_status()

            content_type = resp.headers.get("Content-Type", "")
            if not content_type.startswith("video/"):
                logger.warning("Unexpected Content-Type: %s. Tiến hành ghi file.", content_type)

            with open(out_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
            
            logger.info("InstagramScraper tải xong video: %s", out_path)
            return out_path, video_id
        except Exception as e:
            logger.error("Lỗi tải video từ Instagram URL: %s", type(e).__name__)
            if os.path.exists(out_path):
                os.remove(out_path)
            return None, None
