"""Story 9.3: Unit tests cho CrossCampaignDedup filter.

Coverage:
- AC1: CrossCampaignDedup rejects video 'posted' trên cùng target_page từ campaign khác
- AC2: Tích hợp pipeline — CrossCampaignDedup là filter thứ 3
- AC3: Status logic — posted/ready/downloading/pending → reject; failed → accept
- AC4: Sync report có filtered_by_dedup count (tested via campaign_jobs integration)
- AC5: Edge cases — không target_page_id → bypass; cùng campaign → KHÔNG check
"""
from __future__ import annotations

from unittest.mock import patch

from app.models.models import Campaign, CampaignStatus, Video, VideoStatus
from app.services.content_filter import (
    CrossCampaignDedup,
    get_default_filters,
    run_filters,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_campaign(
    db,
    *,
    name: str = "campaign-a",
    target_page_id: str | None = "page-123",
) -> Campaign:
    """Tạo Campaign record trong DB."""
    c = Campaign(
        name=name,
        source_url="https://www.tiktok.com/@x",
        status=CampaignStatus.active,
        target_page_id=target_page_id,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _create_video(
    db,
    *,
    campaign: Campaign,
    original_id: str = "vid-001",
    status: VideoStatus = VideoStatus.posted,
) -> Video:
    """Tạo Video record trong DB."""
    v = Video(
        campaign_id=campaign.id,
        original_id=original_id,
        source_video_url="https://tiktok.com/@x/video/001",
        status=status,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


def _entry(original_id: str = "vid-001", **extra) -> dict:
    """Tạo entry dict tương tự yt-dlp / Apify output."""
    return {"id": original_id, **extra}


# ---------------------------------------------------------------------------
# Task 4.1: Video 'posted' trên cùng page → REJECT
# ---------------------------------------------------------------------------

class TestCrossCampaignDedupReject:
    def test_rejects_posted_video_on_same_page(self, db_session):
        """AC1 + AC3: Video 'posted' từ campaign khác trên cùng page → rejected."""
        page_id = "page-111"
        campaign_a = _create_campaign(db_session, name="campaign-a", target_page_id=page_id)
        campaign_b = _create_campaign(db_session, name="campaign-b", target_page_id=page_id)

        # campaign_a đã post video vid-001 lên page-111
        _create_video(db_session, campaign=campaign_a, original_id="vid-001", status=VideoStatus.posted)

        # campaign_b cố sync cùng video → nên bị reject
        dedup = CrossCampaignDedup(db_session)
        result = dedup.apply(_entry("vid-001"), campaign_b)

        assert result.accepted is False
        assert result.filter_name == "cross_campaign_dedup"
        assert "cross_campaign_duplicate" in (result.reason or "")
        assert "campaign-a" in (result.reason or "")

    # ------------------------------------------------------------------
    # Task 4.3: ready / downloading / pending → REJECT
    # ------------------------------------------------------------------

    def test_rejects_ready_video_on_same_page(self, db_session):
        """AC3: Status 'ready' → rejected (sẽ đăng sớm)."""
        page_id = "page-222"
        campaign_a = _create_campaign(db_session, name="campaign-a", target_page_id=page_id)
        campaign_b = _create_campaign(db_session, name="campaign-b", target_page_id=page_id)

        _create_video(db_session, campaign=campaign_a, original_id="vid-002", status=VideoStatus.ready)

        dedup = CrossCampaignDedup(db_session)
        result = dedup.apply(_entry("vid-002"), campaign_b)

        assert result.accepted is False
        assert result.filter_name == "cross_campaign_dedup"

    def test_rejects_downloading_video_on_same_page(self, db_session):
        """AC3: Status 'downloading' → rejected."""
        page_id = "page-333"
        campaign_a = _create_campaign(db_session, name="campaign-a", target_page_id=page_id)
        campaign_b = _create_campaign(db_session, name="campaign-b", target_page_id=page_id)

        _create_video(db_session, campaign=campaign_a, original_id="vid-003", status=VideoStatus.downloading)

        dedup = CrossCampaignDedup(db_session)
        result = dedup.apply(_entry("vid-003"), campaign_b)

        assert result.accepted is False
        assert result.filter_name == "cross_campaign_dedup"

    def test_rejects_pending_video_on_same_page(self, db_session):
        """AC3: Status 'pending' → rejected."""
        page_id = "page-444"
        campaign_a = _create_campaign(db_session, name="campaign-a", target_page_id=page_id)
        campaign_b = _create_campaign(db_session, name="campaign-b", target_page_id=page_id)

        _create_video(db_session, campaign=campaign_a, original_id="vid-004", status=VideoStatus.pending)

        dedup = CrossCampaignDedup(db_session)
        result = dedup.apply(_entry("vid-004"), campaign_b)

        assert result.accepted is False
        assert result.filter_name == "cross_campaign_dedup"


# ---------------------------------------------------------------------------
# Task 4.2: Video 'failed' trên cùng page → ACCEPT (cho retry)
# ---------------------------------------------------------------------------

class TestCrossCampaignDedupAccept:
    def test_accepts_failed_video_on_same_page(self, db_session):
        """AC3: Video 'failed' → accepted (campaign mới được retry)."""
        page_id = "page-555"
        campaign_a = _create_campaign(db_session, name="campaign-a", target_page_id=page_id)
        campaign_b = _create_campaign(db_session, name="campaign-b", target_page_id=page_id)

        _create_video(db_session, campaign=campaign_a, original_id="vid-005", status=VideoStatus.failed)

        dedup = CrossCampaignDedup(db_session)
        result = dedup.apply(_entry("vid-005"), campaign_b)

        assert result.accepted is True
        assert result.filter_name == "cross_campaign_dedup"

    # ------------------------------------------------------------------
    # Task 4.4: Video trên page KHÁC → ACCEPT
    # ------------------------------------------------------------------

    def test_accepts_video_on_different_page(self, db_session):
        """AC5: Video đã post trên Page A → campaign targeting Page B vẫn accept."""
        campaign_a = _create_campaign(db_session, name="campaign-a", target_page_id="page-A")
        campaign_b = _create_campaign(db_session, name="campaign-b", target_page_id="page-B")

        # campaign_a đã post vid-006 lên page-A
        _create_video(db_session, campaign=campaign_a, original_id="vid-006", status=VideoStatus.posted)

        # campaign_b target page-B → khác page → OK
        dedup = CrossCampaignDedup(db_session)
        result = dedup.apply(_entry("vid-006"), campaign_b)

        assert result.accepted is True

    def test_accepts_no_duplicate_at_all(self, db_session):
        """Không có video nào trùng → accepted."""
        campaign_a = _create_campaign(db_session, name="campaign-a", target_page_id="page-X")
        dedup = CrossCampaignDedup(db_session)
        result = dedup.apply(_entry("vid-999"), campaign_a)
        assert result.accepted is True

    # ------------------------------------------------------------------
    # Task 4.5: Không có target_page_id → bypass hoàn toàn
    # ------------------------------------------------------------------

    def test_bypass_when_no_target_page_id(self, db_session):
        """AC5: campaign chưa assign page → bypass dedup, luôn accepted."""
        campaign_no_page = _create_campaign(db_session, name="no-page-campaign", target_page_id=None)
        campaign_with_page = _create_campaign(db_session, name="other-campaign", target_page_id="page-Z")

        # Giả sử video vid-007 đã posted bởi campaign_with_page lên page-Z
        _create_video(db_session, campaign=campaign_with_page, original_id="vid-007", status=VideoStatus.posted)

        # campaign_no_page không có page → bypass (không query DB)
        dedup = CrossCampaignDedup(db_session)
        result = dedup.apply(_entry("vid-007"), campaign_no_page)

        assert result.accepted is True

    def test_bypass_empty_original_id(self, db_session):
        """Edge case: entry không có 'id' field → bypass."""
        campaign = _create_campaign(db_session, name="campaign-x", target_page_id="page-X")
        dedup = CrossCampaignDedup(db_session)
        result = dedup.apply({}, campaign)  # entry không có 'id'
        assert result.accepted is True

    def test_same_campaign_not_counted_as_cross_campaign(self, db_session):
        """Within-campaign video KHÔNG trigger cross-campaign dedup."""
        page_id = "page-SAME"
        campaign_a = _create_campaign(db_session, name="campaign-a", target_page_id=page_id)

        # campaign_a tự post vid-008 → cross-campaign dedup KHÔNG check cùng campaign
        _create_video(db_session, campaign=campaign_a, original_id="vid-008", status=VideoStatus.posted)

        dedup = CrossCampaignDedup(db_session)
        # Sync lại từ campaign_a → should be accepted by cross-campaign dedup
        # (within-campaign dedup là layer riêng trong campaign_jobs.py)
        result = dedup.apply(_entry("vid-008"), campaign_a)

        assert result.accepted is True  # cross-campaign dedup skip cùng campaign


# ---------------------------------------------------------------------------
# Task 4.6: Full pipeline chain — QualityFilter + KeywordFilter + CrossCampaignDedup
# ---------------------------------------------------------------------------

class TestFullPipelineChain:
    def test_pipeline_dedup_comes_after_quality_and_keyword(self, db_session):
        """AC2: Pipeline chain đúng thứ tự — CrossCampaignDedup là cuối cùng."""
        filters = get_default_filters(db=db_session)

        assert len(filters) >= 3
        assert filters[0].name == "quality"
        assert filters[1].name == "keyword"
        assert filters[2].name == "cross_campaign_dedup"

    def test_quality_rejection_before_dedup_is_checked(self, db_session):
        """AC2: Short-circuit — quality rejection → dedup KHÔNG được gọi."""
        page_id = "page-pipeline"
        campaign_a = _create_campaign(db_session, name="campaign-a", target_page_id=page_id)
        campaign_b = _create_campaign(db_session, name="campaign-b", target_page_id=page_id)
        campaign_b.filter_min_views = 100_000  # high threshold
        db_session.commit()

        _create_video(db_session, campaign=campaign_a, original_id="vid-q-001", status=VideoStatus.posted)

        filters = get_default_filters(db=db_session)
        entry = _entry("vid-q-001", view_count=500)  # thấp hơn threshold
        result = run_filters(entry, campaign_b, filters)

        assert result.accepted is False
        assert result.filter_name == "quality"  # bị reject bởi quality, không phải dedup

    def test_dedup_rejects_in_full_pipeline(self, db_session):
        """AC2: Qua được quality + keyword → CrossCampaignDedup reject cross-campaign."""
        page_id = "page-full"
        campaign_a = _create_campaign(db_session, name="campaign-a", target_page_id=page_id)
        campaign_b = _create_campaign(db_session, name="campaign-b", target_page_id=page_id)
        # campaign_b không có filter thresholds → quality và keyword pass

        _create_video(db_session, campaign=campaign_a, original_id="vid-full-001", status=VideoStatus.posted)

        filters = get_default_filters(db=db_session)
        entry = _entry("vid-full-001", view_count=999_999)
        result = run_filters(entry, campaign_b, filters)

        assert result.accepted is False
        assert result.filter_name == "cross_campaign_dedup"

    def test_full_pipeline_accepts_clean_entry(self, db_session):
        """AC2: Entry không trùng → pipeline accept."""
        campaign = _create_campaign(db_session, name="campaign-clean", target_page_id="page-clean")

        filters = get_default_filters(db=db_session)
        entry = _entry("vid-brand-new", view_count=100_000)
        result = run_filters(entry, campaign, filters)

        assert result.accepted is True


# ---------------------------------------------------------------------------
# Task 4.7: Sync report — filtered_by_dedup count (integration via campaign_jobs)
# ---------------------------------------------------------------------------

class TestSyncReportDedupCount:
    def test_sync_report_includes_filtered_by_dedup(self, db_session):
        """AC4: sync_campaign_content ghi event details chứa filtered_by_dedup.

        Approach: mock extract_metadata + download_video để tránh network call.
        Verify record_event được gọi với filtered_by_dedup trong details.
        """
        from app.services.campaign_jobs import sync_campaign_content

        page_id = "page-report"
        # Tạo 2 campaigns target cùng page
        campaign_a = _create_campaign(db_session, name="report-campaign-a", target_page_id=page_id)
        campaign_b = _create_campaign(db_session, name="report-campaign-b", target_page_id=page_id)

        # campaign_a đã posted vid-report-001 lên page-report
        _create_video(
            db_session,
            campaign=campaign_a,
            original_id="vid-report-001",
            status=VideoStatus.posted,
        )

        # Sync campaign_b — sẽ gặp vid-report-001 → bị dedup reject
        mock_entries = [{"id": "vid-report-001", "webpage_url": "https://tiktok.com/1", "title": "Test"}]

        recorded_events: list[dict] = []

        def capture_record_event(scope, level, message, db=None, details=None):
            recorded_events.append({"scope": scope, "level": level, "message": message, "details": details or {}})

        with (
            patch("app.services.campaign_jobs.extract_metadata", return_value={"entries": mock_entries}),
            patch("app.services.campaign_jobs.download_video", return_value=(None, None)),
            patch("app.services.campaign_jobs.record_event", side_effect=capture_record_event),
        ):
            result = sync_campaign_content(str(campaign_b.id), "https://tiktok.com/@x")

        assert result["ok"] is True

        # Tìm completion event
        completion_events = [e for e in recorded_events if "hoàn tất" in e["message"]]
        assert len(completion_events) >= 1

        details = completion_events[0]["details"]
        assert "filtered_by_dedup" in details, f"Thiếu filtered_by_dedup trong {details}"
        assert details["filtered_by_dedup"] == 1
        assert details["filtered_total"] >= 1
