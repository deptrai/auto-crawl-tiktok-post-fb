from __future__ import annotations

import secrets
import string
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.automation.license import License, LicenseActivation
from app.schemas.automation.license import AdminLicenseResponse, LicenseActivateResponse, LicenseCheckResponse
from app.services.automation.hwid import validate_hwid

_KEY_ALPHABET = string.digits + "ABCDEF"
_KEY_SEGMENT_LEN = 8
_KEY_COLLISION_RETRIES = 5

MAX_LICENSE_DAYS = 36500  # 100 years — well below Python timedelta max (~2.7M days)


class LicenseActivationError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _status_error(code: str, message: str, retryable: bool = False) -> LicenseActivationError:
    return LicenseActivationError(code=code, message=message, retryable=retryable)


def _activation_response(activation: LicenseActivation) -> LicenseActivateResponse:
    return LicenseActivateResponse(
        activation_id=activation.id,
        expires_at=_as_utc(activation.expires_at),
        rebind_count=activation.rebind_count,
    )


def _validate_days_total(days_total: int) -> None:
    if days_total <= 0:
        raise _status_error("LICENSE_INVALID", "Số ngày sử dụng phải lớn hơn 0.")
    if days_total > MAX_LICENSE_DAYS:
        raise _status_error(
            "LICENSE_INVALID",
            f"Số ngày sử dụng không được vượt quá {MAX_LICENSE_DAYS} ngày.",
        )


def _activate_existing_hwid(
    db: Session,
    license_record: License,
    activation: LicenseActivation,
    normalized_hwid: str,
    now: datetime,
) -> LicenseActivateResponse:
    if activation.hwid_hash != normalized_hwid:
        raise _status_error(
            "LICENSE_HWID_MISMATCH",
            "License đã được kích hoạt trên máy khác. Vui lòng liên hệ hỗ trợ để rebind.",
        )

    if _as_utc(activation.expires_at) >= now:
        return _activation_response(activation)

    _validate_days_total(license_record.days_total)
    activation.activated_at = now
    activation.expires_at = now + timedelta(days=license_record.days_total)
    db.commit()
    db.refresh(activation)
    return _activation_response(activation)


def _latest_activation(db: Session, license_id) -> LicenseActivation | None:
    return (
        db.query(LicenseActivation)
        .filter(LicenseActivation.license_id == license_id)
        .order_by(LicenseActivation.activated_at.desc())
        .first()
    )


def activate_license(db: Session, key: str, hwid: str) -> LicenseActivateResponse:
    normalized_key = key.strip()
    normalized_hwid = validate_hwid(hwid)

    try:
        license_query = db.query(License).filter(License.key == normalized_key)
        if db.bind and db.bind.dialect.name == "postgresql":
            license_query = license_query.with_for_update()
        license_record = license_query.one_or_none()
        if license_record is None:
            raise _status_error("LICENSE_NOT_FOUND", "Không tìm thấy license key.")
        if license_record.revoked:
            raise _status_error("LICENSE_REVOKED", "License key đã bị thu hồi.")
        _validate_days_total(license_record.days_total)

        now = _utc_now()
        existing_activation = _latest_activation(db, license_record.id)
        if existing_activation:
            return _activate_existing_hwid(db, license_record, existing_activation, normalized_hwid, now)

        activation = LicenseActivation(
            license_id=license_record.id,
            hwid_hash=normalized_hwid,
            activated_at=now,
            expires_at=now + timedelta(days=license_record.days_total),
            rebind_count=0,
        )
        db.add(activation)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            existing_after_race = _latest_activation(db, license_record.id)
            if existing_after_race:
                return _activate_existing_hwid(db, license_record, existing_after_race, normalized_hwid, _utc_now())
            raise
        db.refresh(activation)
        return _activation_response(activation)
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

def check_license(db: Session, activation_id) -> LicenseCheckResponse:
    try:
        activation = db.query(LicenseActivation).filter(LicenseActivation.id == activation_id).one_or_none()
        if activation is None:
            raise _status_error("LICENSE_NOT_FOUND", "Không tìm thấy lượt kích hoạt license.")

        license_record = db.query(License).filter(License.id == activation.license_id).one_or_none()
        if license_record is None:
            raise _status_error("LICENSE_NOT_FOUND", "Không tìm thấy license key.")

        expires_at = _as_utc(activation.expires_at)
        active = not license_record.revoked and expires_at >= _utc_now()
        return LicenseCheckResponse(
            active=active,
            expires_at=expires_at,
            revoked=license_record.revoked,
            rebind_count=activation.rebind_count,
        )
    except LicenseActivationError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _status_error(
            "LICENSE_DB_ERROR",
            "Không thể kiểm tra license do lỗi cơ sở dữ liệu.",
            retryable=True,
        ) from exc


# ---------------------------------------------------------------------------
# Admin functions (Story 1.5)
# ---------------------------------------------------------------------------

def _generate_license_key() -> str:
    """Generate a cryptographically random license key in LIC-XXXXXXXX-XXXXXXXX format."""
    seg1 = "".join(secrets.choice(_KEY_ALPHABET) for _ in range(_KEY_SEGMENT_LEN))
    seg2 = "".join(secrets.choice(_KEY_ALPHABET) for _ in range(_KEY_SEGMENT_LEN))
    return f"LIC-{seg1}-{seg2}"


def _admin_license_response(license_record: License, activation: LicenseActivation | None) -> AdminLicenseResponse:
    return AdminLicenseResponse(
        id=license_record.id,
        key=license_record.key,
        days_total=license_record.days_total,
        revoked=license_record.revoked,
        created_at=_as_utc(license_record.created_at),
        created_by_admin=license_record.created_by_admin,
        activated=activation is not None,
        expires_at=_as_utc(activation.expires_at) if activation else None,
        rebind_count=activation.rebind_count if activation else None,
    )


def create_license_for_admin(db: Session, days_total: int, admin_id: UUID | None) -> License:
    """Create a new license key for an admin. Returns the License ORM object."""
    _validate_days_total(days_total)
    for attempt in range(_KEY_COLLISION_RETRIES):
        key = _generate_license_key()
        new_license = License(
            key=key,
            days_total=days_total,
            created_by_admin=admin_id,
            revoked=False,
        )
        db.add(new_license)
        try:
            db.flush()
            return new_license
        except IntegrityError:
            db.rollback()
            if attempt == _KEY_COLLISION_RETRIES - 1:
                raise _status_error(
                    "LICENSE_KEY_COLLISION",
                    "Không thể sinh license key duy nhất. Vui lòng thử lại.",
                    retryable=True,
                )
    raise _status_error("LICENSE_KEY_COLLISION", "Không thể sinh license key duy nhất.", retryable=True)


def revoke_license(db: Session, license_id: UUID) -> License:
    """Set revoked=True on a license. Idempotent — revoking an already-revoked key is allowed."""
    try:
        query = db.query(License).filter(License.id == license_id)
        if db.bind and db.bind.dialect.name == "postgresql":
            query = query.with_for_update()
        license_record = query.one_or_none()
        if license_record is None:
            raise _status_error("LICENSE_NOT_FOUND", "Không tìm thấy license key.")
        license_record.revoked = True
        db.commit()
        db.refresh(license_record)
        return license_record
    except LicenseActivationError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _status_error(
            "LICENSE_DB_ERROR",
            "Không thể thu hồi license do lỗi cơ sở dữ liệu.",
            retryable=True,
        ) from exc


def list_licenses(db: Session) -> list[AdminLicenseResponse]:
    """Return all licenses ordered by created_at descending, with activation info."""
    try:
        licenses = db.query(License).order_by(License.created_at.desc()).all()
        result = []
        for lic in licenses:
            activation = _latest_activation(db, lic.id)
            result.append(_admin_license_response(lic, activation))
        return result
    except SQLAlchemyError as exc:
        raise _status_error(
            "LICENSE_DB_ERROR",
            "Không thể tải danh sách license do lỗi cơ sở dữ liệu.",
            retryable=True,
        ) from exc
