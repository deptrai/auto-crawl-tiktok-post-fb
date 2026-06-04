from __future__ import annotations

import uuid
from datetime import datetime, timedelta

import jwt
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.automation.action_token import ActionToken
from app.models.automation.license import License
from app.schemas.automation.action_token import ActionTokenConsumeResponse, ActionTokenResponse
from app.services.automation.hwid import validate_hwid
from app.services.automation.license import _as_utc, _latest_activation, _utc_now

TIER2_ACTIONS = frozenset({"post", "comment", "react", "share", "friend", "message"})
ACTION_TOKEN_TTL_SECONDS = 60


class ActionTokenError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


def _status_error(code: str, message: str, retryable: bool = False) -> ActionTokenError:
    return ActionTokenError(code=code, message=message, retryable=retryable)


def issue_action_token(
    db: Session,
    *,
    key: str,
    hwid: str,
    action_type: str,
    now: datetime | None = None,
) -> ActionTokenResponse:
    normalized_key = key.strip()
    # Defense-in-depth + normalization. The HTTP route already validates hwid via the
    # Pydantic ActionTokenRequest schema (rejects malformed input with 422), but this
    # service is also a public API callable directly (e.g. tests), so validate/normalize here.
    normalized_hwid = validate_hwid(hwid)
    normalized_action = action_type.strip().lower()

    if normalized_action not in TIER2_ACTIONS:
        raise _status_error("ACTION_NOT_ALLOWED", "Hành động không được phép cấp token.")

    issued_at = _as_utc(now) if now is not None else _utc_now()

    try:
        license_record = db.query(License).filter(License.key == normalized_key).one_or_none()
        if license_record is None or license_record.revoked:
            raise _status_error("LICENSE_INVALID", "License không hợp lệ.")

        activation = _latest_activation(db, license_record.id)
        if activation is None:
            raise _status_error("LICENSE_INVALID", "License chưa kích hoạt.")
        if _as_utc(activation.expires_at) < issued_at:
            raise _status_error("LICENSE_EXPIRED", "License đã hết hạn.")
        if activation.hwid_hash != normalized_hwid:
            raise _status_error(
                "LICENSE_HWID_MISMATCH",
                "Thiết bị không khớp license.",
            )

        jti = str(uuid.uuid4())
        expires_at = issued_at + timedelta(seconds=ACTION_TOKEN_TTL_SECONDS)
        token = jwt.encode(
            {
                "jti": jti,
                "sub": str(activation.id),
                "action": normalized_action,
                "exp": int(expires_at.timestamp()),
            },
            settings.JWT_SECRET,
            algorithm=settings.JWT_ALGORITHM,
        )
        db.add(
            ActionToken(
                jti=jti,
                license_activation_id=activation.id,
                action_type=normalized_action,
                issued_at=issued_at,
                expires_at=expires_at,
                used_at=None,
            )
        )
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise _status_error(
                "ACTION_TOKEN_DB_ERROR",
                "Không thể cấp token hành động do lỗi cơ sở dữ liệu.",
                retryable=True,
            ) from exc

        return ActionTokenResponse(token=token, jti=jti, expires_at=expires_at)
    except ActionTokenError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _status_error(
            "ACTION_TOKEN_DB_ERROR",
            "Không thể cấp token hành động do lỗi cơ sở dữ liệu.",
            retryable=True,
        ) from exc

def consume_action_token(
    db: Session,
    *,
    token: str,
    now: datetime | None = None,
) -> ActionTokenConsumeResponse:
    consumed_at = _as_utc(now) if now is not None else _utc_now()
    try:
        try:
            claims = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        except jwt.ExpiredSignatureError as exc:
            raise _status_error("ACTION_TOKEN_EXPIRED", "Token hành động đã hết hạn.") from exc
        except jwt.PyJWTError as exc:
            raise _status_error("ACTION_TOKEN_INVALID", "Token hành động không hợp lệ.") from exc

        jti = claims.get("jti")
        if not isinstance(jti, str) or not jti.strip():
            raise _status_error("ACTION_TOKEN_INVALID", "Token hành động không hợp lệ.")

        action_token = db.query(ActionToken).filter(ActionToken.jti == jti).one_or_none()
        if action_token is None:
            raise _status_error("ACTION_TOKEN_INVALID", "Token hành động không tồn tại.")
        if action_token.used_at is not None:
            raise _status_error("ACTION_TOKEN_REUSED", "Token hành động đã được sử dụng.")

        action_token.used_at = consumed_at
        db.commit()
        return ActionTokenConsumeResponse(jti=action_token.jti, consumed_at=consumed_at)
    except ActionTokenError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise _status_error(
            "ACTION_TOKEN_DB_ERROR",
            "Không thể tiêu thụ token hành động do lỗi cơ sở dữ liệu.",
            retryable=True,
        ) from exc
