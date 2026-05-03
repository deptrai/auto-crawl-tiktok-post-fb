import uuid
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, and_
from datetime import datetime, timedelta

from app.models.models import Video, VideoMetrics, Campaign

def _parse_uuid(id_str):
    if isinstance(id_str, str):
        return uuid.UUID(id_str)
    return id_str

def get_latest_metrics_subquery(db: Session, campaign_id: str):
    """
    Subquery để lấy fetched_at mới nhất cho mỗi video trong campaign.
    """
    camp_id = _parse_uuid(campaign_id)
    return db.query(
        VideoMetrics.video_id,
        func.max(VideoMetrics.fetched_at).label('latest_fetched_at')
    ).join(Video).filter(
        Video.campaign_id == camp_id
    ).group_by(VideoMetrics.video_id).subquery()


def get_campaign_summary(db: Session, campaign_id: str):
    """
    1.2: Lấy metrics tổng quan của chiến dịch (chỉ lấy dòng update mới nhất cho mỗi video).
    """
    camp_id = _parse_uuid(campaign_id)
    # Lấy tổng số video
    total_videos = db.query(func.count(Video.id)).filter(Video.campaign_id == camp_id).scalar() or 0

    # Lấy metrics mới nhất của từng video
    latest_metrics_subquery = get_latest_metrics_subquery(db, campaign_id)

    metrics_query = db.query(
        func.sum(VideoMetrics.views).label('total_views'),
        func.sum(VideoMetrics.likes).label('total_likes'),
        func.sum(VideoMetrics.comments).label('total_comments'),
        func.sum(VideoMetrics.shares).label('total_shares'),
        func.sum(VideoMetrics.reach).label('total_reach')
    ).join(
        latest_metrics_subquery,
        and_(
            VideoMetrics.video_id == latest_metrics_subquery.c.video_id,
            VideoMetrics.fetched_at == latest_metrics_subquery.c.latest_fetched_at
        )
    ).first()

    total_views = metrics_query.total_views or 0
    total_likes = metrics_query.total_likes or 0
    total_comments = metrics_query.total_comments or 0
    total_shares = metrics_query.total_shares or 0
    total_reach = metrics_query.total_reach or 0

    total_engagements = total_likes + total_comments + total_shares
    
    # Tính engagement rate dựa trên reach hoặc views.
    avg_engagement_rate = 0.0
    if total_reach > 0:
        avg_engagement_rate = (total_engagements / total_reach) * 100
    elif total_views > 0:
        avg_engagement_rate = (total_engagements / total_views) * 100

    return {
        "total_videos": total_videos,
        "total_views": total_views,
        "total_likes": total_likes,
        "total_comments": total_comments,
        "total_shares": total_shares,
        "total_reach": total_reach,
        "average_engagement_rate": round(avg_engagement_rate, 2)
    }

def get_top_videos(db: Session, campaign_id: str, limit: int = 5):
    """
    1.3: Lấy danh sách Top 5 video viral (nhiều views / likes nhất)
    Dùng metrics mới nhất của mỗi video.
    """
    camp_id = _parse_uuid(campaign_id)
    latest_metrics_subquery = get_latest_metrics_subquery(db, campaign_id)

    top_videos = db.query(
        Video,
        VideoMetrics.views,
        VideoMetrics.likes,
        VideoMetrics.comments,
        VideoMetrics.shares,
        VideoMetrics.reach
    ).join(
        VideoMetrics, Video.id == VideoMetrics.video_id
    ).join(
        latest_metrics_subquery,
        and_(
            VideoMetrics.video_id == latest_metrics_subquery.c.video_id,
            VideoMetrics.fetched_at == latest_metrics_subquery.c.latest_fetched_at
        )
    ).filter(
        Video.campaign_id == camp_id
    ).order_by(
        desc(VideoMetrics.views), desc(VideoMetrics.likes)
    ).limit(limit).all()

    result = []
    for video, views, likes, comments, shares, reach in top_videos:
        result.append({
            "video_id": str(video.id),
            "original_id": video.original_id,
            "fb_post_id": video.fb_post_id,
            "original_caption": video.original_caption,
            "views": views,
            "likes": likes,
            "comments": comments,
            "shares": shares,
            "reach": reach
        })
    return result

def get_campaign_time_series(db: Session, campaign_id: str, days: int = 30):
    """
    1.4: Lấy time-series data phục vụ vẽ biểu đồ (group theo ngày).
    """
    camp_id = _parse_uuid(campaign_id)
    start_date = datetime.utcnow() - timedelta(days=days)
    
    # 1. Trích xuất ngày từ fetched_at
    date_expr = func.date(VideoMetrics.fetched_at).label('metric_date')

    # 2. Tìm fetched_at mới nhất của từng video TRONG TỪNG NGÀY
    latest_per_day_subq = db.query(
        VideoMetrics.video_id,
        date_expr,
        func.max(VideoMetrics.fetched_at).label('latest_fetched_at')
    ).join(Video).filter(
        Video.campaign_id == camp_id,
        VideoMetrics.fetched_at >= start_date
    ).group_by(
        VideoMetrics.video_id,
        date_expr
    ).subquery()

    # 3. Sum các metrics theo ngày
    daily_metrics = db.query(
        latest_per_day_subq.c.metric_date,
        func.sum(VideoMetrics.views).label('daily_views'),
        func.sum(VideoMetrics.likes).label('daily_likes'),
        func.sum(VideoMetrics.comments).label('daily_comments'),
        func.sum(VideoMetrics.shares).label('daily_shares'),
        func.sum(VideoMetrics.reach).label('daily_reach')
    ).join(
        VideoMetrics,
        and_(
            VideoMetrics.video_id == latest_per_day_subq.c.video_id,
            VideoMetrics.fetched_at == latest_per_day_subq.c.latest_fetched_at
        )
    ).group_by(
        latest_per_day_subq.c.metric_date
    ).order_by(
        latest_per_day_subq.c.metric_date
    ).all()

    result = []
    for row in daily_metrics:
        result.append({
            "date": row.metric_date.strftime("%Y-%m-%d") if not isinstance(row.metric_date, str) else row.metric_date,
            "views": row.daily_views or 0,
            "likes": row.daily_likes or 0,
            "comments": row.daily_comments or 0,
            "shares": row.daily_shares or 0,
            "reach": row.daily_reach or 0
        })
    return result
