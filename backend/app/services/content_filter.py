"""Stories 9.1-9.3: Content filter chain.

Provides a Chain-of-Responsibility style filter pipeline that decides whether
a crawled video entry should be accepted into a campaign.

Story 9.1: QualityFilter — view/like thresholds
Story 9.2: KeywordFilter — blocklist / allowlist per campaign
Story 9.3: CrossCampaignDedup — duplicate detection across campaigns
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from app.models.models import Campaign, Video, VideoStatus

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


@dataclass
class FilterResult:
    """Outcome of running a single filter or the full chain."""
    accepted: bool
    reason: str | None = None
    filter_name: str | None = None


class ContentFilter(Protocol):
    """Structural type for any content filter."""
    name: str

    def apply(self, entry: dict, campaign: Campaign) -> FilterResult: ...


class QualityFilter:
    """Reject videos below configured engagement thresholds.

    Both thresholds default to 0 → filter is a no-op when neither is set.
    """
    name = "quality"

    def apply(self, entry: dict, campaign: Campaign) -> FilterResult:
        min_views = int(getattr(campaign, "filter_min_views", 0) or 0)
        min_likes = int(getattr(campaign, "filter_min_likes", 0) or 0)

        if min_views == 0 and min_likes == 0:
            return FilterResult(accepted=True, filter_name=self.name)

        views = int(entry.get("view_count") or 0)
        likes = int(entry.get("like_count") or 0)

        if min_views > 0 and views < min_views:
            return FilterResult(
                accepted=False,
                reason=f"min_views_not_met:{views}<{min_views}",
                filter_name=self.name,
            )
        if min_likes > 0 and likes < min_likes:
            return FilterResult(
                accepted=False,
                reason=f"min_likes_not_met:{likes}<{min_likes}",
                filter_name=self.name,
            )
        return FilterResult(accepted=True, filter_name=self.name)


def _extract_hashtags(text: str) -> set[str]:
    """Extract all hashtags from text; returns lowercase tags WITHOUT the leading #.

    Example: "#Food #Cooking recipe" → {"food", "cooking"}
    """
    return {tag.lower() for tag in re.findall(r"#(\w+)", text)}


class KeywordFilter:
    """Reject videos that match a per-campaign blocklist, or fail an allowlist check.

    Blocklist  — substring match (case-insensitive) on the video caption.
    Allowlist  — hashtag match (#tags extracted from caption). Empty allowlist → accept all.
    Blocklist is checked FIRST; if matched, allowlist is skipped.
    """
    name = "keyword"

    def __init__(self):
        # P4 (review): memoize per-campaign normalization to avoid recomputing per entry.
        # Sync loop processes 100s of entries per campaign — cache invalidates on campaign change.
        self._cache_key: object = None
        self._cache_blocklist: list[str] = []
        self._cache_allowlist_normalized: set[str] = set()

    def _get_normalized(self, campaign: Campaign) -> tuple[list[str], set[str]]:
        """Return (blocklist_clean, allowlist_normalized_set) cached per-campaign."""
        # Use campaign id as cache key when available, else identity
        cache_key = getattr(campaign, "id", None) or id(campaign)
        if cache_key != self._cache_key:
            blocklist_raw = getattr(campaign, "filter_blocklist_keywords", None) or []
            allowlist_raw = getattr(campaign, "filter_allowlist_hashtags", None) or []
            self._cache_blocklist = [k.strip().lower() for k in blocklist_raw if k and k.strip()]
            self._cache_allowlist_normalized = {
                h.lstrip("#").lower() for h in allowlist_raw if h and h.strip()
            }
            self._cache_key = cache_key
        return self._cache_blocklist, self._cache_allowlist_normalized

    def apply(self, entry: dict, campaign: Campaign) -> FilterResult:
        blocklist, allowlist_normalized = self._get_normalized(campaign)

        # Short-circuit: nothing to check
        if not blocklist and not allowlist_normalized:
            return FilterResult(accepted=True, filter_name=self.name)

        caption = (entry.get("description") or entry.get("title") or "").lower()

        # Blocklist check — simple substring (already lowercased + stripped)
        for keyword in blocklist:
            if keyword in caption:
                return FilterResult(
                    accepted=False,
                    reason=f"blocklist_match:{keyword}",
                    filter_name=self.name,
                )

        # Allowlist check — hashtag matching (only when allowlist is non-empty after normalize)
        if allowlist_normalized:
            caption_tags = _extract_hashtags(caption)
            if not caption_tags.intersection(allowlist_normalized):
                return FilterResult(
                    accepted=False,
                    reason="allowlist_no_match",
                    filter_name=self.name,
                )

        return FilterResult(accepted=True, filter_name=self.name)


class CrossCampaignDedup:
    """Filter thứ 3: phát hiện video đã tồn tại trên cùng Facebook Page từ campaign khác.

    Story 9.3 — Cross-Campaign Duplicate Detection.

    Logic:
    - Query videos JOIN campaigns WHERE target_page_id = <current> AND original_id = <entry>
      AND campaign_id != <current_campaign> AND status != 'failed'
    - Status 'failed' → accept (cho phép campaign mới retry)
    - Mọi status khác (posted / ready / downloading / pending) → reject
    - Nếu campaign chưa assign target_page_id → bypass hoàn toàn
    """

    name = "cross_campaign_dedup"

    def __init__(self, db: "Session") -> None:
        self._db = db

    def apply(self, entry: dict, campaign: Campaign) -> FilterResult:
        # Bypass nếu campaign chưa assign page
        if not campaign.target_page_id:
            return FilterResult(accepted=True, filter_name=self.name)

        original_id = entry.get("id", "")
        if not original_id:
            return FilterResult(accepted=True, filter_name=self.name)

        # Query: có video nào cùng original_id, cùng target_page, status != failed,
        # từ campaign KHÁC không?
        existing = (
            self._db.query(Video.id, Video.status, Campaign.name)
            .join(Campaign, Video.campaign_id == Campaign.id)
            .filter(
                Campaign.target_page_id == campaign.target_page_id,
                Video.original_id == original_id,
                Video.campaign_id != campaign.id,
                Video.status != VideoStatus.failed,
            )
            .first()
        )

        if existing:
            _, _status, source_campaign = existing
            return FilterResult(
                accepted=False,
                reason=f"cross_campaign_duplicate:{source_campaign}",
                filter_name=self.name,
            )

        return FilterResult(accepted=True, filter_name=self.name)


def get_default_filters(db: "Session | None" = None) -> list[ContentFilter]:
    """Return the default ordered filter chain.

    Story 9.1: QualityFilter
    Story 9.2: KeywordFilter
    Story 9.3: CrossCampaignDedup (only when db session is provided)
    """
    chain: list[ContentFilter] = [QualityFilter(), KeywordFilter()]
    if db is not None:
        chain.append(CrossCampaignDedup(db))
    return chain


def run_filters(
    entry: dict,
    campaign: Campaign,
    filters: list[ContentFilter] | None = None,
) -> FilterResult:
    """Run filters in order. Short-circuit on first rejection."""
    chain = filters if filters is not None else get_default_filters()
    for f in chain:
        result = f.apply(entry, campaign)
        if not result.accepted:
            logger.info(
                "content_filter rejected entry id=%s by %s reason=%s",
                entry.get("id"),
                result.filter_name,
                result.reason,
            )
            return result
    return FilterResult(accepted=True)
