import pytest
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from app.models.models import Video, VideoMetrics, Campaign
from app.services.analytics_service import get_campaign_summary, get_top_videos, get_campaign_time_series
import uuid

@pytest.fixture
def test_campaign_with_metrics(db_session: Session):
    # Tạo campaign
    campaign_id = str(uuid.uuid4())
    campaign = Campaign(id=uuid.UUID(campaign_id), target_page_id="test_page", name="Test Campaign")
    db_session.add(campaign)
    
    # Tạo video 1
    video1_id = uuid.uuid4()
    video1 = Video(id=video1_id, campaign_id=uuid.UUID(campaign_id), original_id="vid1")
    db_session.add(video1)
    
    # Tạo video 2
    video2_id = uuid.uuid4()
    video2 = Video(id=video2_id, campaign_id=uuid.UUID(campaign_id), original_id="vid2")
    db_session.add(video2)
    
    db_session.commit()
    
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    
    # Add metrics for video 1 (2 records)
    m1_1 = VideoMetrics(video_id=video1_id, fb_post_id="post1", views=100, likes=10, comments=5, shares=2, reach=150, fetched_at=now - timedelta(days=1))
    m1_2 = VideoMetrics(video_id=video1_id, fb_post_id="post1", views=200, likes=20, comments=10, shares=4, reach=300, fetched_at=now)
    
    # Add metrics for video 2 (1 record)
    m2 = VideoMetrics(video_id=video2_id, fb_post_id="post2", views=300, likes=30, comments=15, shares=6, reach=450, fetched_at=now)
    
    db_session.add_all([m1_1, m1_2, m2])
    db_session.commit()
    
    return str(campaign_id)

def test_get_campaign_summary(db_session: Session, test_campaign_with_metrics):
    summary = get_campaign_summary(db_session, test_campaign_with_metrics)
    
    assert summary["total_videos"] == 2
    assert summary["total_views"] == 500  # 200 + 300
    assert summary["total_likes"] == 50   # 20 + 30
    assert summary["total_comments"] == 25 # 10 + 15
    assert summary["total_shares"] == 10  # 4 + 6
    assert summary["total_reach"] == 750  # 300 + 450
    
    # Engagement rate: (50 + 25 + 10) / 750 * 100 = 85 / 750 * 100 = 11.33
    assert summary["average_engagement_rate"] == 11.33

def test_get_top_videos(db_session: Session, test_campaign_with_metrics):
    top_videos = get_top_videos(db_session, test_campaign_with_metrics)
    
    assert len(top_videos) == 2
    assert top_videos[0]["views"] == 300 # vid2
    assert top_videos[1]["views"] == 200 # vid1
    
def test_get_campaign_time_series(db_session: Session, test_campaign_with_metrics):
    time_series = get_campaign_time_series(db_session, test_campaign_with_metrics)
    
    assert len(time_series) == 2 # 2 different days
    # Day 1 (yesterday)
    assert time_series[0]["views"] == 100
    # Day 2 (today)
    assert time_series[1]["views"] == 500 # 200 + 300
