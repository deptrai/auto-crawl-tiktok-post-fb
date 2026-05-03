from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List

from app.core.database import get_db
from app.services.analytics_service import get_campaign_summary, get_top_videos, get_campaign_time_series
from app.models.models import Campaign

router = APIRouter(prefix="/analytics", tags=["Analytics"])

@router.get("/{campaign_id}/summary")
def get_summary(campaign_id: str, db: Session = Depends(get_db)):
    """Lấy tổng hợp hiệu suất của một chiến dịch."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
        
    try:
        data = get_campaign_summary(db, campaign_id)
        return {"data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{campaign_id}/top-videos")
def get_top_videos_api(campaign_id: str, limit: int = Query(5, ge=1, le=20), db: Session = Depends(get_db)):
    """Lấy danh sách Top video viral theo views."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
        
    try:
        data = get_top_videos(db, campaign_id, limit=limit)
        return {"data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{campaign_id}/time-series")
def get_time_series_api(campaign_id: str, days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)):
    """Lấy time-series data để vẽ biểu đồ line chart."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
        
    try:
        data = get_campaign_time_series(db, campaign_id, days=days)
        return {"data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
