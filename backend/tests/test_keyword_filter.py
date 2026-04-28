"""Story 9.2: Tests for KeywordFilter, _extract_hashtags, and pipeline integration.

Covers:
- 5.1: Blocklist match → rejected; no match → accepted
- 5.2: Blocklist case-insensitive — "Casino" matches "casino"
- 5.3: Allowlist — has matching hashtag → accepted; no match → rejected
- 5.4: Allowlist rỗng → always accepted (bypass)
- 5.5: Blocklist checked FIRST before allowlist
- 5.6: _extract_hashtags() — extracts all #tags, lowercase, no leading #
- 5.7: Full pipeline chain — QualityFilter + KeywordFilter
- 5.8: API — create campaign với keyword filter fields, verify response
"""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from app.services.content_filter import (
    KeywordFilter,
    QualityFilter,
    FilterResult,
    _extract_hashtags,
    get_default_filters,
    run_filters,
)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def make_campaign(
    filter_min_views: int = 0,
    filter_min_likes: int = 0,
    filter_blocklist_keywords: list[str] | None = None,
    filter_allowlist_hashtags: list[str] | None = None,
):
    """Return a mock Campaign with the given filter settings."""
    campaign = MagicMock()
    campaign.filter_min_views = filter_min_views
    campaign.filter_min_likes = filter_min_likes
    campaign.filter_blocklist_keywords = filter_blocklist_keywords if filter_blocklist_keywords is not None else []
    campaign.filter_allowlist_hashtags = filter_allowlist_hashtags if filter_allowlist_hashtags is not None else []
    return campaign


def make_entry(description: str = "", view_count: int = 0, like_count: int = 0):
    """Return a minimal video entry dict."""
    return {
        "id": "test_video_id",
        "description": description,
        "view_count": view_count,
        "like_count": like_count,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 5.6: _extract_hashtags()
# ─────────────────────────────────────────────────────────────────────────────

class TestExtractHashtags:
    def test_basic_extraction(self):
        result = _extract_hashtags("#food #cooking text")
        assert result == {"food", "cooking"}

    def test_extracts_numeric_tags(self):
        result = _extract_hashtags("#food #cooking text #123")
        assert result == {"food", "cooking", "123"}

    def test_returns_lowercase(self):
        result = _extract_hashtags("#Food #COOKING")
        assert result == {"food", "cooking"}

    def test_no_hashtags(self):
        result = _extract_hashtags("plain text without tags")
        assert result == set()

    def test_empty_string(self):
        result = _extract_hashtags("")
        assert result == set()

    def test_hashtag_in_middle_of_word(self):
        # Only word characters after # are captured
        result = _extract_hashtags("check #cooking-recipes here")
        assert "cooking" in result

    def test_duplicate_hashtags(self):
        result = _extract_hashtags("#food #FOOD")
        assert result == {"food"}


# ─────────────────────────────────────────────────────────────────────────────
# 5.1: KeywordFilter — blocklist match / no match
# ─────────────────────────────────────────────────────────────────────────────

class TestKeywordFilterBlocklist:
    def setup_method(self):
        self.filter = KeywordFilter()

    def test_blocklist_match_rejects(self):
        """5.1: Blocklist keyword present → rejected."""
        campaign = make_campaign(filter_blocklist_keywords=["casino"])
        entry = make_entry(description="I love casino games")
        result = self.filter.apply(entry, campaign)
        assert not result.accepted
        assert "blocklist_match:casino" == result.reason
        assert result.filter_name == "keyword"

    def test_blocklist_no_match_accepts(self):
        """5.1: Blocklist keyword absent → accepted."""
        campaign = make_campaign(filter_blocklist_keywords=["casino"])
        entry = make_entry(description="Wholesome cooking video")
        result = self.filter.apply(entry, campaign)
        assert result.accepted

    def test_blocklist_empty_accepts_all(self):
        """Blocklist rỗng → accept all (skip check)."""
        campaign = make_campaign(filter_blocklist_keywords=[])
        entry = make_entry(description="casino royale")
        result = self.filter.apply(entry, campaign)
        assert result.accepted

    def test_blocklist_matches_hashtag_form(self):
        """'casino' matches '#casino' in description."""
        campaign = make_campaign(filter_blocklist_keywords=["casino"])
        entry = make_entry(description="check out #casino gaming")
        result = self.filter.apply(entry, campaign)
        assert not result.accepted

    def test_blocklist_skips_empty_strings(self):
        """Empty string entries in blocklist are skipped."""
        campaign = make_campaign(filter_blocklist_keywords=["", "casino"])
        entry = make_entry(description="casino royale")
        result = self.filter.apply(entry, campaign)
        assert not result.accepted

    def test_blocklist_empty_string_only_accepts_all(self):
        """Blocklist with only empty strings behaves as empty → accept."""
        campaign = make_campaign(filter_blocklist_keywords=["", "  "])
        entry = make_entry(description="casino royale")
        result = self.filter.apply(entry, campaign)
        assert result.accepted

    def test_caption_null_with_blocklist(self):
        """Null description → empty string → blocklist doesn't match."""
        campaign = make_campaign(filter_blocklist_keywords=["casino"])
        entry = {"id": "x", "description": None}
        result = self.filter.apply(entry, campaign)
        assert result.accepted


# ─────────────────────────────────────────────────────────────────────────────
# 5.2: Case-insensitive blocklist
# ─────────────────────────────────────────────────────────────────────────────

class TestKeywordFilterCaseInsensitive:
    def setup_method(self):
        self.filter = KeywordFilter()

    def test_uppercase_caption_matches_lowercase_keyword(self):
        """5.2: Caption 'CASINO' matches blocklist keyword 'casino'."""
        campaign = make_campaign(filter_blocklist_keywords=["casino"])
        entry = make_entry(description="CASINO games")
        result = self.filter.apply(entry, campaign)
        assert not result.accepted

    def test_mixed_case_keyword_matches(self):
        """5.2: 'Casino' in blocklist matches 'casino' in caption."""
        campaign = make_campaign(filter_blocklist_keywords=["Casino"])
        entry = make_entry(description="love casino")
        result = self.filter.apply(entry, campaign)
        assert not result.accepted

    def test_mixed_case_both_sides(self):
        """5.2: 'CaSiNo' in blocklist, 'CASINO' in caption → match."""
        campaign = make_campaign(filter_blocklist_keywords=["CaSiNo"])
        entry = make_entry(description="CASINO royal")
        result = self.filter.apply(entry, campaign)
        assert not result.accepted


# ─────────────────────────────────────────────────────────────────────────────
# 5.3: Allowlist — matching / not matching
# ─────────────────────────────────────────────────────────────────────────────

class TestKeywordFilterAllowlist:
    def setup_method(self):
        self.filter = KeywordFilter()

    def test_allowlist_with_matching_hashtag_accepts(self):
        """5.3: Caption has #cooking → allowed."""
        campaign = make_campaign(filter_allowlist_hashtags=["cooking"])
        entry = make_entry(description="Great #cooking tips today")
        result = self.filter.apply(entry, campaign)
        assert result.accepted

    def test_allowlist_without_matching_hashtag_rejects(self):
        """5.3: Caption has no #cooking → rejected."""
        campaign = make_campaign(filter_allowlist_hashtags=["cooking"])
        entry = make_entry(description="Random video about cats")
        result = self.filter.apply(entry, campaign)
        assert not result.accepted
        assert result.reason == "allowlist_no_match"

    def test_allowlist_with_hash_prefix_input(self):
        """Admin can enter '#cooking' with # prefix → normalized correctly."""
        campaign = make_campaign(filter_allowlist_hashtags=["#cooking"])
        entry = make_entry(description="love #cooking so much")
        result = self.filter.apply(entry, campaign)
        assert result.accepted

    def test_allowlist_case_insensitive(self):
        """Allowlist 'cooking' matches '#COOKING' in caption."""
        campaign = make_campaign(filter_allowlist_hashtags=["cooking"])
        entry = make_entry(description="video about #COOKING")
        result = self.filter.apply(entry, campaign)
        assert result.accepted

    def test_allowlist_multiple_any_match_is_enough(self):
        """At least one allowlist tag in caption → accepted."""
        campaign = make_campaign(filter_allowlist_hashtags=["cooking", "recipe", "food"])
        entry = make_entry(description="here is my #recipe for pasta")
        result = self.filter.apply(entry, campaign)
        assert result.accepted

    def test_caption_null_with_allowlist_rejects(self):
        """Null description → no hashtags → fails allowlist check."""
        campaign = make_campaign(filter_allowlist_hashtags=["cooking"])
        entry = {"id": "x", "description": None}
        result = self.filter.apply(entry, campaign)
        assert not result.accepted
        assert result.reason == "allowlist_no_match"


# ─────────────────────────────────────────────────────────────────────────────
# 5.4: Allowlist rỗng → bypass
# ─────────────────────────────────────────────────────────────────────────────

class TestKeywordFilterAllowlistEmpty:
    def setup_method(self):
        self.filter = KeywordFilter()

    def test_empty_allowlist_accepts_any_caption(self):
        """5.4: Empty allowlist → always accepted."""
        campaign = make_campaign(filter_allowlist_hashtags=[])
        entry = make_entry(description="random content with no hashtags")
        result = self.filter.apply(entry, campaign)
        assert result.accepted

    def test_empty_allowlist_and_empty_blocklist_short_circuits(self):
        """5.4: No filters configured → short-circuit early accept."""
        campaign = make_campaign(filter_blocklist_keywords=[], filter_allowlist_hashtags=[])
        entry = make_entry(description="any content")
        result = self.filter.apply(entry, campaign)
        assert result.accepted

    def test_none_allowlist_treated_as_empty(self):
        """5.4: None allowlist → treated as empty → bypass."""
        campaign = MagicMock()
        campaign.filter_blocklist_keywords = []
        campaign.filter_allowlist_hashtags = None
        entry = make_entry(description="no hashtags here")
        result = self.filter.apply(entry, campaign)
        assert result.accepted


# ─────────────────────────────────────────────────────────────────────────────
# 5.5: Blocklist checked FIRST
# ─────────────────────────────────────────────────────────────────────────────

class TestKeywordFilterPriority:
    def setup_method(self):
        self.filter = KeywordFilter()

    def test_blocklist_checked_before_allowlist(self):
        """5.5: Video matches allowlist but also matches blocklist → rejected (blocklist wins)."""
        campaign = make_campaign(
            filter_blocklist_keywords=["casino"],
            filter_allowlist_hashtags=["cooking"],
        )
        # Caption has both #cooking (allowlist match) AND "casino" (blocklist match)
        entry = make_entry(description="casino #cooking recipes")
        result = self.filter.apply(entry, campaign)
        assert not result.accepted
        assert result.reason and result.reason.startswith("blocklist_match")

    def test_blocklist_passes_then_allowlist_checked(self):
        """5.5: No blocklist match → allowlist check runs → no match → rejected."""
        campaign = make_campaign(
            filter_blocklist_keywords=["casino"],
            filter_allowlist_hashtags=["cooking"],
        )
        entry = make_entry(description="wholesome family video")
        result = self.filter.apply(entry, campaign)
        assert not result.accepted
        assert result.reason == "allowlist_no_match"

    def test_both_pass(self):
        """5.5: No blocklist match + allowlist match → accepted."""
        campaign = make_campaign(
            filter_blocklist_keywords=["casino"],
            filter_allowlist_hashtags=["cooking"],
        )
        entry = make_entry(description="delicious #cooking pasta")
        result = self.filter.apply(entry, campaign)
        assert result.accepted


# ─────────────────────────────────────────────────────────────────────────────
# 5.7: Full pipeline chain — QualityFilter + KeywordFilter
# ─────────────────────────────────────────────────────────────────────────────

class TestPipelineChain:
    def test_default_filters_include_keyword_filter(self):
        """get_default_filters() returns [QualityFilter, KeywordFilter]."""
        filters = get_default_filters()
        assert len(filters) == 2
        assert isinstance(filters[0], QualityFilter)
        assert isinstance(filters[1], KeywordFilter)

    def test_quality_rejects_before_keyword(self):
        """5.7: QualityFilter rejects first → KeywordFilter never runs."""
        campaign = make_campaign(
            filter_min_views=1_000_000,
            filter_blocklist_keywords=["casino"],
        )
        # Low views, no blocklist word — quality kills it first
        entry = make_entry(description="clean video", view_count=500)
        result = run_filters(entry, campaign)
        assert not result.accepted
        assert result.filter_name == "quality"

    def test_keyword_rejects_after_quality_passes(self):
        """5.7: QualityFilter passes → KeywordFilter rejects via blocklist."""
        campaign = make_campaign(
            filter_min_views=1_000,
            filter_blocklist_keywords=["casino"],
        )
        entry = make_entry(description="casino games", view_count=5_000)
        result = run_filters(entry, campaign)
        assert not result.accepted
        assert result.filter_name == "keyword"

    def test_both_pass(self):
        """5.7: Both filters pass → accepted."""
        campaign = make_campaign(
            filter_min_views=1_000,
            filter_blocklist_keywords=["casino"],
            filter_allowlist_hashtags=["cooking"],
        )
        entry = make_entry(description="nice #cooking pasta", view_count=5_000)
        result = run_filters(entry, campaign)
        assert result.accepted

    def test_no_filters_accepts_everything(self):
        """run_filters with explicit empty list → accepted."""
        campaign = make_campaign()
        entry = make_entry(description="casino", view_count=0)
        result = run_filters(entry, campaign, filters=[])
        assert result.accepted


# ─────────────────────────────────────────────────────────────────────────────
# 5.8: API — create campaign với keyword filter fields
# ─────────────────────────────────────────────────────────────────────────────

class TestCampaignAPIKeywordFields:
    def test_campaign_create_model_has_keyword_fields(self):
        """5.8: CampaignCreate Pydantic model includes keyword filter fields."""
        from app.api.campaigns import CampaignCreate
        model = CampaignCreate(
            name="Test",
            source_url="https://www.tiktok.com/@test",
            filter_blocklist_keywords=["casino", "18+"],
            filter_allowlist_hashtags=["cooking", "recipe"],
        )
        assert model.filter_blocklist_keywords == ["casino", "18+"]
        assert model.filter_allowlist_hashtags == ["cooking", "recipe"]

    def test_campaign_create_model_defaults_empty_lists(self):
        """5.8: Default values for keyword fields are empty lists."""
        from app.api.campaigns import CampaignCreate
        model = CampaignCreate(name="Test", source_url="https://www.tiktok.com/@test")
        assert model.filter_blocklist_keywords == []
        assert model.filter_allowlist_hashtags == []

    def test_campaign_update_model_has_keyword_fields(self):
        """5.8: CampaignUpdate Pydantic model includes keyword filter fields."""
        from app.api.campaigns import CampaignUpdate
        model = CampaignUpdate(
            filter_blocklist_keywords=["spam"],
            filter_allowlist_hashtags=["food"],
        )
        assert model.filter_blocklist_keywords == ["spam"]
        assert model.filter_allowlist_hashtags == ["food"]

    def test_campaign_update_model_defaults_none(self):
        """5.8: CampaignUpdate keyword fields default to None (not sent = not changed)."""
        from app.api.campaigns import CampaignUpdate
        model = CampaignUpdate()
        assert model.filter_blocklist_keywords is None
        assert model.filter_allowlist_hashtags is None

    def test_serialize_campaign_includes_keyword_fields(self):
        """5.8: serialize_campaign() returns keyword filter fields."""
        from app.api.campaigns import serialize_campaign
        campaign = MagicMock()
        campaign.id = "00000000-0000-0000-0000-000000000001"
        campaign.name = "Test Campaign"
        campaign.source_url = "https://www.tiktok.com/@test"
        campaign.status = MagicMock()
        campaign.status.value = "active"
        campaign.auto_post = False
        campaign.target_page_id = None
        campaign.schedule_interval = 0
        campaign.filter_min_views = 0
        campaign.filter_min_likes = 0
        campaign.filter_blocklist_keywords = ["casino"]
        campaign.filter_allowlist_hashtags = ["cooking"]
        campaign.last_synced_at = None
        campaign.last_sync_status = "idle"
        campaign.last_sync_error = None
        campaign.created_at = None
        campaign.updated_at = None

        result = serialize_campaign(campaign, summary_map={}, page_name_map={})
        assert result["filter_blocklist_keywords"] == ["casino"]
        assert result["filter_allowlist_hashtags"] == ["cooking"]

    def test_serialize_campaign_keyword_fields_null_returns_empty_list(self):
        """5.8: serialize_campaign returns [] when DB column is None."""
        from app.api.campaigns import serialize_campaign
        campaign = MagicMock()
        campaign.id = "00000000-0000-0000-0000-000000000002"
        campaign.name = "Test"
        campaign.source_url = "https://www.tiktok.com/@test"
        campaign.status = MagicMock()
        campaign.status.value = "active"
        campaign.auto_post = False
        campaign.target_page_id = None
        campaign.schedule_interval = 0
        campaign.filter_min_views = 0
        campaign.filter_min_likes = 0
        campaign.filter_blocklist_keywords = None
        campaign.filter_allowlist_hashtags = None
        campaign.last_synced_at = None
        campaign.last_sync_status = "idle"
        campaign.last_sync_error = None
        campaign.created_at = None
        campaign.updated_at = None

        result = serialize_campaign(campaign, summary_map={}, page_name_map={})
        assert result["filter_blocklist_keywords"] == []
        assert result["filter_allowlist_hashtags"] == []


# ─────────────────────────────────────────────────────────────────────────────
# Review patches (P5, P6): Vietnamese / CJK / emoji / long caption / whitespace allowlist
# ─────────────────────────────────────────────────────────────────────────────

class TestKeywordFilterUnicode:
    """P5: real-world Unicode scenarios — Vietnamese diacritics, CJK, emoji."""

    def test_vietnamese_diacritic_blocklist_match(self):
        campaign = make_campaign(filter_blocklist_keywords=["cá độ"])
        entry = make_entry(description="Hôm nay đi cá độ vui quá")
        result = KeywordFilter().apply(entry, campaign)
        assert not result.accepted
        assert result.reason and result.reason.startswith("blocklist_match")

    def test_vietnamese_uppercase_diacritic_match(self):
        # Test .lower() Unicode case folding works on Vietnamese
        campaign = make_campaign(filter_blocklist_keywords=["Cờ Bạc"])
        entry = make_entry(description="cờ bạc online")
        result = KeywordFilter().apply(entry, campaign)
        assert not result.accepted

    def test_vietnamese_hashtag_allowlist_match(self):
        campaign = make_campaign(filter_allowlist_hashtags=["nấuăn"])
        entry = make_entry(description="Hôm nay #nấuăn ngon lắm")
        result = KeywordFilter().apply(entry, campaign)
        assert result.accepted

    def test_cjk_hashtag_allowlist_match(self):
        # \w+ matches Unicode word chars by default in Python 3
        campaign = make_campaign(filter_allowlist_hashtags=["料理"])
        entry = make_entry(description="今日の #料理 です")
        result = KeywordFilter().apply(entry, campaign)
        assert result.accepted

    def test_emoji_in_caption_does_not_break_extraction(self):
        # Emojis are not \w chars; hashtag after emoji still extractable
        campaign = make_campaign(filter_allowlist_hashtags=["cooking"])
        entry = make_entry(description="🍳 #cooking 🔥")
        result = KeywordFilter().apply(entry, campaign)
        assert result.accepted

    def test_long_caption_accepts(self):
        # 10KB caption with single matching hashtag at the end
        campaign = make_campaign(filter_allowlist_hashtags=["food"])
        long_text = "A" * 10000 + " #food"
        entry = make_entry(description=long_text)
        result = KeywordFilter().apply(entry, campaign)
        assert result.accepted

    def test_long_caption_blocklist_finds_keyword(self):
        # Substring match works on long caption
        campaign = make_campaign(filter_blocklist_keywords=["spam"])
        long_text = "A" * 5000 + " spam " + "B" * 5000
        entry = make_entry(description=long_text)
        result = KeywordFilter().apply(entry, campaign)
        assert not result.accepted


class TestKeywordFilterAllowlistWhitespaceOnly:
    """P6: allowlist with whitespace-only entries — must not silently reject all."""

    def test_allowlist_whitespace_only_treated_as_empty(self):
        # ["   ", "\t", ""] → after strip-filter, allowlist_normalized = empty set
        # → should be treated as no allowlist (accept all), not "no match → reject"
        campaign = make_campaign(filter_allowlist_hashtags=["   ", "\t", ""])
        entry = make_entry(description="any caption no hashtag")
        result = KeywordFilter().apply(entry, campaign)
        assert result.accepted, "Whitespace-only allowlist must not silently reject all"

    def test_blocklist_whitespace_only_treated_as_empty(self):
        campaign = make_campaign(filter_blocklist_keywords=["   ", "\t", ""])
        entry = make_entry(description="anything goes")
        result = KeywordFilter().apply(entry, campaign)
        assert result.accepted


class TestKeywordFilterCachePerCampaign:
    """P4: memoization invalidates when campaign changes."""

    def test_cache_invalidates_on_different_campaign(self):
        f = KeywordFilter()
        c1 = make_campaign(filter_blocklist_keywords=["casino"])
        c1.id = "campaign-1"
        c2 = make_campaign(filter_blocklist_keywords=["spam"])
        c2.id = "campaign-2"

        # First campaign blocks "casino"
        assert not f.apply(make_entry(description="love casino"), c1).accepted
        # Second campaign should NOT block "casino" (cache must refresh on c2)
        assert f.apply(make_entry(description="love casino"), c2).accepted
        # Second campaign blocks "spam"
        assert not f.apply(make_entry(description="this is spam"), c2).accepted
        # Back to first — cache must refresh again, "casino" must still be blocked
        assert not f.apply(make_entry(description="this casino"), c1).accepted
