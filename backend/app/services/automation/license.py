from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.automation.license import License, LicenseActivation
from app.schemas.automation.license import LicenseActivateResponse
from app.services.automation.hwid import validate_hwid


@dataclass(frozen=True)
class LicenseActivationError(Exception):
    code: str
    message: str
    retryable: bool = False


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _status_error(code: str, message: str, retryable: bool = False) -> LicenseActivationError:
    return LicenseActivationError(code=code, message=message, retryable=retryable)


def activate_license(db: Session, key: str, hwid: str) -> LicenseActivateResponse:
    normalized_key = key.strip()
    normalized_hwid = validate_hwid(hwid)

    try:
        license_record = db.query(License).filter(License.key == normalized_key).one_or_none()
        if license_record is None:
            raise _status_error("LICENSE_NOT_FOUND", "Không tìm thấy license key.")
        if license_record.revoked:
            raise _status_error("LICENSE_REVOKED", "License key đã bị thu hồi.")

        existing_activation = (
            db.query(LicenseActivation)
            .filter(LicenseActivation.license_id == license_record.id)
            .order_by(LicenseActivation.activated_at.desc())
            .first()
        )
        if existing_activation:
            if existing_activation.hwid_hash != normalized_hwid:
                raise _status_error(
                    "LICENSE_HWID_MISMATCH",
                    "License đã được kích hoạt trên máy khác. Vui lòng liên hệ hỗ trợ để rebind.",
                )
            return LicenseActivateResponse(
                activation_id=existing_activation.id,
                expires_at=_as_utc(existing_activation.expires_at),
                rebind_count=existing_activation.rebind_count,
            )

        activated_at = _utc_now()
        expires_at = activated_at + timedelta(days=license_record.days_total)
        activation = LicenseActivation(
            license_id=license_record.id,
            hwid_hash=normalized_hwid,
            activated_at=activated_at,
            expires_at=expires_at,
            rebind_count=0,
        )
        db.add(activation)
        db.commit()
        db.refresh(activation)
        return LicenseActivateResponse(
            activation_id=activation.id,
            expires_at=_as_utc(activation.expires_at),
            rebind_count=activation.rebind_count,
        )
    except LicenseActivationError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _status_error(
            "LICENSE_DB_ERROR",
            "Không thể kích hoạt license do lỗi cơ sở dữ liệu.",
            retryable=True,
        ) from exc
