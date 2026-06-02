from __future__ import annotations

from fastapi import APIRouter, Depends
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
    "LICENSE_DB_ERROR": 500,
}


def _error_payload(code: str, message: str, retryable: bool = False) -> dict:
    return {"detail": message, "error": {"code": code, "message": message, "retryable": retryable}}


def _error_response(code: str, message: str, retryable: bool = False) -> JSONResponse:
    return JSONResponse(
        status_code=_STATUS_BY_CODE.get(code, 500),
        content=_error_payload(code, message, retryable),
    )


@router.post("/license/activate", response_model=LicenseActivateResponse)
def activate_license_endpoint(
    request: LicenseActivateRequest,
    db: Session = Depends(get_db),
) -> LicenseActivateResponse | JSONResponse:
    try:
        return activate_license(db, key=request.key, hwid=request.hwid)
    except LicenseActivationError as exc:
        return _error_response(exc.code, exc.message, exc.retryable)
    except SQLAlchemyError:
        return _error_response(
            "LICENSE_DB_ERROR",
            "Không thể kích hoạt license do lỗi cơ sở dữ liệu.",
            retryable=True,
        )
