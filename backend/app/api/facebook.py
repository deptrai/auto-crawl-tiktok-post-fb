from __future__ import annotations
import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator, Field
from typing import Literal
from app.core.database import get_db
from app.models.models import FacebookPage
from app.services.observability import record_event
from app.services.security import decrypt_secret, encrypt_secret, is_secret_encrypted, mask_secret
from app.services.fb_graph import inspect_page_access
from app.services.token_lifecycle import check_token_health, refresh_long_lived_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/facebook", tags=["Trang Facebook"])

_MAX_TOKEN_LENGTH = 2048  # Facebook token thông thường < 300 chars; 2048 là đủ an toàn

class FacebookPageCreate(BaseModel):
    page_id: str = Field(..., min_length=1)
    page_name: str = Field(..., min_length=1)
    long_lived_access_token: str | None = None
    user_access_token: str | None = None
    auto_refresh_enabled: bool | None = None
    brand_voice: str | None = Field(None, max_length=500)
    # `Literal[...] = "casual"` không có `| None` — DB column nullable=False.
    # Client không gửi field → default casual; gửi null → 422.
    brand_voice_preset: Literal["professional", "casual", "gen-z", "corporate", "viral"] = "casual"

    @field_validator("page_id", "page_name", mode="before")
    @classmethod
    def _strip_required_str(cls, v):
        if isinstance(v, str):
            v = v.strip()
        if not v:
            raise ValueError("Trường này không được để trống.")
        return v

    @field_validator("long_lived_access_token", "user_access_token", mode="before")
    @classmethod
    def validate_token_length(cls, v: str | None) -> str | None:
        if v is not None and len(v) > _MAX_TOKEN_LENGTH:
            raise ValueError(f"Token quá dài (tối đa {_MAX_TOKEN_LENGTH} ký tự).")
        return v

def get_token_kind(token: str | None) -> str:
    if not token:
        return "missing"
    try:
        plain_token = decrypt_secret(token)
    except ValueError:
        return "invalid_encryption"
    if plain_token.startswith("http://") or plain_token.startswith("https://"):
        return "legacy_webhook"
    return "page_access_token"

@router.post("/config")
def set_facebook_config(page_in: FacebookPageCreate, db: Session = Depends(get_db)):
    normalized_token = page_in.long_lived_access_token.strip() if page_in.long_lived_access_token else None

    if normalized_token and get_token_kind(normalized_token) == "legacy_webhook":
        raise HTTPException(
            status_code=400,
            detail="Hãy nhập mã truy cập trang Facebook thật. Liên kết webhook cũ không còn dùng để đăng bài hoặc trả lời bình luận."
        )

    page = db.query(FacebookPage).filter(FacebookPage.page_id == page_in.page_id).first()
    if page:
        page.page_name = page_in.page_name
        if normalized_token:
            page.long_lived_access_token = encrypt_secret(normalized_token)
    else:
        if not normalized_token:
            raise HTTPException(status_code=400, detail="Cần cung cấp mã truy cập cho trang mới.")
        page = FacebookPage(
            page_id=page_in.page_id,
            page_name=page_in.page_name,
            long_lived_access_token=encrypt_secret(normalized_token)
        )
        db.add(page)

    # Story 7.2: cập nhật user_access_token và auto_refresh_enabled nếu được cung cấp
    if page_in.user_access_token is not None:
        raw_user_token = page_in.user_access_token.strip()
        page.user_access_token = encrypt_secret(raw_user_token) if raw_user_token else None
    if page_in.auto_refresh_enabled is not None:
        page.auto_refresh_enabled = page_in.auto_refresh_enabled

    # Story 10.1: cập nhật brand_voice và brand_voice_preset
    # Empty string → None (clear intent rõ ràng từ frontend, KHÔNG ghi đè im lặng).
    if page_in.brand_voice is not None:
        cleaned_voice = page_in.brand_voice.strip()
        page.brand_voice = cleaned_voice or None
    # brand_voice_preset luôn có value (Literal default "casual"); update unconditional.
    page.brand_voice_preset = page_in.brand_voice_preset

    db.commit()

    # Kích hoạt check health để lấy metadata ngay lập tức
    try:
        check_token_health(page_in.page_id, db)
    except Exception as exc:
        logger.warning(f"Health check sau khi lưu config thất bại: {exc}")

    record_event(
        "facebook",
        "info",
        "Đã lưu cấu hình trang Facebook.",
        db=db,
        details={"page_id": page_in.page_id, "page_name": page_in.page_name},
    )
    return {"message": "Đã lưu mã truy cập Facebook thành công!"}

def _calc_days_remaining(expires_at: datetime | None) -> int | None:
    if not expires_at:
        return None
    days = (expires_at - datetime.now(timezone.utc).replace(tzinfo=None)).days
    return days if days > 0 else 0

@router.get("/config")
def get_facebook_config(db: Session = Depends(get_db)):
    pages = db.query(FacebookPage).all()
    should_commit = False
    normalized_pages = []

    for page in pages:
        raw_token = page.long_lived_access_token
        if raw_token and not is_secret_encrypted(raw_token):
            page.long_lived_access_token = encrypt_secret(raw_token)
            raw_token = page.long_lived_access_token
            should_commit = True

        try:
            decrypted = decrypt_secret(raw_token)
            token_kind = get_token_kind(raw_token)
            token_preview = mask_secret(decrypted)
        except ValueError:
            token_kind = "invalid_encryption"
            token_preview = None

        normalized_pages.append(
            {
                "page_id": page.page_id,
                "page_name": page.page_name,
                "has_token": bool(raw_token),
                "token_kind": token_kind,
                "token_preview": token_preview,
                "token_is_encrypted": bool(raw_token and is_secret_encrypted(raw_token)),
                "token_type": page.token_type.value if page.token_type else None,
                "token_expires_at": page.token_expires_at.isoformat() if page.token_expires_at else None,
                "token_health_status": page.token_health_status or "unknown",
                "token_last_checked_at": page.token_last_checked_at.isoformat() if page.token_last_checked_at else None,
                "days_remaining": _calc_days_remaining(page.token_expires_at),
                # Story 7.2: auto-refresh fields
                "auto_refresh_enabled": page.auto_refresh_enabled,
                "has_user_token": bool(page.user_access_token),
                "last_refresh_at": page.last_refresh_at.isoformat() if page.last_refresh_at else None,
                "token_refresh_error": page.token_refresh_error,
                # Story 10.1: brand voice fields
                "brand_voice": page.brand_voice,
                "brand_voice_preset": page.brand_voice_preset,
            }
        )

    if should_commit:
        db.commit()

    return normalized_pages


_STATUS_PRIORITY = ["invalid", "expired", "expiring_soon", "unknown", "valid"]


@router.get("/token-summary")
def get_token_summary(db: Session = Depends(get_db)):
    """Aggregate token health counts across all configured Facebook pages."""
    pages = db.query(FacebookPage).filter(
        FacebookPage.long_lived_access_token.isnot(None)
    ).all()

    counts: dict[str, int] = {"valid": 0, "expiring_soon": 0, "expired": 0, "invalid": 0, "unknown": 0}
    for page in pages:
        status = page.token_health_status or "unknown"
        if status in counts:
            counts[status] += 1
        else:
            counts["unknown"] += 1

    worst = "valid"
    for p in _STATUS_PRIORITY:
        if counts.get(p, 0) > 0:
            worst = p
            break

    return {
        "total_pages": len(pages),
        "healthy": counts["valid"],
        "expiring_soon": counts["expiring_soon"],
        "expired": counts["expired"],
        "invalid": counts["invalid"],
        "unknown": counts["unknown"],
        "worst_status": worst,
    }


@router.post("/config/{page_id}/refresh-token")
def manual_refresh_token(page_id: str, db: Session = Depends(get_db)):
    """Trigger refresh token thủ công ngay lập tức cho một Facebook Page."""
    page = db.query(FacebookPage).filter(FacebookPage.page_id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Không tìm thấy trang Facebook trong hệ thống.")

    if not page.long_lived_access_token:
        raise HTTPException(status_code=400, detail="Trang Facebook này chưa có mã truy cập.")

    if not page.user_access_token:
        raise HTTPException(
            status_code=400,
            detail="Chưa cung cấp User Access Token. Hãy cập nhật cấu hình với user_access_token trước."
        )

    # Check cooldown trước — trả 200 thay vì 400 vì đây là hành vi expected
    if page.last_refresh_at:
        elapsed = datetime.now(timezone.utc).replace(tzinfo=None) - page.last_refresh_at
        if elapsed < timedelta(hours=1):
            return {
                "message": f"Đã refresh gần đây ({int(elapsed.total_seconds() / 60)} phút trước). Vui lòng thử lại sau.",
                "new_expires_at": page.token_expires_at.isoformat() if page.token_expires_at else None,
            }

    result = refresh_long_lived_token(page_id, db)
    if not result.success:
        raise HTTPException(status_code=400, detail=result.message)

    return {
        "message": result.message,
        "new_expires_at": result.new_expires_at.isoformat() if result.new_expires_at else None,
    }


@router.get("/config/{page_id}/check-health")
def trigger_token_health_check(page_id: str, db: Session = Depends(get_db)):
    page = db.query(FacebookPage).filter(FacebookPage.page_id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Không tìm thấy trang Facebook trong hệ thống.")
    if not page.long_lived_access_token:
        raise HTTPException(status_code=400, detail="Trang Facebook này chưa có mã truy cập để kiểm tra.")
    
    res = check_token_health(page_id, db)
    if not res:
        raise HTTPException(status_code=500, detail="Không thể kiểm tra trạng thái mã truy cập.")
    
    # Return as dict using standard response format (if needed) or simple dict
    return res


@router.get("/config/{page_id}/validate")
def validate_facebook_page(page_id: str, db: Session = Depends(get_db)):
    page = db.query(FacebookPage).filter(FacebookPage.page_id == page_id).first()
    if not page:
        raise HTTPException(status_code=404, detail="Không tìm thấy trang Facebook trong hệ thống.")

    if not page.long_lived_access_token:
        raise HTTPException(status_code=400, detail="Trang Facebook này chưa có mã truy cập để kiểm tra.")

    # Gọi check_token_health để vừa validate vừa update DB health status
    try:
        res = check_token_health(page_id, db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi kiểm tra token: {exc}") from exc

    if not res or not res.is_valid:
        status = res.health_status if res else "unknown"
        raise HTTPException(status_code=400, detail=f"Token không hợp lệ (trạng thái: {status}).")

    record_event(
        "facebook",
        "info",
        "Đã xác minh mã truy cập trang Facebook.",
        db=db,
        details={"page_id": page.page_id, "page_name": page.page_name},
    )
    return {"ok": True, "health_status": res.health_status, "days_remaining": res.days_remaining}
