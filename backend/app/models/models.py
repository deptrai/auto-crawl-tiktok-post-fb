from __future__ import annotations
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, BigInteger, Boolean, CheckConstraint, Column, DateTime, Enum, ForeignKey, Index, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.models.organization import Organization

JSON_TYPE = JSON().with_variant(JSONB, "postgresql")


class CampaignStatus(str, enum.Enum):
    active = "active"
    paused = "paused"


class VideoStatus(str, enum.Enum):
    pending = "pending"
    downloading = "downloading"
    ready = "ready"
    posted = "posted"
    failed = "failed"


class InteractionStatus(str, enum.Enum):
    pending = "pending"
    replied = "replied"
    failed = "failed"


class TaskStatus(str, enum.Enum):
    queued = "queued"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class UserRole(str, enum.Enum):
    super_admin = "super_admin"
    owner = "owner"
    editor = "editor"
    viewer = "viewer"


class TokenType(str, enum.Enum):
    short_lived = "short_lived"
    long_lived = "long_lived"
    system_user = "system_user"


class PlatformType(str, enum.Enum):
    facebook = "facebook"
    youtube = "youtube"
    instagram = "instagram"


class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True)
    name = Column(String, index=True)
    # Story 12.1: Platform config (deprecated but kept for fallback)
    target_platform = Column(Enum(PlatformType), default=PlatformType.facebook, nullable=False)
    # Story 12.3: Multi-platform refactor
    target_platforms = Column(JSON_TYPE, default=list, nullable=False) # e.g. ["facebook", "youtube"]
    platform_targets = Column(JSON_TYPE, default=dict, nullable=False) # e.g. {"facebook": "page_id_1", "youtube": "channel_id_2"}
    
    source_url = Column(String)
    status = Column(Enum(CampaignStatus), default=CampaignStatus.active)
    auto_post = Column(Boolean, default=False)
    target_page_id = Column(String, nullable=True)
    schedule_interval = Column(Integer, default=0)
    last_synced_at = Column(DateTime, nullable=True)
    last_sync_status = Column(String, default="idle")
    last_sync_error = Column(String, nullable=True)
    # Story 9.1: Content quality filter thresholds (0 = disabled)
    filter_min_views = Column(Integer, default=0, nullable=False)
    filter_min_likes = Column(Integer, default=0, nullable=False)
    # Story 9.2: Keyword filter — blocklist / allowlist per campaign
    filter_blocklist_keywords = Column(JSON_TYPE, default=list)
    filter_allowlist_hashtags = Column(JSON_TYPE, default=list)
    # Story 10.2: Multilingual caption config
    caption_language = Column(String(16), default="auto", nullable=False)
    # Story 10.3: Auto hashtag optimization
    hashtag_optimization = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        CheckConstraint(
            "caption_language IN ('vi','en','auto')",
            name="campaigns_caption_language_check",
        ),
    )

    videos = relationship("Video", back_populates="campaign")
    organization = relationship("Organization")


class Video(Base):
    __tablename__ = "videos"
    __table_args__ = (
        UniqueConstraint("campaign_id", "original_id", name="uq_videos_campaign_original"),
    )

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id = Column(Uuid(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"))
    original_id = Column(String, index=True)
    source_video_url = Column(String, nullable=True)
    file_path = Column(String, nullable=True)
    original_caption = Column(String, nullable=True)
    ai_caption = Column(String, nullable=True)
    status = Column(Enum(VideoStatus), default=VideoStatus.pending)
    publish_time = Column(DateTime, nullable=True)
    fb_post_id = Column(String, nullable=True)
    last_error = Column(String, nullable=True)
    retry_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    campaign = relationship("Campaign", back_populates="videos", passive_deletes=True)
    posts = relationship("VideoPost", back_populates="video", cascade="all, delete-orphan")


class VideoPost(Base):
    """Lưu trạng thái đăng bài cho từng nền tảng của một video."""
    __tablename__ = "video_posts"
    __table_args__ = (
        UniqueConstraint("video_id", "platform", name="uq_video_posts_video_platform"),
    )

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    video_id = Column(Uuid(as_uuid=True), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False)
    platform = Column(Enum(PlatformType), nullable=False)
    status = Column(Enum(VideoStatus), default=VideoStatus.pending, nullable=False)
    external_id = Column(String, nullable=True, index=True) # fb_post_id or yt_video_id
    last_error = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    video = relationship("Video", back_populates="posts")


class FacebookPage(Base):
    __tablename__ = "facebook_pages"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True)
    page_id = Column(String, unique=True, index=True)
    page_name = Column(String)
    long_lived_access_token = Column(String)
    token_type = Column(Enum(TokenType), default=TokenType.long_lived)
    token_expires_at = Column(DateTime, nullable=True)
    token_last_checked_at = Column(DateTime, nullable=True)
    token_health_status = Column(String, default="unknown", nullable=False)
    # Story 7.2: Auto-refresh fields
    user_access_token = Column(String, nullable=True)
    auto_refresh_enabled = Column(Boolean, default=False, nullable=False)
    token_refresh_error = Column(String, nullable=True)
    last_refresh_at = Column(DateTime, nullable=True)

    # Story 10.1: Brand Voice Config — DB-level length cap + enum check
    brand_voice = Column(String(500), nullable=True)
    brand_voice_preset = Column(String(32), default="casual", nullable=False)

    __table_args__ = (
        CheckConstraint(
            "brand_voice_preset IN ('professional','casual','gen-z','corporate','viral')",
            name="facebook_pages_brand_voice_preset_check",
        ),
    )

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    organization = relationship("Organization")


class InteractionLog(Base):
    __tablename__ = "interactions_log"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    page_id = Column(String, ForeignKey("facebook_pages.page_id", ondelete="SET NULL"), nullable=True)
    post_id = Column(String)
    comment_id = Column(String, unique=True)
    user_id = Column(String)
    user_message = Column(String)
    ai_reply = Column(String, nullable=True)
    status = Column(Enum(InteractionStatus), default=InteractionStatus.pending)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TaskQueue(Base):
    __tablename__ = "task_queue"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True)
    category = Column(String, index=True)
    entity_type = Column(String, index=True, nullable=True)
    entity_id = Column(String, index=True, nullable=True)
    payload = Column(JSON_TYPE)
    status = Column(Enum(TaskStatus), default=TaskStatus.queued)
    priority = Column(Integer, default=0)
    attempts = Column(Integer, default=0)
    max_attempts = Column(Integer, default=3)
    last_error = Column(String, nullable=True)
    available_at = Column(DateTime, default=datetime.utcnow)
    locked_at = Column(DateTime, nullable=True)
    locked_by = Column(String, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class User(Base):
    __tablename__ = "users"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True)
    email = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=True)
    hashed_password = Column(String, nullable=False)
    role = Column(Enum(UserRole), default=UserRole.viewer, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    avatar_url = Column(String, nullable=True)
    must_change_password = Column(Boolean, default=False, nullable=False)
    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    organization = relationship("Organization")


class WorkerHeartbeat(Base):
    __tablename__ = "worker_heartbeats"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    worker_name = Column(String, unique=True, index=True)
    app_role = Column(String, nullable=False)
    hostname = Column(String, nullable=True)
    status = Column(String, default="idle", nullable=False)
    current_task_id = Column(String, nullable=True)
    current_task_type = Column(String, nullable=True)
    details = Column(JSON_TYPE, nullable=True)
    last_seen_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SystemEvent(Base):
    __tablename__ = "system_events"

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(Uuid(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True)
    scope = Column(String, index=True, nullable=False)
    level = Column(String, index=True, nullable=False)
    message = Column(String, nullable=False)
    details = Column(JSON_TYPE, nullable=True)
    actor_user_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class RuntimeSetting(Base):
    __tablename__ = "runtime_settings"

    key = Column(String, primary_key=True)
    value = Column(String, nullable=True)
    is_secret = Column(Boolean, default=False, nullable=False)
    updated_by_user_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class VideoMetrics(Base):
    __tablename__ = "video_metrics"
    __table_args__ = (
        Index("ix_video_metrics_video_fetched", "video_id", "fetched_at"),
    )

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # SET NULL (not CASCADE) để giữ time-series history khi Video bị xóa.
    video_id = Column(Uuid(as_uuid=True), ForeignKey("videos.id", ondelete="SET NULL"), nullable=True)
    fb_post_id = Column(String, index=True, nullable=False)
    views = Column(BigInteger, default=0, nullable=False)
    likes = Column(BigInteger, default=0, nullable=False)
    comments = Column(BigInteger, default=0, nullable=False)
    shares = Column(BigInteger, default=0, nullable=False)
    reach = Column(BigInteger, default=0, nullable=False)
    fetched_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None), nullable=False)

    video = relationship("Video", backref="metrics")


class YouTubeChannel(Base):
    __tablename__ = "youtube_channels"

    channel_id = Column(String, primary_key=True)
    channel_name = Column(String, nullable=True)
    access_token = Column(String, nullable=False)
    refresh_token = Column(String, nullable=True)
    token_expires_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

