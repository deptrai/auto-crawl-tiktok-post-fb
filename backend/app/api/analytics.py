from __future__ import annotations
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.models import Campaign
from app.services.analytics_service import (
    get_campaign_summary,
    get_campaign_time_series,
    get_top_videos,
)
from app.api.deps import get_current_organization_id, apply_org_filter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["Analytics"])


def _validate_campaign_id(campaign_id: str) -> uuid.UUID:
    """Validate campaign_id là UUID hợp lệ; raise HTTP 400 nếu không."""
    try:
        return uuid.UUID(campaign_id)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid campaign_id format")


def _ensure_campaign_exists(db: Session, campaign_uuid: uuid.UUID, org_id: uuid.UUID | None = None) -> Campaign:
    query = db.query(Campaign).filter(Campaign.id == campaign_uuid)
    campaign = apply_org_filter(query, Campaign, org_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign


@router.get("/{campaign_id}/summary")
def get_summary(campaign_id: str, db: Session = Depends(get_db), org_id: uuid.UUID | None = Depends(get_current_organization_id)):
    """Lấy tổng hợp hiệu suất của một chiến dịch."""
    campaign_uuid = _validate_campaign_id(campaign_id)
    _ensure_campaign_exists(db, campaign_uuid, org_id)

    try:
        data = get_campaign_summary(db, campaign_uuid)
        return {"data": data}
    except SQLAlchemyError:
        logger.exception("DB error fetching campaign summary for %s", campaign_id)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{campaign_id}/top-videos")
def get_top_videos_api(
    campaign_id: str,
    limit: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
    org_id: uuid.UUID | None = Depends(get_current_organization_id),
):
    """Lấy danh sách Top video viral theo views."""
    campaign_uuid = _validate_campaign_id(campaign_id)
    _ensure_campaign_exists(db, campaign_uuid, org_id)

    try:
        data = get_top_videos(db, campaign_uuid, limit=limit)
        return {"data": data}
    except SQLAlchemyError:
        logger.exception("DB error fetching top videos for %s", campaign_id)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{campaign_id}/time-series")
def get_time_series_api(
    campaign_id: str,
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    org_id: uuid.UUID | None = Depends(get_current_organization_id),
):
    """Lấy time-series data để vẽ biểu đồ line chart."""
    campaign_uuid = _validate_campaign_id(campaign_id)
    _ensure_campaign_exists(db, campaign_uuid, org_id)

    try:
        data = get_campaign_time_series(db, campaign_uuid, days=days)
        return {"data": data}
    except SQLAlchemyError:
        logger.exception("DB error fetching time series for %s", campaign_id)
        raise HTTPException(status_code=500, detail="Internal server error")
