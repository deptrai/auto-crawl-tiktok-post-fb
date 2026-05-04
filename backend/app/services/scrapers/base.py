"""BaseScraper — Abstract interface cho Scraper Strategy Pattern.

Mỗi platform (TikTok, YouTube, Instagram) implement interface này.
contract:
  - extract_metadata(source_url) -> dict tương thích yt-dlp format
      Single video: {'id': ..., 'title': ..., 'webpage_url': ..., ...}
      Playlist/channel: {'entries': [...]}
  - download_video(url, filename_prefix) -> (out_path | None, video_id | None)
"""
from __future__ import annotations
from abc import ABC, abstractmethod


class BaseScraper(ABC):
    """Abstract scraper. Implement cho từng platform."""

    @abstractmethod
    def extract_metadata(self, source_url: str) -> dict:
        """Lấy metadata video / danh sách video từ source URL.

        Returns dict tương thích yt-dlp format:
        - Single video: {'id', 'title', 'description', 'webpage_url', ...}
        - Playlist/channel: {'entries': [{'id', 'title', 'description', ...}]}
        """

    @abstractmethod
    def download_video(self, url: str, filename_prefix: str = "video") -> tuple[str | None, str | None]:
        """Download video về local.

        Returns:
            (out_path, video_id) nếu thành công
            (None, None) nếu thất bại
        """
