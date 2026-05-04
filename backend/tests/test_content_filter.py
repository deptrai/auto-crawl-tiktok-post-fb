"""Story 9.1: Unit tests cho content_filter service và Campaign filter fields.

Coverage:
- AC1: QualityFilter rejects videos below min_views threshold
- AC2: QualityFilter rejects videos below min_likes threshold
- AC3: Both thresholds = 0 → filter is no-op (accepts everything)
- AC4: run_filters() short-circuits on first rejection
- AC5: Campaign model has new filter columns; API persists them; PATCH updates them
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.core.database import SessionLocal
from app.models.models import Campaign, CampaignStatus
from app.services.content_filter import (
    ContentFilter,
    FilterResult,
    QualityFilter,
    get_default_filters,
    run_filters,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_campaign(min_views: int = 0, min_likes: int = 0) -> Campaign:
    """In-memory Campaign instance — không cần DB."""
    return Campaign(
        name="test-campaign",
        source_url="https://www.tiktok.com/@x",
        status=CampaignStatus.active,
        filter_min_views=min_views,
        filter_min_likes=min_likes,
    )


def _entry(view_count: int = 0, like_count: int = 0, **extra) -> dict:
    return {
        "id": "vid-1",
        "view_count": view_count,
        "like_count": like_count,
        **extra,
    }


# ---------------------------------------------------------------------------
# QualityFilter — direct unit tests
# ---------------------------------------------------------------------------

class TestQualityFilter:
    def test_accepts_when_both_thresholds_zero(self):
        """AC3: filter_min_views=0 và filter_min_likes=0 → không lọc gì."""
        f = QualityFilter()
        result = f.apply(_entry(view_count=10, like_count=5), _make_campaign(0, 0))
        assert result.accepted is True
        assert result.reason is None
        assert result.filter_name == "quality"

    def test_rejects_when_views_below_threshold(self):
        """AC1: views < min_views → reject với reason rõ ràng."""
        f = QualityFilter()
        result = f.apply(_entry(view_count=500), _make_campaign(min_views=1000))
        assert result.accepted is False
        assert result.reason is not None
        assert "min_views_not_met" in result.reason
        assert "500" in result.reason
        assert "1000" in result.reason

    def test_accepts_when_views_meet_threshold(self):
        f = QualityFilter()
        result = f.apply(_entry(view_count=1000), _make_campaign(min_views=1000))
        assert result.accepted is True

    def test_rejects_when_likes_below_threshold(self):
        """AC2: likes < min_likes → reject."""
        f = QualityFilter()
        result = f.apply(
            _entry(view_count=100000, like_count=50),
            _make_campaign(min_likes=100),
        )
        assert result.accepted is False
        assert "min_likes_not_met" in result.reason

    def test_accepts_when_likes_meet_threshold(self):
        f = QualityFilter()
        result = f.apply(
            _entry(view_count=100000, like_count=200),
            _make_campaign(min_views=0, min_likes=100),
        )
        assert result.accepted is True

    def test_views_check_runs_before_likes(self):
        """Views threshold short-circuits trước khi check likes."""
        f = QualityFilter()
        result = f.apply(
            _entry(view_count=10, like_count=10),
            _make_campaign(min_views=1000, min_likes=1000),
        )
        assert result.accepted is False
        assert "min_views_not_met" in result.reason

    def test_handles_missing_engagement_fields(self):
        """Entry không có view_count/like_count → coi như 0 → reject nếu threshold > 0."""
        f = QualityFilter()
        result = f.apply({"id": "x"}, _make_campaign(min_views=100))
        assert result.accepted is False

    def test_handles_none_thresholds(self):
        """None columns (legacy data) → coi như 0, không reject."""
        campaign = _make_campaign()
        campaign.filter_min_views = None
        campaign.filter_min_likes = None
        f = QualityFilter()
        result = f.apply(_entry(view_count=0, like_count=0), campaign)
        assert result.accepted is True


# ---------------------------------------------------------------------------
# run_filters — chain orchestration
# ---------------------------------------------------------------------------

class _AlwaysAccept:
    name = "always-accept"

    def apply(self, entry, campaign):
        return FilterResult(accepted=True, filter_name=self.name)


class _AlwaysReject:
    name = "always-reject"

    def apply(self, entry, campaign):
        return FilterResult(accepted=False, reason="forced", filter_name=self.name)


class TestRunFilters:
    def test_empty_chain_accepts(self):
        result = run_filters({}, _make_campaign(), filters=[])
        assert result.accepted is True

    def test_short_circuits_on_first_rejection(self):
        """AC4: filter chain dừng ngay khi một filter reject."""
        called = MagicMock()

        class _Track(_AlwaysAccept):
            def apply(self, entry, campaign):
                called()
                return super().apply(entry, campaign)

        chain = [_AlwaysReject(), _Track()]
        result = run_filters({}, _make_campaign(), filters=chain)
        assert result.accepted is False
        assert result.reason == "forced"
        called.assert_not_called()

    def test_passes_through_when_all_accept(self):
        chain = [_AlwaysAccept(), _AlwaysAccept()]
        result = run_filters({}, _make_campaign(), filters=chain)
        assert result.accepted is True

    def test_default_filter_chain_includes_quality(self):
        """get_default_filters() chứa QualityFilter (groundwork cho 9.2/9.3)."""
        chain = get_default_filters()
        assert any(isinstance(f, QualityFilter) for f in chain)


# ---------------------------------------------------------------------------
# Campaign model — verify migration columns exist
# ---------------------------------------------------------------------------

class TestCampaignFilterColumns:
    def test_campaign_persists_filter_fields(self, db_session):
        """AC5: filter_min_views và filter_min_likes lưu/đọc đúng từ DB."""
        c = Campaign(
            name="filter-test",
            source_url="https://www.tiktok.com/@x",
            filter_min_views=5000,
            filter_min_likes=50,
        )
        db_session.add(c)
        db_session.commit()
        db_session.refresh(c)

        reloaded = db_session.query(Campaign).filter(Campaign.id == c.id).first()
        assert reloaded.filter_min_views == 5000
        assert reloaded.filter_min_likes == 50

    def test_campaign_filter_defaults_zero(self, db_session):
        """Tạo campaign không truyền filter → default 0."""
        c = Campaign(name="x", source_url="https://www.tiktok.com/@x")
        db_session.add(c)
        db_session.commit()
        db_session.refresh(c)
        assert c.filter_min_views == 0
        assert c.filter_min_likes == 0


# ---------------------------------------------------------------------------
# Campaign API — POST/PATCH/serialize
# ---------------------------------------------------------------------------

class TestCampaignFilterAPI:
    def test_post_campaign_persists_filter_fields(self, client, auth_headers, db_session):
        """POST /campaigns/ với filter_min_views/likes → DB có giá trị đúng."""
        # Cần có một fanpage trước
        from app.models.models import FacebookPage
        page = FacebookPage(page_id="100", page_name="Test", long_lived_access_token="enc")
        db_session.add(page)
        db_session.commit()

        resp = client.post(
            "/campaigns/",
            json={
                "name": "Quality test",
                "source_url": "https://www.tiktok.com/@x",
                "target_page_id": "100",
                "schedule_interval": 30,
                "filter_min_views": 2000,
                "filter_min_likes": 20,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        cid = resp.json()["campaign_id"]

        import uuid as _uuid
        with SessionLocal() as s:
            campaign = s.query(Campaign).filter(Campaign.id == _uuid.UUID(cid)).first()
            assert campaign is not None
            assert campaign.filter_min_views == 2000
            assert campaign.filter_min_likes == 20

    def test_get_campaigns_includes_filter_fields(self, client, auth_headers, db_session):
        """GET /campaigns/ → response có filter_min_views/filter_min_likes."""
        c = Campaign(
            name="x",
            source_url="https://www.tiktok.com/@x",
            filter_min_views=100,
            filter_min_likes=10,
        )
        db_session.add(c)
        db_session.commit()

        resp = client.get("/campaigns/", headers=auth_headers)
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) >= 1
        target = next((i for i in items if i["name"] == "x"), None)
        assert target is not None
        assert target["filter_min_views"] == 100
        assert target["filter_min_likes"] == 10

    def test_patch_campaign_updates_filter_fields(self, client, auth_headers, db_session):
        """PATCH /campaigns/{id} cập nhật được filter thresholds."""
        c = Campaign(name="patchme", source_url="https://www.tiktok.com/@x")
        db_session.add(c)
        db_session.commit()
        db_session.refresh(c)
        cid = str(c.id)

        resp = client.patch(
            f"/campaigns/{cid}",
            json={"filter_min_views": 999, "filter_min_likes": 9},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["campaign"]["filter_min_views"] == 999
        assert body["campaign"]["filter_min_likes"] == 9

    def test_patch_campaign_partial_update_preserves_other_fields(self, client, auth_headers, db_session):
        c = Campaign(
            name="partial",
            source_url="https://www.tiktok.com/@x",
            filter_min_views=100,
            filter_min_likes=10,
            schedule_interval=30,
        )
        db_session.add(c)
        db_session.commit()
        db_session.refresh(c)
        cid = str(c.id)

        # Chỉ patch filter_min_views
        resp = client.patch(
            f"/campaigns/{cid}",
            json={"filter_min_views": 7777},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()["campaign"]
        assert body["filter_min_views"] == 7777
        assert body["filter_min_likes"] == 10  # giữ nguyên
        assert body["schedule_interval"] == 30

    def test_patch_rejects_unknown_target_page_id(self, client, auth_headers, db_session):
        """F5: target_page_id không tồn tại → 400, không silently bypass."""
        c = Campaign(name="bad-page", source_url="https://www.tiktok.com/@x")
        db_session.add(c)
        db_session.commit()
        db_session.refresh(c)
        cid = str(c.id)

        resp = client.patch(
            f"/campaigns/{cid}",
            json={"target_page_id": "999-not-real"},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    def test_patch_normalizes_empty_target_page_id_to_null(self, client, auth_headers, db_session):
        """F5: empty-string target_page_id → normalize về None thay vì lưu chuỗi rỗng."""
        from app.models.models import FacebookPage
        page = FacebookPage(page_id="200", page_name="Test", long_lived_access_token="enc")
        db_session.add(page)
        c = Campaign(name="clearpage", source_url="https://www.tiktok.com/@x", target_page_id="200")
        db_session.add(c)
        db_session.commit()
        db_session.refresh(c)
        cid = str(c.id)

        resp = client.patch(
            f"/campaigns/{cid}",
            json={"target_page_id": ""},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        body = resp.json()["campaign"]
        assert body["target_page_id"] is None

    def test_patch_ignores_unknown_field(self, client, auth_headers, db_session):
        """F6: extra field trong body bị Pydantic strip; không crash."""
        c = Campaign(name="extra", source_url="https://www.tiktok.com/@x")
        db_session.add(c)
        db_session.commit()
        db_session.refresh(c)
        cid = str(c.id)

        resp = client.patch(
            f"/campaigns/{cid}",
            json={"filter_min_views": 50, "status": "paused", "id": "hijacked"},
            headers=auth_headers,
        )
        # Pydantic v2 mặc định ignore extra fields → 200; whitelist chặn ghi vào model
        assert resp.status_code == 200
        body = resp.json()["campaign"]
        assert body["filter_min_views"] == 50
        # status không được sửa qua PATCH này
        assert body["status"] in ("active",)

    def test_patch_rejects_negative_values(self, client, auth_headers, db_session):
        c = Campaign(name="neg", source_url="https://www.tiktok.com/@x")
        db_session.add(c)
        db_session.commit()
        db_session.refresh(c)
        cid = str(c.id)

        resp = client.patch(
            f"/campaigns/{cid}",
            json={"filter_min_views": -1},
            headers=auth_headers,
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# sync_campaign_content integration — filter behavior + counters
# ---------------------------------------------------------------------------

class TestSyncCampaignFilterIntegration:
    def test_filtered_videos_not_persisted_and_counted(self, db_session):
        """AC4 + F3: video bị filter → KHÔNG tạo Video record, filtered_count tăng."""
        from unittest.mock import patch

        c = Campaign(
            name="sync-filter",
            source_url="https://www.tiktok.com/@x",
            filter_min_views=1000,
            schedule_interval=0,
        )
        db_session.add(c)
        db_session.commit()
        db_session.refresh(c)
        cid = str(c.id)

        entries = [
            {"id": "low", "webpage_url": "https://t.com/v/low", "view_count": 10, "like_count": 1},
            {"id": "high", "webpage_url": "https://t.com/v/high", "view_count": 5000, "like_count": 100},
        ]
        captured_events: list[dict] = []

        def _fake_record(scope, level, message, *, details=None, db=None, actor_user_id=None):
            captured_events.append({"scope": scope, "level": level, "message": message, "details": details or {}})

        from app.services import campaign_jobs
        from app.services.scrapers.tiktok import TiktokScraper

        mock_scraper = MagicMock(spec=TiktokScraper)
        mock_scraper.extract_metadata.return_value = {"entries": entries}
        mock_scraper.download_video.return_value = ("/tmp/x.mp4", "id1")

        with patch("app.services.campaign_jobs.get_scraper", return_value=mock_scraper), \
             patch.object(campaign_jobs, "record_event", side_effect=_fake_record), \
             patch.object(campaign_jobs, "build_source_page_publish_time", return_value=__import__("datetime").datetime.utcnow()):
            campaign_jobs.sync_campaign_content(cid, c.source_url, allow_paused=False)

        # Chỉ có 1 video được lưu (high), low bị filter
        from app.models.models import Video
        with SessionLocal() as s:
            videos = s.query(Video).filter(Video.original_id.in_(["low", "high"])).all()
            ids = {v.original_id for v in videos}
            assert ids == {"high"}, f"Expected only high to persist, got {ids}"

        # Completion event phải có filtered_total=1, videos_added=1
        # Story 9.2: filtered_count split into filtered_by_quality + filtered_by_keyword + filtered_total
        completion = next((e for e in captured_events if "hoàn tất" in e["message"]), None)
        assert completion is not None, f"No completion event in {[e['message'] for e in captured_events]}"
        assert completion["details"]["filtered_total"] == 1
        assert completion["details"]["filtered_by_quality"] == 1
        assert completion["details"]["filtered_by_keyword"] == 0
        assert completion["details"]["videos_added"] == 1

        # AC4 anti-pattern: KHÔNG có per-video event "Video bị lọc"
        per_video_events = [e for e in captured_events if "bị lọc" in e["message"]]
        assert per_video_events == [], f"Per-video filter events leaked: {per_video_events}"


# ---------------------------------------------------------------------------
# Apify crawler — verify engagement fields are surfaced (Task 2 verification)
# ---------------------------------------------------------------------------

class TestApifyEngagementMapping:
    def test_apify_extracts_engagement_metrics(self):
        """extract_metadata_apify map view/like/comment/share counts đúng."""
        from unittest.mock import patch

        mock_run = {"defaultDatasetId": "ds-123", "status": "SUCCEEDED"}
        mock_page = MagicMock()
        mock_page.items = [
            {
                "id": "v1",
                "mediaUrls": ["https://api.apify.com/v2/key-value-stores/x/records/v1.mp4"],
                "text": "caption",
                "webVideoUrl": "https://www.tiktok.com/@u/video/v1",
                "authorMeta": {"name": "u"},
                "playCount": 12345,
                "diggCount": 678,
                "commentCount": 90,
                "shareCount": 11,
                "videoMeta": {"duration": 30},
            }
        ]
        mock_dataset = MagicMock()
        mock_dataset.list_items.return_value = mock_page

        mock_actor = MagicMock()
        mock_actor.call.return_value = mock_run

        mock_client = MagicMock()
        mock_client.actor.return_value = mock_actor
        mock_client.dataset.return_value = mock_dataset

        with patch("app.services.apify_crawler._get_client", return_value=mock_client), \
             patch("app.services.apify_crawler.settings") as mock_settings:
            mock_settings.APIFY_API_TOKEN = "tok"
            mock_settings.APIFY_ACTOR_ID = "clockworks/tiktok-scraper"
            mock_settings.APIFY_ACTOR_TIMEOUT = 60
            from app.services.apify_crawler import extract_metadata_apify
            info = extract_metadata_apify("https://www.tiktok.com/@u")

        assert len(info["entries"]) == 1
        e = info["entries"][0]
        assert e["view_count"] == 12345
        assert e["like_count"] == 678
        assert e["comment_count"] == 90
        assert e["share_count"] == 11
        assert e["duration"] == 30

    def test_apify_falls_back_to_video_meta_for_engagement(self):
        """F7: clockworks đôi khi chỉ trả nested videoMeta; phải fallback đúng."""
        from unittest.mock import patch

        mock_run = {"defaultDatasetId": "ds-9", "status": "SUCCEEDED"}
        mock_page = MagicMock()
        mock_page.items = [
            {
                "id": "v2",
                "mediaUrls": ["https://api.apify.com/v2/key-value-stores/x/records/v2.mp4"],
                "text": "caption",
                "webVideoUrl": "https://www.tiktok.com/@u/video/v2",
                "authorMeta": {"name": "u"},
                # Top-level metrics absent → must fall back to videoMeta.*
                "videoMeta": {
                    "playCount": 9999,
                    "diggCount": 88,
                    "commentCount": 7,
                    "shareCount": 6,
                    "duration": 15,
                },
            }
        ]
        mock_dataset = MagicMock()
        mock_dataset.list_items.return_value = mock_page
        mock_actor = MagicMock()
        mock_actor.call.return_value = mock_run
        mock_client = MagicMock()
        mock_client.actor.return_value = mock_actor
        mock_client.dataset.return_value = mock_dataset

        with patch("app.services.apify_crawler._get_client", return_value=mock_client), \
             patch("app.services.apify_crawler.settings") as mock_settings:
            mock_settings.APIFY_API_TOKEN = "tok"
            mock_settings.APIFY_ACTOR_ID = "clockworks/tiktok-scraper"
            mock_settings.APIFY_ACTOR_TIMEOUT = 60
            from app.services.apify_crawler import extract_metadata_apify
            info = extract_metadata_apify("https://www.tiktok.com/@u")

        e = info["entries"][0]
        assert e["view_count"] == 9999
        assert e["like_count"] == 88
        assert e["comment_count"] == 7
        assert e["share_count"] == 6
        assert e["duration"] == 15
