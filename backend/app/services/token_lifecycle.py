import logging
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass
import requests

from sqlalchemy.orm import Session
from app.models.models import FacebookPage, TokenType, SystemEvent
from app.core.config import settings
from app.services.security import decrypt_secret, encrypt_secret
from app.services.observability import record_event

logger = logging.getLogger(__name__)

@dataclass
class TokenHealthResult:
    is_valid: bool
    token_type: str | None
    expires_at: datetime | None
    days_remaining: int | None
    scopes: list[str]
    health_status: str


@dataclass
class RefreshResult:
    success: bool
    message: str
    new_expires_at: datetime | None = None


def detect_token_type(expires_at_ts: int | None = None) -> tuple[str, datetime | None]:
    """Detect token type based on expires_at timestamp returned by /debug_token api."""
    if expires_at_ts == 0 or expires_at_ts is None:
        return TokenType.system_user.value, None

    expires_dt = datetime.fromtimestamp(expires_at_ts, tz=timezone.utc).replace(tzinfo=None)
    days_remaining = (expires_dt - datetime.utcnow()).days
    if days_remaining > 50:
        return TokenType.long_lived.value, expires_dt
    return TokenType.short_lived.value, expires_dt


def check_token_health(page_id: str, db: Session) -> TokenHealthResult | None:
    page = db.query(FacebookPage).filter_by(page_id=page_id).first()
    if not page or not page.long_lived_access_token:
        return None

    if not settings.FB_APP_ID or not settings.FB_APP_SECRET:
        logger.warning("FB_APP_ID/FB_APP_SECRET chưa cấu hình, bỏ qua token health check.")
        page.token_health_status = "unknown"
        page.token_last_checked_at = datetime.utcnow()
        db.commit()
        return TokenHealthResult(
            is_valid=True,
            token_type=page.token_type.value if page.token_type else None,
            expires_at=page.token_expires_at,
            days_remaining=None,
            scopes=[],
            health_status="unknown"
        )

    raw_token = decrypt_secret(page.long_lived_access_token)
    app_access_token = f"{settings.FB_APP_ID}|{settings.FB_APP_SECRET}"
    url = f"https://graph.facebook.com/v21.0/debug_token?input_token={raw_token}&access_token={app_access_token}"

    try:
        resp = requests.get(url, timeout=10)
        data = resp.json().get("data", {})

        if resp.status_code != 200 or "error" in data:
            logger.warning(f"Lỗi khi debug_token: {resp.text}")
            return TokenHealthResult(
                is_valid=True, # default to keeping existing data
                token_type=page.token_type.value if page.token_type else None,
                expires_at=page.token_expires_at,
                days_remaining=None,
                scopes=[],
                health_status=page.token_health_status
            )

        is_valid = data.get("is_valid", False)
        if not is_valid:
            page.token_health_status = "invalid"
            page.token_last_checked_at = datetime.utcnow()
            db.commit()
            return TokenHealthResult(False, None, None, None, [], "invalid")

        expires_at_ts = data.get("expires_at", 0)
        token_type_val, expires_dt = detect_token_type(expires_at_ts)

        health_status = "valid"
        days_remaining = None
        if expires_dt:
            days_remaining = (expires_dt - datetime.utcnow()).days
            if days_remaining <= 0:
                health_status = "expired"
            elif days_remaining < 14:
                health_status = "expiring_soon"

        page.token_type = TokenType(token_type_val)
        page.token_expires_at = expires_dt
        page.token_health_status = health_status
        page.token_last_checked_at = datetime.utcnow()
        db.commit()

        return TokenHealthResult(
            is_valid=True,
            token_type=token_type_val,
            expires_at=expires_dt,
            days_remaining=days_remaining,
            scopes=data.get("scopes", []),
            health_status=health_status
        )
    except Exception as e:
        logger.error(f"Lỗi mạng khi debug_token: {e}")
        return TokenHealthResult(
            is_valid=True,
            token_type=page.token_type.value if page.token_type else None,
            expires_at=page.token_expires_at,
            days_remaining=None,
            scopes=[],
            health_status=page.token_health_status
        )


def check_all_tokens(db: Session) -> list[TokenHealthResult]:
    pages = db.query(FacebookPage).filter(FacebookPage.long_lived_access_token.isnot(None)).all()
    results = []
    for page in pages:
        result = check_token_health(page.page_id, db)
        if result:
            results.append(result)
    return results


def _exchange_user_token(current_token: str) -> dict:
    """
    Gọi Graph API để exchange Long-lived User Token → Long-lived User Token mới (60 ngày).
    Trả về dict với 'access_token' và 'expires_in' nếu thành công.
    Raise Exception nếu thất bại.
    """
    url = "https://graph.facebook.com/v21.0/oauth/access_token"
    params = {
        "grant_type": "fb_exchange_token",
        "client_id": settings.FB_APP_ID,
        "client_secret": settings.FB_APP_SECRET,
        "fb_exchange_token": current_token,
    }
    resp = requests.get(url, params=params, timeout=30)

    if resp.status_code != 200:
        raise ValueError(f"Facebook API trả về HTTP {resp.status_code}: {resp.text[:200]}")

    try:
        data = resp.json()
    except Exception:
        raise ValueError(f"Phản hồi không phải JSON từ exchange endpoint (HTTP {resp.status_code})")

    if "error" in data:
        err = data["error"]
        raise ValueError(
            f"Facebook API lỗi {err.get('code')}/{err.get('error_subcode')}: {err.get('message')}"
        )
    if "access_token" not in data:
        raise ValueError(f"Phản hồi không hợp lệ từ exchange endpoint: {data}")

    return data


def _derive_page_token(user_token: str, page_id: str) -> str:
    """
    Dùng Long-lived User Token để lấy Page Access Token từ GET /me/accounts.
    Raise Exception nếu không tìm thấy page_id hoặc API lỗi.
    """
    url = "https://graph.facebook.com/v21.0/me/accounts"
    params = {"access_token": user_token}

    while url:
        resp = requests.get(url, params=params, timeout=30)

        if resp.status_code != 200:
            raise ValueError(f"Facebook API trả về HTTP {resp.status_code}: {resp.text[:200]}")

        try:
            data = resp.json()
        except Exception:
            raise ValueError(f"Phản hồi không phải JSON từ /me/accounts (HTTP {resp.status_code})")

        if "error" in data:
            err = data["error"]
            raise ValueError(
                f"Facebook API lỗi khi lấy danh sách pages: {err.get('message')}"
            )

        for p in data.get("data", []):
            if p.get("id") == page_id:
                token = p.get("access_token")
                if not token:
                    raise ValueError(f"Page {page_id} không có access_token trong response.")
                return token

        # Follow pagination
        url = data.get("paging", {}).get("next")
        params = {}  # next URL đã chứa params

    raise ValueError(
        f"Không tìm thấy Page ID {page_id} trong danh sách pages của User Token này. "
        "User có thể không còn là admin của trang."
    )


def _verify_page_token(page_token: str, page_id: str) -> bool:
    """
    Verify page token bằng cách gọi GET /{page_id}?fields=id.
    Trả về True nếu token hợp lệ, False nếu không.
    """
    url = f"https://graph.facebook.com/v21.0/{page_id}"
    params = {"fields": "id", "access_token": page_token}
    try:
        resp = requests.get(url, params=params, timeout=10)
        if resp.status_code != 200:
            return False
        data = resp.json()
        return data.get("id") == page_id
    except Exception:
        return False


def refresh_long_lived_token(page_id: str, db: Session) -> RefreshResult:
    """
    Thực hiện auto-refresh Long-lived User Token cho một Facebook Page.

    Flow:
    1. Load page từ DB, validate pre-conditions
    2. Decrypt user_access_token
    3. Exchange user token → new long-lived user token
    4. Derive page access token từ new user token
    5. Atomic update: chỉ ghi đè DB sau khi CẢ HAI bước thành công

    Returns RefreshResult với success=True/False và message mô tả.
    """
    page = db.query(FacebookPage).filter_by(page_id=page_id).with_for_update().first()
    if not page:
        return RefreshResult(success=False, message=f"Không tìm thấy page {page_id}.")

    # Skip refresh cho System User Token (never-expire) và token chưa xác định type
    if page.token_type and page.token_type == TokenType.system_user:
        logger.info(f"Page {page_id} dùng System User Token (never-expire), bỏ qua refresh.")
        return RefreshResult(success=False, message="System User Token không cần refresh.")
    if not page.token_type:
        logger.info(f"Page {page_id} chưa xác định token type, bỏ qua refresh.")
        return RefreshResult(success=False, message="Token type chưa xác định — hãy chạy health check trước.")

    # Phải có user_access_token để refresh
    if not page.user_access_token:
        msg = "Bật auto-refresh nhưng chưa cung cấp User Token."
        record_event(
            "token", "warning", msg, db=db,
            details={"page_id": page_id}
        )
        page.token_refresh_error = msg
        db.commit()
        return RefreshResult(success=False, message=msg)

    # Chống double-refresh: bỏ qua nếu đã refresh trong vòng 1h gần đây
    if page.last_refresh_at:
        elapsed = datetime.utcnow() - page.last_refresh_at
        if elapsed < timedelta(hours=1):
            msg = f"Đã refresh gần đây ({int(elapsed.total_seconds() / 60)} phút trước), bỏ qua."
            logger.info(f"Page {page_id}: {msg}")
            return RefreshResult(success=False, message=msg)

    try:
        raw_user_token = decrypt_secret(page.user_access_token)
    except Exception:
        msg = "Không thể giải mã user_access_token — encryption key có thể đã thay đổi."
        record_event("token", "warning", "Làm mới token thất bại.", db=db,
                     details={"page_id": page_id, "error": msg})
        page.token_refresh_error = msg[:500]
        db.commit()
        return RefreshResult(success=False, message=msg)

    # Bước 1: Exchange user token
    try:
        exchange_data = _exchange_user_token(raw_user_token)
    except Exception as exc:
        msg = f"Exchange user token thất bại: {exc}"
        logger.warning(f"Page {page_id}: {msg}")
        record_event("token", "warning", "Làm mới token thất bại.", db=db,
                     details={"page_id": page_id, "error": str(exc)[:300]})
        page.token_refresh_error = msg[:500]
        db.commit()
        return RefreshResult(success=False, message=msg)

    new_user_token = exchange_data["access_token"]
    expires_in_seconds = exchange_data.get("expires_in", 5184000)  # default 60 ngày
    if not expires_in_seconds or expires_in_seconds <= 0:
        msg = f"expires_in không hợp lệ: {expires_in_seconds}"
        logger.warning(f"Page {page_id}: {msg}")
        record_event("token", "warning", "Làm mới token thất bại.", db=db,
                     details={"page_id": page_id, "error": msg})
        page.token_refresh_error = msg[:500]
        db.commit()
        return RefreshResult(success=False, message=msg)

    # Bước 2: Derive page token từ user token mới
    try:
        new_page_token = _derive_page_token(new_user_token, page_id)
    except Exception as exc:
        msg = f"Derive page token thất bại: {exc}"
        logger.warning(f"Page {page_id}: {msg}")
        record_event("token", "warning", "Làm mới token thất bại.", db=db,
                     details={"page_id": page_id, "error": str(exc)[:300]})
        page.token_refresh_error = msg[:500]
        db.commit()
        return RefreshResult(success=False, message=msg)

    # Bước 3: Verify page token mới hoạt động trước khi ghi đè DB
    if not _verify_page_token(new_page_token, page_id):
        msg = "Page token mới không hợp lệ sau khi derive — giữ nguyên token cũ."
        logger.warning(f"Page {page_id}: {msg}")
        record_event("token", "warning", "Làm mới token thất bại.", db=db,
                     details={"page_id": page_id, "error": msg})
        page.token_refresh_error = msg[:500]
        db.commit()
        return RefreshResult(success=False, message=msg)

    # Atomic update: chỉ ghi đè sau khi CẢ BA bước (exchange + derive + verify) thành công
    new_expires_at = datetime.utcnow() + timedelta(seconds=expires_in_seconds)
    page.user_access_token = encrypt_secret(new_user_token)
    page.long_lived_access_token = encrypt_secret(new_page_token)
    page.token_expires_at = new_expires_at
    page.token_health_status = "valid"
    page.token_last_checked_at = datetime.utcnow()
    page.last_refresh_at = datetime.utcnow()
    page.token_refresh_error = None
    db.commit()

    record_event(
        "token", "info", "Token đã làm mới thành công.", db=db,
        details={"page_id": page_id, "new_expires_at": new_expires_at.isoformat()}
    )
    logger.info(f"Page {page_id}: Token làm mới thành công, hết hạn {new_expires_at.isoformat()}.")
    return RefreshResult(success=True, message="Token đã làm mới thành công.", new_expires_at=new_expires_at)
