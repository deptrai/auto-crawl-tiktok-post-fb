from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.automation.license import LicenseActivateRequest, LicenseActivateResponse
from app.services.automation.license import LicenseActivationError, activate_license

router = APIRouter(prefix="/api/v1/automation", tags=["Automation Phase 3"])

_STATUS_BY_CODE = {
    "LICENSE_NOT_FOUND": 404,
    "LICENSE_REVOKED": 403,
    "LICENSE_HWID_MISMATCH": 409,
    "LICENSE_INVALID": 422,
    "LICENSE_DB_ERROR": 500,
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


def reset_activation_rate_limiter() -> None:
    _activation_rate_limiter.reset()


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
