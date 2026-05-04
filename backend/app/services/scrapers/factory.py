"""Scraper Factory — trả về BaseScraper phù hợp dựa trên source URL.

Routing logic:
  youtube.com, youtu.be → YoutubeScraper
  mặc định              → TiktokScraper (backward-compatible)
"""
from __future__ import annotations
import logging
from urllib.parse import urlparse

from app.services.scrapers.base import BaseScraper

logger = logging.getLogger(__name__)

_YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com"}


def _is_youtube_url(source_url: str) -> bool:
    """Kiểm tra URL có phải YouTube không."""
    try:
        hostname = urlparse(source_url).hostname or ""
    except Exception:
        hostname = ""
    return hostname in _YOUTUBE_HOSTS


def get_scraper(source_url: str) -> BaseScraper:
    """Factory: trả về scraper phù hợp với source URL.

    Args:
        source_url: URL của nguồn nội dung (TikTok profile, YouTube channel/playlist, ...)

    Returns:
        BaseScraper instance tương ứng với platform được detect.
    """
    if _is_youtube_url(source_url):
        from app.services.scrapers.youtube import YoutubeScraper
        logger.info("get_scraper: detected YouTube → YoutubeScraper (url=%s)", source_url)
        return YoutubeScraper()

    # Default: TikTok (backward-compatible với tất cả campaign cũ)
    from app.services.scrapers.tiktok import TiktokScraper
    logger.debug("get_scraper: default → TiktokScraper (url=%s)", source_url)
    return TiktokScraper()
