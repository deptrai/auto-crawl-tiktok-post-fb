"""TiktokScraper — wrap tiktok_crawler hiện có.

Proxy toàn bộ logic sang tiktok_crawler.py để campaign_jobs.py
có thể dùng interface thống nhất BaseScraper mà không thay đổi
behaviour TikTok hiện tại.
"""
from __future__ import annotations
import logging

from app.services.scrapers.base import BaseScraper

logger = logging.getLogger(__name__)


class TiktokScraper(BaseScraper):
    """Scraper cho TikTok — dùng Apify/yt-dlp theo TIKTOK_CRAWLER_MODE."""

    def extract_metadata(self, source_url: str) -> dict:
        from app.services.tiktok_crawler import extract_metadata
        logger.debug("TiktokScraper.extract_metadata url=%s", source_url)
        return extract_metadata(source_url)

    def download_video(self, url: str, filename_prefix: str = "tiktok") -> tuple[str | None, str | None]:
        from app.services.tiktok_crawler import download_video
        logger.debug("TiktokScraper.download_video url=%s", url)
        return download_video(url, filename_prefix)
