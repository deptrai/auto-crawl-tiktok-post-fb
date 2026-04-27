"""Unit tests cho apify_crawler và tiktok_crawler (AC1-5)."""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch, mock_open

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_apify_item(video_id: str = "7001234567890", caption: str = "Test caption #hashtag"):
    """Mock item tương thích cả clockworks lẫn kingscraper output format."""
    return {
        "id": video_id,
        # clockworks field (shouldDownloadVideos=True)
        "downloadLink": f"https://cdn.tiktok.example.com/{video_id}.mp4",
        # kingscraper fields (fallback)
        "noWatermarkHdUrl": f"https://cdn.tiktok.example.com/{video_id}_hd.mp4",
        "noWatermarkSdUrl": f"https://cdn.tiktok.example.com/{video_id}_sd.mp4",
        # clockworks caption field
        "text": caption,
        "description": caption,
        "title": caption,
        "webVideoUrl": f"https://www.tiktok.com/@testuser/video/{video_id}",
        "authorMeta": {"name": "testuser"},
    }


# ---------------------------------------------------------------------------
# AC1: Apify client integration — extract_metadata_apify
# ---------------------------------------------------------------------------

class TestExtractMetadataApify:
    def test_single_video_url_calls_apify_actor(self, tmp_path):
        """AC1: Single video URL gửi thẳng tới Apify actor."""
        mock_item = _mock_apify_item()

        mock_dataset = MagicMock()
        mock_dataset.list_items.return_value.items = [mock_item]

        mock_run = {"defaultDatasetId": "ds-123"}

        mock_actor = MagicMock()
        mock_actor.call.return_value = mock_run

        mock_client = MagicMock()
        mock_client.actor.return_value = mock_actor
        mock_client.dataset.return_value = mock_dataset

        from app.services import apify_crawler

        # ApifyClient là lazy import bên trong _get_client() → patch qua _get_client
        with patch.object(apify_crawler, "_get_client", return_value=mock_client), \
             patch.object(apify_crawler.settings, "APIFY_ACTOR_ID",
                          "kingscraper/tiktok-video-and-thumbnail-downloader"):
            result = apify_crawler.extract_metadata_apify(
                "https://www.tiktok.com/@testuser/video/7001234567890"
            )

        assert "entries" in result
        assert len(result["entries"]) == 1
        entry = result["entries"][0]
        assert entry["id"] == "7001234567890"
        assert entry["description"] == "Test caption #hashtag"
        # downloadLink (clockworks) có độ ưu tiên cao nhất
        assert entry["_apify_download_url"] == "https://cdn.tiktok.example.com/7001234567890.mp4"

    def test_missing_token_raises_value_error(self):
        """AC1: Raise ValueError nếu APIFY_API_TOKEN chưa cấu hình."""
        from app.services import apify_crawler
        with patch.object(apify_crawler.settings, "APIFY_API_TOKEN", ""):
            with pytest.raises(ValueError, match="APIFY_API_TOKEN"):
                apify_crawler._get_client()

    def test_returns_entries_with_required_fields(self, tmp_path):
        """AC1: Mỗi entry phải có id, webpage_url, description, _apify_download_url."""
        mock_items = [_mock_apify_item(f"700{i}", f"Caption {i}") for i in range(3)]

        mock_dataset = MagicMock()
        mock_dataset.list_items.return_value.items = mock_items
        mock_run = {"defaultDatasetId": "ds-456"}
        mock_actor = MagicMock()
        mock_actor.call.return_value = mock_run
        mock_client = MagicMock()
        mock_client.actor.return_value = mock_actor
        mock_client.dataset.return_value = mock_dataset

        from app.services import apify_crawler
        with patch.object(apify_crawler, "_get_client", return_value=mock_client), \
             patch.object(apify_crawler, "_is_profile_url", return_value=False):
            result = apify_crawler.extract_metadata_apify("https://www.tiktok.com/@u/video/123")

        assert len(result["entries"]) == 3
        for entry in result["entries"]:
            assert "id" in entry
            assert "webpage_url" in entry
            assert "description" in entry
            assert "_apify_download_url" in entry


# ---------------------------------------------------------------------------
# AC2: Download video từ Apify URL
# ---------------------------------------------------------------------------

class TestDownloadVideoApify:
    def test_download_success(self, tmp_path):
        """AC2: Download file MP4 từ Apify CDN URL thành công."""
        fake_content = b"fake_mp4_content_bytes"

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.iter_content.return_value = [fake_content]
        mock_resp.raise_for_status = MagicMock()
        mock_resp.headers = {"Content-Type": "video/mp4"}

        with patch("app.services.apify_crawler.requests.get", return_value=mock_resp), \
             patch("app.services.apify_crawler.settings") as mock_settings:
            mock_settings.DOWNLOAD_DIR = str(tmp_path)
            mock_settings.APIFY_API_TOKEN = ""

            from app.services import apify_crawler
            out_path, video_id = apify_crawler.download_video_apify(
                "https://v19-webapp.tiktok.com/video.mp4",
                "tiktok"
            )

        assert out_path is not None
        assert video_id is not None
        assert Path(out_path).exists()
        assert Path(out_path).read_bytes() == fake_content

    def test_download_fails_returns_none(self, tmp_path):
        """AC2: Trả về (None, None) khi download thất bại."""
        with patch("app.services.apify_crawler.requests.get", side_effect=Exception("Network error")), \
             patch("app.services.apify_crawler.settings") as mock_settings:
            mock_settings.DOWNLOAD_DIR = str(tmp_path)
            mock_settings.APIFY_API_TOKEN = ""

            from app.services import apify_crawler
            out_path, video_id = apify_crawler.download_video_apify(
                "https://v19-webapp.tiktok.com/broken.mp4",
                "tiktok"
            )

        assert out_path is None
        assert video_id is None

    def test_empty_url_returns_none(self, tmp_path):
        """AC2: URL rỗng → (None, None) ngay lập tức."""
        from app.services import apify_crawler
        out_path, video_id = apify_crawler.download_video_apify("", "tiktok")
        assert out_path is None
        assert video_id is None


# ---------------------------------------------------------------------------
# AC3: Fallback yt-dlp khi Apify fail
# ---------------------------------------------------------------------------

class TestTiktokCrawlerFallback:
    def test_auto_mode_falls_back_to_ytdlp_when_apify_fails(self):
        """AC3: Mode 'auto' fallback sang yt-dlp khi Apify raise exception."""
        from app.services import tiktok_crawler

        with patch.object(tiktok_crawler.settings, "TIKTOK_CRAWLER_MODE", "auto"), \
             patch.object(tiktok_crawler.settings, "APIFY_API_TOKEN", "some-token"), \
             patch("app.services.tiktok_crawler._extract_via_apify",
                   side_effect=Exception("Apify down")), \
             patch("app.services.tiktok_crawler._extract_via_ytdlp",
                   return_value={"id": "123", "title": "test"}) as mock_ytdlp:
            result = tiktok_crawler.extract_metadata("https://www.tiktok.com/@u/video/123")

        mock_ytdlp.assert_called_once()
        assert result["id"] == "123"

    def test_auto_mode_uses_apify_when_token_set(self):
        """AC3: Mode 'auto' dùng Apify khi token có và thành công."""
        from app.services import tiktok_crawler

        mock_result = {"entries": [{"id": "456", "description": "test"}]}

        with patch.object(tiktok_crawler.settings, "TIKTOK_CRAWLER_MODE", "auto"), \
             patch.object(tiktok_crawler.settings, "APIFY_API_TOKEN", "some-token"), \
             patch("app.services.tiktok_crawler._extract_via_apify",
                   return_value=mock_result) as mock_apify, \
             patch("app.services.tiktok_crawler._extract_via_ytdlp") as mock_ytdlp:
            result = tiktok_crawler.extract_metadata("https://www.tiktok.com/@u/video/456")

        mock_apify.assert_called_once()
        mock_ytdlp.assert_not_called()
        assert result["entries"][0]["id"] == "456"

    def test_ytdlp_mode_skips_apify(self):
        """AC3: Mode 'ytdlp' không bao giờ gọi Apify."""
        from app.services import tiktok_crawler

        with patch.object(tiktok_crawler.settings, "TIKTOK_CRAWLER_MODE", "ytdlp"), \
             patch("app.services.tiktok_crawler._extract_via_apify") as mock_apify, \
             patch("app.services.tiktok_crawler._extract_via_ytdlp",
                   return_value={"id": "789"}) as mock_ytdlp:
            result = tiktok_crawler.extract_metadata("https://www.tiktok.com/@u/video/789")

        mock_apify.assert_not_called()
        mock_ytdlp.assert_called_once()

    def test_auto_mode_no_token_skips_apify(self):
        """AC3: Mode 'auto' nhưng không có token → đi thẳng yt-dlp."""
        from app.services import tiktok_crawler

        with patch.object(tiktok_crawler.settings, "TIKTOK_CRAWLER_MODE", "auto"), \
             patch.object(tiktok_crawler.settings, "APIFY_API_TOKEN", ""), \
             patch("app.services.tiktok_crawler._extract_via_apify") as mock_apify, \
             patch("app.services.tiktok_crawler._extract_via_ytdlp",
                   return_value={"id": "000"}) as mock_ytdlp:
            result = tiktok_crawler.extract_metadata("https://www.tiktok.com/@u/video/000")

        mock_apify.assert_not_called()
        mock_ytdlp.assert_called_once()


# ---------------------------------------------------------------------------
# AC4: Config vars
# ---------------------------------------------------------------------------

class TestConfig:
    def test_settings_has_apify_fields(self):
        """AC4: Settings class có đủ 3 biến Apify."""
        from app.core.config import settings
        assert hasattr(settings, "APIFY_API_TOKEN")
        assert hasattr(settings, "APIFY_ACTOR_ID")
        assert hasattr(settings, "TIKTOK_CRAWLER_MODE")

    def test_default_actor_id(self):
        """AC4: Settings có APIFY_ACTOR_ID và là string hợp lệ (format owner/name)."""
        from app.core.config import settings
        assert isinstance(settings.APIFY_ACTOR_ID, str)
        assert "/" in settings.APIFY_ACTOR_ID  # format: owner/actor-name

    def test_default_crawler_mode(self):
        """AC4: Default mode là 'auto' hoặc được override qua env."""
        from app.core.config import settings
        assert settings.TIKTOK_CRAWLER_MODE in ("auto", "apify", "ytdlp")


# ---------------------------------------------------------------------------
# AC5: Backward compatibility — tiktok_crawler export giống ytdlp_crawler
# ---------------------------------------------------------------------------

class TestBackwardCompatibility:
    def test_tiktok_crawler_exports_extract_metadata(self):
        """AC5: tiktok_crawler export hàm extract_metadata."""
        from app.services import tiktok_crawler
        assert callable(tiktok_crawler.extract_metadata)

    def test_tiktok_crawler_exports_download_video(self):
        """AC5: tiktok_crawler export hàm download_video."""
        from app.services import tiktok_crawler
        assert callable(tiktok_crawler.download_video)

    def test_campaign_jobs_imports_from_tiktok_crawler(self):
        """AC5: campaign_jobs.py import từ tiktok_crawler (không phải ytdlp_crawler)."""
        import inspect
        from app.services import campaign_jobs
        source = inspect.getsource(campaign_jobs)
        assert "from app.services.tiktok_crawler import" in source
        assert "from app.services.ytdlp_crawler import download_video" not in source

    def test_download_video_returns_tuple(self, tmp_path):
        """AC5: download_video trả về tuple (path|None, id|None)."""
        from app.services import tiktok_crawler

        with patch.object(tiktok_crawler.settings, "TIKTOK_CRAWLER_MODE", "ytdlp"), \
             patch("app.services.tiktok_crawler._download_via_ytdlp",
                   return_value=(None, None)):
            result = tiktok_crawler.download_video("https://www.tiktok.com/@u/video/1", "tiktok")

        assert isinstance(result, tuple)
        assert len(result) == 2
