"""Story 9.1: Content quality filter chain.

Provides a Chain-of-Responsibility style filter pipeline that decides whether
a crawled video entry should be accepted into a campaign.

Stories 9.2 (KeywordFilter) and 9.3 (CrossCampaignDedup) will plug additional
filters into this chain via the ContentFilter Protocol.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

from app.models.models import Campaign

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


def get_default_filters() -> list[ContentFilter]:
    """Return the default ordered filter chain.

    Stories 9.2/9.3 will append KeywordFilter and CrossCampaignDedup here.
    """
    return [QualityFilter()]


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
