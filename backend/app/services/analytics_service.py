import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.models.models import Video, VideoMetrics


def _parse_uuid(id_value):
    """Chấp nhận UUID hoặc string; raise ValueError nếu không hợp lệ."""
    if isinstance(id_value, uuid.UUID):
        return id_value
    if isinstance(id_value, str):
        return uuid.UUID(id_value)
    raise ValueError(f"Unsupported campaign_id type: {type(id_value).__name__}")


def _utc_naive_now() -> datetime:
    """Trả về UTC datetime naive — đồng bộ với cách `fetched_at`/`created_at` được store."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _latest_per_video_subquery(db: Session, campaign_uuid: uuid.UUID):
    """
    Subquery dùng ROW_NUMBER() để chọn duy nhất 1 row VideoMetrics mới nhất cho mỗi video.
    Tie-breaker: `id DESC` để khử duplicate `fetched_at` (chống double-count).
    """
    rn = func.row_number().over(
        partition_by=VideoMetrics.video_id,
        order_by=[VideoMetrics.fetched_at.desc(), VideoMetrics.id.desc()],
    ).label("rn")

    return (
        db.query(
            VideoMetrics.id.label("metric_id"),
            VideoMetrics.video_id.label("video_id"),
            VideoMetrics.views.label("views"),
            VideoMetrics.likes.label("likes"),
            VideoMetrics.comments.label("comments"),
            VideoMetrics.shares.label("shares"),
            VideoMetrics.reach.label("reach"),
            VideoMetrics.fetched_at.label("fetched_at"),
            rn,
        )
        .join(Video, Video.id == VideoMetrics.video_id)
        .filter(Video.campaign_id == campaign_uuid)
        .subquery()
    )


def get_campaign_summary(db: Session, campaign_id):
    """Lấy metrics tổng quan của chiến dịch (chỉ dòng update mới nhất per video)."""
    camp_id = _parse_uuid(campaign_id)

    total_videos = (
        db.query(func.count(Video.id))
        .filter(Video.campaign_id == camp_id)
        .scalar()
        or 0
    )

    latest = _latest_per_video_subquery(db, camp_id)
    metrics = db.query(
        func.sum(latest.c.views).label("total_views"),
        func.sum(latest.c.likes).label("total_likes"),
        func.sum(latest.c.comments).label("total_comments"),
        func.sum(latest.c.shares).label("total_shares"),
        func.sum(latest.c.reach).label("total_reach"),
    ).filter(latest.c.rn == 1).first()

    total_views = (metrics.total_views if metrics else 0) or 0
    total_likes = (metrics.total_likes if metrics else 0) or 0
    total_comments = (metrics.total_comments if metrics else 0) or 0
    total_shares = (metrics.total_shares if metrics else 0) or 0
    total_reach = (metrics.total_reach if metrics else 0) or 0

    total_engagements = total_likes + total_comments + total_shares

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
        "average_engagement_rate": round(avg_engagement_rate, 2),
    }


def get_top_videos(db: Session, campaign_id, limit: int = 5):
    """Top N video viral; deterministic tie-break theo `Video.id`."""
    camp_id = _parse_uuid(campaign_id)
    latest = _latest_per_video_subquery(db, camp_id)

    rows = (
        db.query(
            Video,
            latest.c.views,
            latest.c.likes,
            latest.c.comments,
            latest.c.shares,
            latest.c.reach,
        )
        .join(latest, Video.id == latest.c.video_id)
        .filter(latest.c.rn == 1)
        .order_by(
            desc(latest.c.views),
            desc(latest.c.likes),
            desc(Video.id),
        )
        .limit(limit)
        .all()
    )

    return [
        {
            "video_id": str(video.id),
            "original_id": video.original_id,
            "fb_post_id": video.fb_post_id,
            "original_caption": video.original_caption,
            "views": views or 0,
            "likes": likes or 0,
            "comments": comments or 0,
            "shares": shares or 0,
            "reach": reach or 0,
        }
        for video, views, likes, comments, shares, reach in rows
    ]


def get_campaign_time_series(db: Session, campaign_id, days: int = 30):
    """Time-series theo ngày; ROW_NUMBER() khử duplicate fetched_at trong cùng ngày."""
    camp_id = _parse_uuid(campaign_id)
    start_date = _utc_naive_now() - timedelta(days=days)
    date_expr = func.date(VideoMetrics.fetched_at)

    rn = func.row_number().over(
        partition_by=[VideoMetrics.video_id, date_expr],
        order_by=[VideoMetrics.fetched_at.desc(), VideoMetrics.id.desc()],
    ).label("rn")

    latest_per_day = (
        db.query(
            VideoMetrics.video_id.label("video_id"),
            date_expr.label("metric_date"),
            VideoMetrics.views.label("views"),
            VideoMetrics.likes.label("likes"),
            VideoMetrics.comments.label("comments"),
            VideoMetrics.shares.label("shares"),
            VideoMetrics.reach.label("reach"),
            rn,
        )
        .join(Video, Video.id == VideoMetrics.video_id)
        .filter(
            Video.campaign_id == camp_id,
            VideoMetrics.fetched_at >= start_date,
        )
        .subquery()
    )

    daily = (
        db.query(
            latest_per_day.c.metric_date,
            func.sum(latest_per_day.c.views).label("daily_views"),
            func.sum(latest_per_day.c.likes).label("daily_likes"),
            func.sum(latest_per_day.c.comments).label("daily_comments"),
            func.sum(latest_per_day.c.shares).label("daily_shares"),
            func.sum(latest_per_day.c.reach).label("daily_reach"),
        )
        .filter(latest_per_day.c.rn == 1)
        .group_by(latest_per_day.c.metric_date)
        .order_by(latest_per_day.c.metric_date)
        .all()
    )

    result = []
    for row in daily:
        metric_date = row.metric_date
        if hasattr(metric_date, "strftime"):
            date_str = metric_date.strftime("%Y-%m-%d")
        else:
            date_str = str(metric_date)
        result.append({
            "date": date_str,
            "views": row.daily_views or 0,
            "likes": row.daily_likes or 0,
            "comments": row.daily_comments or 0,
            "shares": row.daily_shares or 0,
            "reach": row.daily_reach or 0,
        })
    return result
