from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.models.automation.license import PHASE3_SCHEMA, LicenseActivation


class ActionToken(Base):
    __tablename__ = "action_tokens"
    __table_args__ = (
        Index("uq_action_tokens_jti", "jti", unique=True),
        Index("idx_action_tokens_activation", "license_activation_id"),
        {"schema": PHASE3_SCHEMA},
    )

    jti = Column(String, primary_key=True, nullable=False, unique=True)
    license_activation_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("phase3.license_activations.id", ondelete="CASCADE"),
        nullable=False,
    )
    action_type = Column(String, nullable=False)
    issued_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)

    license_activation = relationship(LicenseActivation)
