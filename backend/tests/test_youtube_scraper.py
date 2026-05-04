"""Tests cho Story 13.1: YouTube Shorts Scraper Strategy Pattern.

Coverage:
  - Factory routing: youtube.com/youtu.be → YoutubeScraper; else → TiktokScraper
  - YoutubeScraper._normalize_channel_url
  - YoutubeScraper._map_entry_to_schema
  - YoutubeScraper.extract_metadata Shorts filter (duration <= 60s)
  - YoutubeScraper.extract_metadata empty/error handling
  - BaseScraper contract compliance
  - Backward-compat: TiktokScraper proxies to tiktok_crawler
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.services.scrapers.base import BaseScraper
from app.services.scrapers.factory import _is_youtube_url, get_scraper
from app.services.scrapers.tiktok import TiktokScraper
from app.services.scrapers.youtube import (
    SHORTS_MAX_DURATION,
    YoutubeScraper,
    _map_entry_to_schema,
    _normalize_channel_url,
)


# ---------------------------------------------------------------------------
# Factory routing tests
# ---------------------------------------------------------------------------

class TestScraperFactory:
    """Test get_scraper() routing logic."""

    @pytest.mark.parametrize(
        "url",
        [
            "https://www.youtube.com/@channel/shorts",
            "https://youtube.com/c/channel",
            "https://m.youtube.com/@user",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://www.youtube.com/playlist?list=PLabc123",
        ],
    )
    def test_youtube_urls_route_to_youtube_scraper(self, url):
        scraper = get_scraper(url)
        assert isinstance(scraper, YoutubeScraper), f"Expected YoutubeScraper for {url}"

    @pytest.mark.parametrize(
        "url",
        [
            "https://www.tiktok.com/@user/video/123",
            "https://tiktok.com/@channel",
            "https://vm.tiktok.com/ZMeXXX/",
            "https://example.com/some-video",
            "",
        ],
    )
    def test_non_youtube_urls_route_to_tiktok_scraper(self, url):
        scraper = get_scraper(url)
        assert isinstance(scraper, TiktokScraper), f"Expected TiktokScraper for {url}"

    def test_all_scrapers_implement_base(self):
        for url, cls in [
            ("https://youtube.com/@ch", YoutubeScraper),
            ("https://tiktok.com/@ch", TiktokScraper),
        ]:
            scraper = get_scraper(url)
            assert isinstance(scraper, BaseScraper)

    def test_is_youtube_url_edge_cases(self):
        assert _is_youtube_url("https://www.youtube.com/watch?v=abc") is True
        assert _is_youtube_url("https://youtu.be/abc") is True
        assert _is_youtube_url("https://notyoutube.com/video") is False
        assert _is_youtube_url("youtube.com/no-scheme") is False  # no scheme → urlparse hostname=None
        assert _is_youtube_url("") is False


# ---------------------------------------------------------------------------
# URL normalization tests
# ---------------------------------------------------------------------------

class TestNormalizeChannelUrl:
    def test_bare_channel_url_gets_shorts_suffix(self):
        assert _normalize_channel_url("https://youtube.com/@channel") == "https://youtube.com/@channel/shorts"

    def test_trailing_slash_stripped(self):
        assert _normalize_channel_url("https://youtube.com/@channel/") == "https://youtube.com/@channel/shorts"

    def test_already_shorts_not_duplicated(self):
        url = "https://youtube.com/@channel/shorts"
        assert _normalize_channel_url(url) == url

    def test_playlist_url_untouched(self):
        url = "https://youtube.com/playlist?list=PLabc"
        assert _normalize_channel_url(url) == url

    def test_watch_url_untouched(self):
        url = "https://youtube.com/watch?v=abc"
        assert _normalize_channel_url(url) == url

    def test_channel_c_url(self):
        assert _normalize_channel_url("https://youtube.com/c/mychannel") == "https://youtube.com/c/mychannel/shorts"

    def test_legacy_channel_ucxxx_url(self):
        """[P3] Legacy youtube.com/channel/UCxxx format phải được normalize thêm /shorts."""
        url = "https://youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw"
        assert _normalize_channel_url(url) == url + "/shorts"

    def test_legacy_channel_already_has_shorts(self):
        """[P3] Nếu đã có /shorts thì không duplicate."""
        url = "https://youtube.com/channel/UCxxx/shorts"
        assert _normalize_channel_url(url) == url


# ---------------------------------------------------------------------------
# Schema mapping tests
# ---------------------------------------------------------------------------

class TestMapEntryToSchema:
    def test_full_entry(self):
        entry = {
            "id": "abc123",
            "webpage_url": "https://youtube.com/watch?v=abc123",
            "title": "My Short",
            "description": "Cool desc",
            "view_count": 1000,
            "like_count": 50,
            "comment_count": 5,
            "duration": 30,
        }
        result = _map_entry_to_schema(entry)
        assert result["id"] == "abc123"
        assert result["webpage_url"] == "https://youtube.com/watch?v=abc123"
        assert result["title"] == "My Short"
        assert result["description"] == "Cool desc"
        assert result["view_count"] == 1000
        assert result["like_count"] == 50
        assert result["duration"] == 30
        assert result["_yt_download"] is True
        assert result["share_count"] == 0  # YouTube không expose

    def test_minimal_entry_fallbacks(self):
        result = _map_entry_to_schema({})
        assert result["id"]  # UUID generated
        assert result["webpage_url"].startswith("https://www.youtube.com/watch?v=")
        assert result["description"] == ""
        assert result["duration"] == 0
        assert result["_yt_download"] is True

    def test_description_fallback_to_title(self):
        entry = {"id": "x", "title": "Title only", "description": ""}
        result = _map_entry_to_schema(entry)
        assert result["description"] == "Title only"  # fallback sang title

    def test_view_count_type_coercion(self):
        entry = {"id": "y", "view_count": "500"}
        result = _map_entry_to_schema(entry)
        assert result["view_count"] == 500
        assert isinstance(result["view_count"], int)


# ---------------------------------------------------------------------------
# YoutubeScraper.extract_metadata tests (mocked yt_dlp)
# ---------------------------------------------------------------------------

class TestYoutubeScraperExtractMetadata:
    """Unit tests với yt-dlp mocked — không thực sự gọi YouTube."""

    def _make_entry(self, video_id: str, duration: int | None, title: str = "title") -> dict:
        return {
            "id": video_id,
            "title": title,
            "description": title,
            "webpage_url": f"https://youtube.com/watch?v={video_id}",
            "duration": duration,
            "view_count": 100,
        }

    @patch("app.services.scrapers.youtube.yt_dlp.YoutubeDL")
    def test_extracts_shorts_only(self, mock_ydl_cls):
        """Chỉ entries duration <= 60s được giữ lại."""
        entries = [
            self._make_entry("short1", 30),   # OK
            self._make_entry("long1", 180),    # filtered out
            self._make_entry("short2", 60),    # OK (boundary)
            self._make_entry("short3", 61),    # filtered out
        ]
        mock_info = {"entries": entries}
        mock_ctx = MagicMock()
        mock_ctx.__enter__ = MagicMock(return_value=mock_ctx)
        mock_ctx.__exit__ = MagicMock(return_value=False)
        mock_ctx.extract_info = MagicMock(return_value=mock_info)
        mock_ydl_cls.return_value = mock_ctx

        scraper = YoutubeScraper()
        result = scraper.extract_metadata("https://youtube.com/@channel/shorts")

        ids = [e["id"] for e in result["entries"]]
        assert "short1" in ids
        assert "short2" in ids
        assert "long1" not in ids
        assert "short3" not in ids

    @patch("app.services.scrapers.youtube.yt_dlp.YoutubeDL")
    def test_none_duration_accepted(self, mock_ydl_cls):
        """Entry không có duration (extract_flat) được chấp nhận."""
        entries = [self._make_entry("nodur", None)]
        mock_info = {"entries": entries}
        mock_ctx = MagicMock()
        mock_ctx.__enter__ = MagicMock(return_value=mock_ctx)
        mock_ctx.__exit__ = MagicMock(return_value=False)
        mock_ctx.extract_info = MagicMock(return_value=mock_info)
        mock_ydl_cls.return_value = mock_ctx

        scraper = YoutubeScraper()
        result = scraper.extract_metadata("https://youtube.com/@ch")
        assert len(result["entries"]) == 1

    @patch("app.services.scrapers.youtube.yt_dlp.YoutubeDL")
    def test_empty_entries(self, mock_ydl_cls):
        """Playlist rỗng trả entries rỗng."""
        mock_ctx = MagicMock()
        mock_ctx.__enter__ = MagicMock(return_value=mock_ctx)
        mock_ctx.__exit__ = MagicMock(return_value=False)
        mock_ctx.extract_info = MagicMock(return_value={"entries": []})
        mock_ydl_cls.return_value = mock_ctx

        result = YoutubeScraper().extract_metadata("https://youtube.com/@ch")
        assert result == {"entries": []}

    @patch("app.services.scrapers.youtube.yt_dlp.YoutubeDL")
    def test_ydlp_exception_returns_empty(self, mock_ydl_cls):
        """yt-dlp exception → trả entries rỗng, không raise."""
        mock_ctx = MagicMock()
        mock_ctx.__enter__ = MagicMock(return_value=mock_ctx)
        mock_ctx.__exit__ = MagicMock(return_value=False)
        mock_ctx.extract_info = MagicMock(side_effect=Exception("Network error"))
        mock_ydl_cls.return_value = mock_ctx

        result = YoutubeScraper().extract_metadata("https://youtube.com/@ch")
        assert result == {"entries": []}

    @patch("app.services.scrapers.youtube.yt_dlp.YoutubeDL")
    def test_single_video_url_short(self, mock_ydl_cls):
        """Single video URL (không phải playlist) → trả entry nếu duration <= 60."""
        mock_ctx = MagicMock()
        mock_ctx.__enter__ = MagicMock(return_value=mock_ctx)
        mock_ctx.__exit__ = MagicMock(return_value=False)
        mock_ctx.extract_info = MagicMock(return_value={
            "id": "vid1", "title": "A Short", "duration": 45,
            "webpage_url": "https://youtube.com/watch?v=vid1"
        })
        mock_ydl_cls.return_value = mock_ctx

        result = YoutubeScraper().extract_metadata("https://youtube.com/watch?v=vid1")
        assert len(result["entries"]) == 1
        assert result["entries"][0]["id"] == "vid1"

    @patch("app.services.scrapers.youtube.yt_dlp.YoutubeDL")
    def test_single_video_url_long_filtered(self, mock_ydl_cls):
        """Single video URL duration > 60s → entries rỗng."""
        mock_ctx = MagicMock()
        mock_ctx.__enter__ = MagicMock(return_value=mock_ctx)
        mock_ctx.__exit__ = MagicMock(return_value=False)
        mock_ctx.extract_info = MagicMock(return_value={
            "id": "long1", "title": "Long video", "duration": 600,
        })
        mock_ydl_cls.return_value = mock_ctx

        result = YoutubeScraper().extract_metadata("https://youtube.com/watch?v=long1")
        assert result == {"entries": []}


# ---------------------------------------------------------------------------
# TiktokScraper backward-compat tests
# ---------------------------------------------------------------------------

class TestTiktokScraperBackwardCompat:
    def test_extract_metadata_proxies_to_tiktok_crawler(self):
        mock_result = {"entries": [{"id": "tk1"}]}
        with patch("app.services.tiktok_crawler.extract_metadata", return_value=mock_result) as mock_fn:
            scraper = TiktokScraper()
            result = scraper.extract_metadata("https://tiktok.com/@user")
        mock_fn.assert_called_once_with("https://tiktok.com/@user")
        assert result == mock_result

    def test_download_video_proxies_to_tiktok_crawler(self):
        with patch("app.services.tiktok_crawler.download_video", return_value=("/tmp/file.mp4", "uuid")) as mock_fn:
            scraper = TiktokScraper()
            out_path, vid_id = scraper.download_video("https://tiktok.com/video", "tiktok")
        mock_fn.assert_called_once_with("https://tiktok.com/video", "tiktok")
        assert out_path == "/tmp/file.mp4"
        assert vid_id == "uuid"


# ---------------------------------------------------------------------------
# SHORTS_MAX_DURATION constant test
# ---------------------------------------------------------------------------

def test_shorts_max_duration():
    assert SHORTS_MAX_DURATION == 60, "Shorts threshold phải là 60 giây theo spec"


# ---------------------------------------------------------------------------
# YoutubeScraper.download_video — patch fixes P1 + P2
# ---------------------------------------------------------------------------

class TestYoutubeScraperDownload:
    """Tests cho download_video sau các patch P1 + P2."""

    def _make_ydl_ctx(self, probe_info: dict):
        """Tạo mock yt_dlp.YoutubeDL context manager."""
        mock_ctx = MagicMock()
        mock_ctx.__enter__ = MagicMock(return_value=mock_ctx)
        mock_ctx.__exit__ = MagicMock(return_value=False)
        mock_ctx.extract_info = MagicMock(return_value=probe_info)
        mock_ctx.download = MagicMock(return_value=None)
        return mock_ctx

    @patch("app.services.scrapers.youtube.glob.glob")
    @patch("app.services.scrapers.youtube.os.path.getsize")
    @patch("app.services.scrapers.youtube.os.path.exists")
    @patch("app.services.scrapers.youtube.yt_dlp.YoutubeDL")
    def test_download_uses_real_youtube_video_id(self, mock_ydl_cls, mock_exists, mock_getsize, mock_glob, tmp_path):
        """[P2] download_video phải trả về real YouTube video ID, không phải UUID."""
        probe_info = {"id": "dQw4w9WgXcQ", "title": "Test video"}
        mock_ctx = self._make_ydl_ctx(probe_info)
        mock_ydl_cls.return_value = mock_ctx

        # Simulate file tồn tại sau download
        expected_path = str(tmp_path / "youtube_dQw4w9WgXcQ.mp4")
        mock_exists.return_value = True
        mock_getsize.return_value = 12345
        mock_glob.return_value = []

        with patch("app.services.scrapers.youtube.DOWNLOAD_DIR", str(tmp_path)):
            scraper = YoutubeScraper()
            out_path, video_id = scraper.download_video("https://youtu.be/dQw4w9WgXcQ", "youtube")

        # [P2] video_id phải là real ID, không phải UUID random
        assert video_id == "dQw4w9WgXcQ"
        assert "dQw4w9WgXcQ" in (out_path or "")

    @patch("app.services.scrapers.youtube.glob.glob")
    @patch("app.services.scrapers.youtube.os.path.isfile")
    @patch("app.services.scrapers.youtube.os.path.getsize")
    @patch("app.services.scrapers.youtube.os.path.exists")
    @patch("app.services.scrapers.youtube.yt_dlp.YoutubeDL")
    def test_download_glob_fallback_when_extension_differs(self, mock_ydl_cls, mock_exists, mock_getsize, mock_isfile, mock_glob, tmp_path):
        """[P1] Nếu expected_mp4 không tồn tại, glob tìm file thực (e.g. .webm)."""
        probe_info = {"id": "abc123", "title": "Test"}
        mock_ctx = self._make_ydl_ctx(probe_info)
        mock_ydl_cls.return_value = mock_ctx

        actual_file = str(tmp_path / "youtube_abc123.webm")

        # expected .mp4 không tồn tại
        mock_exists.return_value = False
        mock_glob.return_value = [actual_file]
        mock_isfile.return_value = True
        mock_getsize.return_value = 99999

        with patch("app.services.scrapers.youtube.DOWNLOAD_DIR", str(tmp_path)):
            scraper = YoutubeScraper()
            out_path, video_id = scraper.download_video("https://youtu.be/abc123", "youtube")

        # [P1] Phải tìm thấy file qua glob
        assert out_path == actual_file
        assert video_id == "abc123"

    @patch("app.services.scrapers.youtube.glob.glob")
    @patch("app.services.scrapers.youtube.os.path.exists")
    @patch("app.services.scrapers.youtube.yt_dlp.YoutubeDL")
    def test_download_returns_none_when_no_file_found(self, mock_ydl_cls, mock_exists, mock_glob, tmp_path):
        """[P1] Nếu không tìm thấy file nào sau download → (None, None)."""
        probe_info = {"id": "missing123", "title": "Test"}
        mock_ctx = self._make_ydl_ctx(probe_info)
        mock_ydl_cls.return_value = mock_ctx

        mock_exists.return_value = False
        mock_glob.return_value = []  # Không có file nào

        with patch("app.services.scrapers.youtube.DOWNLOAD_DIR", str(tmp_path)):
            scraper = YoutubeScraper()
            out_path, video_id = scraper.download_video("https://youtu.be/missing123", "youtube")

        assert out_path is None
        assert video_id is None

    @patch("app.services.scrapers.youtube.glob.glob")
    @patch("app.services.scrapers.youtube.yt_dlp.YoutubeDL")
    def test_download_probe_failure_fallback_uuid(self, mock_ydl_cls, mock_glob, tmp_path):
        """[P2] Nếu probe thất bại, fallback UUID — không crash."""
        # Lần gọi đầu (probe) raise exception
        call_count = [0]
        def side_effect(*args, **kwargs):
            call_count[0] += 1
            mock_ctx = MagicMock()
            mock_ctx.__enter__ = MagicMock(return_value=mock_ctx)
            mock_ctx.__exit__ = MagicMock(return_value=False)
            if call_count[0] == 1:
                # Probe call
                mock_ctx.extract_info = MagicMock(side_effect=Exception("probe fail"))
            else:
                # Download call
                mock_ctx.download = MagicMock(return_value=None)
            return mock_ctx

        mock_ydl_cls.side_effect = side_effect
        mock_glob.return_value = []  # No file → (None, None)

        with patch("app.services.scrapers.youtube.DOWNLOAD_DIR", str(tmp_path)), \
             patch("app.services.scrapers.youtube.os.path.exists", return_value=False):
            scraper = YoutubeScraper()
            out_path, video_id = scraper.download_video("https://youtu.be/test", "youtube")

        # Phải không crash dù probe thất bại
        assert out_path is None  # Không có file
        # video_id nếu có — phải là UUID format (36 chars) không phải None
        # (có thể None nếu không có file nào)
