from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.models import models as _public_models  # noqa: F401 - registers public.users for FK resolution.

PHASE3_SCHEMA = "phase3"


class License(Base):
    __tablename__ = "licenses"
    __table_args__ = (
        Index("uq_licenses_key", "key", unique=True),
        CheckConstraint("days_total > 0", name="ck_licenses_days_total_positive"),
        {"schema": PHASE3_SCHEMA},
    )

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key = Column(String, nullable=False, unique=True)
    days_total = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    created_by_admin = Column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=True)
    revoked = Column(Boolean, nullable=False, default=False)

    activations = relationship("LicenseActivation", back_populates="license", cascade="all, delete-orphan")


class LicenseActivation(Base):
    __tablename__ = "license_activations"
    __table_args__ = (
        Index("idx_license_activations_hwid", "hwid_hash"),
        UniqueConstraint("license_id", name="uq_license_activations_license_id"),
        {"schema": PHASE3_SCHEMA},
    )

    id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    license_id = Column(
        Uuid(as_uuid=True),
        ForeignKey("phase3.licenses.id", ondelete="CASCADE"),
        nullable=False,
    )
    hwid_hash = Column(String(64), nullable=False)
    activated_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime(timezone=True), nullable=False)
    rebind_count = Column(Integer, nullable=False, default=0)

    license = relationship("License", back_populates="activations")
