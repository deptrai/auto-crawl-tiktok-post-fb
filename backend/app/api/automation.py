from __future__ import annotations

import time
from collections import defaultdict, deque
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.auth import require_authenticated_user
from app.api.deps import RoleChecker
from app.core.database import get_db
from app.models.models import User
from app.schemas.automation.action_token import (
    ActionTokenConsumeRequest,
    ActionTokenConsumeResponse,
    ActionTokenRequest,
    ActionTokenResponse,
)
from app.schemas.automation.license import (
    AdminLicenseResponse,
    LicenseActivateRequest,
    LicenseActivateResponse,
    LicenseCheckRequest,
    LicenseCheckResponse,
    LicenseCreateRequest,
    LicenseRevokeResponse,
)
from app.services.automation.action_token import ActionTokenError, consume_action_token, issue_action_token
from app.services.automation.license import (
    LicenseActivationError,
    _admin_license_response,
    _latest_activation,
    activate_license,
    check_license,
    create_license_for_admin,
    list_licenses,
    revoke_license,
)

router = APIRouter(prefix="/api/v1/automation", tags=["Automation Phase 3"])

_STATUS_BY_CODE = {
    "LICENSE_NOT_FOUND": 404,
    "LICENSE_REVOKED": 403,
    "LICENSE_HWID_MISMATCH": 409,
    "LICENSE_INVALID": 422,
    "LICENSE_EXPIRED": 403,
    "ACTION_NOT_ALLOWED": 403,
    "ACTION_TOKEN_INVALID": 422,
    "ACTION_TOKEN_REUSED": 409,
    "ACTION_TOKEN_EXPIRED": 401,
    "ACTION_TOKEN_DB_ERROR": 500,
    "LICENSE_DB_ERROR": 500,
    "LICENSE_KEY_COLLISION": 500,
    "RATE_LIMITED": 429,
}


def _error_payload(code: str, message: str, retryable: bool = False) -> dict:
    return {"detail": message, "error": {"code": code, "message": message, "retryable": retryable}}


def _error_response(code: str, message: str, retryable: bool = False) -> JSONResponse:
    return JSONResponse(
        status_code=_STATUS_BY_CODE.get(code, 500),
        content=_error_payload(code, message, retryable),
    )


class ActivationRateLimiter:
    def __init__(self, max_attempts: int = 10, window_seconds: int = 60) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, ip_address: str, key: str, now: float | None = None) -> bool:
        current_time = now if now is not None else time.monotonic()
        identities = (f"ip:{ip_address}", f"key:{key.strip().lower()}")
        allowed = True
        for identity in identities:
            bucket = self._attempts[identity]
            while bucket and current_time - bucket[0] >= self.window_seconds:
                bucket.popleft()
            if len(bucket) >= self.max_attempts:
                allowed = False
        if allowed:
            for identity in identities:
                self._attempts[identity].append(current_time)
        return allowed

    def reset(self) -> None:
        self._attempts.clear()


_activation_rate_limiter = ActivationRateLimiter()
_action_token_rate_limiter = ActivationRateLimiter(max_attempts=60, window_seconds=60)


def reset_activation_rate_limiter() -> None:
    _activation_rate_limiter.reset()
    _action_token_rate_limiter.reset()


def _client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip() or "unknown"
    return request.client.host if request.client else "unknown"


@router.post("/license/activate", response_model=LicenseActivateResponse)
def activate_license_endpoint(
    request_body: LicenseActivateRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LicenseActivateResponse | JSONResponse:
    if not _activation_rate_limiter.allow(_client_ip(request), request_body.key):
        return _error_response(
            "RATE_LIMITED",
            "Bạn đã thử kích hoạt quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.",
            retryable=True,
        )

    try:
        return activate_license(db, key=request_body.key, hwid=request_body.hwid)
    except LicenseActivationError as exc:
        return _error_response(exc.code, exc.message, exc.retryable)
    except SQLAlchemyError:
        return _error_response(
            "LICENSE_DB_ERROR",
            "Không thể kích hoạt license do lỗi cơ sở dữ liệu.",
            retryable=True,
        )


@router.post("/action/token", response_model=ActionTokenResponse)
def issue_action_token_endpoint(
    request_body: ActionTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ActionTokenResponse | JSONResponse:
    if not _action_token_rate_limiter.allow(_client_ip(request), request_body.key):
        return _error_response(
            "RATE_LIMITED",
            "Bạn đã yêu cầu token hành động quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.",
            retryable=True,
        )

    try:
        return issue_action_token(
            db,
            key=request_body.key,
            hwid=request_body.hwid,
            action_type=request_body.action_type,
        )
    except ActionTokenError as exc:
        return _error_response(exc.code, exc.message, exc.retryable)
    except SQLAlchemyError:
        return _error_response(
            "ACTION_TOKEN_DB_ERROR",
            "Không thể cấp token hành động do lỗi cơ sở dữ liệu.",
            retryable=True,
        )

@router.post("/action/token/consume", response_model=ActionTokenConsumeResponse)
def consume_action_token_endpoint(
    request_body: ActionTokenConsumeRequest,
    db: Session = Depends(get_db),
) -> ActionTokenConsumeResponse | JSONResponse:
    try:
        return consume_action_token(db, token=request_body.token)
    except ActionTokenError as exc:
        return _error_response(exc.code, exc.message, exc.retryable)
    except SQLAlchemyError:
        return _error_response(
            "ACTION_TOKEN_DB_ERROR",
            "Không thể tiêu thụ token hành động do lỗi cơ sở dữ liệu.",
            retryable=True,
        )

@router.post("/license/check", response_model=LicenseCheckResponse)
def check_license_endpoint(
    request_body: LicenseCheckRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LicenseCheckResponse | JSONResponse:
    if not _activation_rate_limiter.allow(_client_ip(request), str(request_body.activation_id)):
        return _error_response(
            "RATE_LIMITED",
            "Bạn đã kiểm tra license quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.",
            retryable=True,
        )

    try:
        return check_license(db, activation_id=request_body.activation_id)
    except LicenseActivationError as exc:
        return _error_response(exc.code, exc.message, exc.retryable)
    except SQLAlchemyError:
        return _error_response(
            "LICENSE_DB_ERROR",
            "Không thể kiểm tra license do lỗi cơ sở dữ liệu.",
            retryable=True,
        )


# ---------------------------------------------------------------------------
# Admin endpoints (Story 1.5) — guarded PER-ENDPOINT with super_admin role.
# activate/check above remain public intentionally.
# ---------------------------------------------------------------------------

@router.post(
    "/admin/license",
    response_model=AdminLicenseResponse,
    status_code=201,
    dependencies=[Depends(RoleChecker(["super_admin"]))],
)
def create_license_endpoint(
    request_body: LicenseCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> AdminLicenseResponse | JSONResponse:
    try:
        license_record = create_license_for_admin(db, days_total=request_body.days_total, admin_id=current_user.id)
        db.commit()
        activation = _latest_activation(db, license_record.id)
        return _admin_license_response(license_record, activation)
    except LicenseActivationError as exc:
        db.rollback()
        return _error_response(exc.code, exc.message, exc.retryable)
    except SQLAlchemyError:
        db.rollback()
        return _error_response(
            "LICENSE_DB_ERROR",
            "Không thể tạo license do lỗi cơ sở dữ liệu.",
            retryable=True,
        )


@router.get(
    "/admin/license",
    response_model=list[AdminLicenseResponse],
    dependencies=[Depends(RoleChecker(["super_admin"]))],
)
def list_licenses_endpoint(
    db: Session = Depends(get_db),
) -> list[AdminLicenseResponse] | JSONResponse:
    try:
        return list_licenses(db)
    except LicenseActivationError as exc:
        return _error_response(exc.code, exc.message, exc.retryable)
    except SQLAlchemyError:
        return _error_response(
            "LICENSE_DB_ERROR",
            "Không thể tải danh sách license do lỗi cơ sở dữ liệu.",
            retryable=True,
        )


@router.post(
    "/admin/license/{license_id}/revoke",
    response_model=LicenseRevokeResponse,
    dependencies=[Depends(RoleChecker(["super_admin"]))],
)
def revoke_license_endpoint(
    license_id: UUID,
    db: Session = Depends(get_db),
) -> LicenseRevokeResponse | JSONResponse:
    try:
        license_record = revoke_license(db, license_id=license_id)
        return LicenseRevokeResponse(id=license_record.id, revoked=license_record.revoked)
    except LicenseActivationError as exc:
        return _error_response(exc.code, exc.message, exc.retryable)
    except SQLAlchemyError:
        return _error_response(
            "LICENSE_DB_ERROR",
            "Không thể thu hồi license do lỗi cơ sở dữ liệu.",
            retryable=True,
        )
