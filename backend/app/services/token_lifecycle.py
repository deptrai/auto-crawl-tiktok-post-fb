from __future__ import annotations
import logging
import time
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass
import requests

from sqlalchemy.orm import Session
from app.models.models import FacebookPage, TokenType, SystemEvent
from app.core.config import settings
from app.services.security import decrypt_secret, encrypt_secret
from app.services.observability import record_event

logger = logging.getLogger(__name__)

# Health status constants — single source of truth cho token_health_status values
HEALTH_VALID = "valid"
HEALTH_EXPIRING_SOON = "expiring_soon"
HEALTH_EXPIRED = "expired"
HEALTH_INVALID = "invalid"
HEALTH_UNKNOWN = "unknown"

# Facebook long-lived token có TTL ~60 ngày. Token có days_remaining > ngưỡng này
# được coi là long_lived; dưới ngưỡng là short_lived (~1h).
LONG_LIVED_TOKEN_MIN_DAYS = 50

@dataclass
class TokenHealthResult:
    is_valid: bool
    token_type: str | None
    expires_at: datetime | None
    days_remaining: int | None
    scopes: list[str]
    health_status: str
    page_id: str | None = None


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
    days_remaining = (expires_dt - datetime.now(timezone.utc).replace(tzinfo=None)).days
    if days_remaining > LONG_LIVED_TOKEN_MIN_DAYS:
        return TokenType.long_lived.value, expires_dt
    return TokenType.short_lived.value, expires_dt


def check_token_health(page_id: str, db: Session, *, page: FacebookPage | None = None) -> TokenHealthResult | None:
    if page is None:
        page = db.query(FacebookPage).filter_by(page_id=page_id).first()
    if not page or not page.long_lived_access_token:
        return None

    if not settings.FB_APP_ID or not settings.FB_APP_SECRET:
        logger.warning("FB_APP_ID/FB_APP_SECRET chưa cấu hình, bỏ qua token health check.")
        page.token_health_status = HEALTH_UNKNOWN
        page.token_last_checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        return TokenHealthResult(
            is_valid=False,  # Không thể xác minh → is_valid=False để caller biết không validate được
            token_type=page.token_type.value if page.token_type else None,
            expires_at=page.token_expires_at,
            days_remaining=None,
            scopes=[],
            health_status=HEALTH_UNKNOWN
        )

    try:
        raw_token = decrypt_secret(page.long_lived_access_token)
    except Exception as exc:
        logger.error(f"Page {page_id}: không thể giải mã long_lived_access_token — {exc}")
        page.token_health_status = HEALTH_INVALID
        page.token_last_checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
        return TokenHealthResult(False, None, None, None, [], HEALTH_INVALID)

    app_access_token = f"{settings.FB_APP_ID}|{settings.FB_APP_SECRET}"
    # C1: Dùng params= dict thay vì nội suy vào URL để tránh token/secret bị ghi vào server log
    try:
        resp = requests.get(
            "https://graph.facebook.com/v21.0/debug_token",
            params={"input_token": raw_token, "access_token": app_access_token},
            timeout=10,
        )
        data = resp.json().get("data", {})

        if resp.status_code != 200:
            # C2: HTTP error → không thể xác minh, HEALTH_UNKNOWN (không update DB)
            logger.warning(f"Lỗi khi debug_token: HTTP {resp.status_code}")
            return TokenHealthResult(
                is_valid=False,
                token_type=page.token_type.value if page.token_type else None,
                expires_at=page.token_expires_at,
                days_remaining=None,
                scopes=[],
                health_status=HEALTH_UNKNOWN
            )

        # HTTP 200: is_valid=false (kể cả khi có "error" trong data) → token không hợp lệ
        is_valid = data.get("is_valid", False)
        if not is_valid:
            page.token_health_status = HEALTH_INVALID
            page.token_last_checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
            return TokenHealthResult(False, None, None, None, [], HEALTH_INVALID)

        expires_at_ts = data.get("expires_at", 0)
        token_type_val, expires_dt = detect_token_type(expires_at_ts)

        health_status = HEALTH_VALID
        days_remaining = None
        if expires_dt:
            days_remaining = (expires_dt - datetime.now(timezone.utc).replace(tzinfo=None)).days
            if days_remaining <= 0:
                health_status = HEALTH_EXPIRED
            elif days_remaining < 14:
                health_status = HEALTH_EXPIRING_SOON

        page.token_type = TokenType(token_type_val)
        page.token_expires_at = expires_dt
        page.token_health_status = health_status
        page.token_last_checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
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
        # C2: Lỗi mạng → không thể xác minh, KHÔNG giả định is_valid=True
        logger.error(f"Lỗi mạng khi debug_token: {e}")
        return TokenHealthResult(
            is_valid=False,
            token_type=page.token_type.value if page.token_type else None,
            expires_at=page.token_expires_at,
            days_remaining=None,
            scopes=[],
            health_status=HEALTH_UNKNOWN
        )


_EVENT_LEVEL = {
    HEALTH_EXPIRING_SOON: "warning",
    HEALTH_EXPIRED: "error",
    HEALTH_INVALID: "error",
    HEALTH_UNKNOWN: "warning",
    HEALTH_VALID: "info",
}


def check_all_tokens(db: Session) -> list[TokenHealthResult]:
    pages = db.query(FacebookPage).filter(FacebookPage.long_lived_access_token.isnot(None)).all()
    results = []
    for page in pages:
        previous_status = page.token_health_status
        result = check_token_health(page.page_id, db, page=page)
        if result:
            result.page_id = page.page_id
            results.append(result)
            new_status = result.health_status
            # Smart logging: only write event when status actually changes.
            # Skip HEALTH_UNKNOWN — transient network errors don't commit to DB,
            # so previous_status stays stale and would trigger duplicate events.
            if new_status != previous_status and new_status != HEALTH_UNKNOWN:
                level = _EVENT_LEVEL.get(new_status, "info")
                record_event(
                    "token",
                    level,
                    f"Token health changed: {previous_status} → {new_status} for page {page.page_name}",
                    db=db,
                    details={
                        "page_id": page.page_id,
                        "page_name": page.page_name,
                        "previous_status": previous_status,
                        "new_status": new_status,
                        "days_remaining": result.days_remaining,
                    },
                )
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
    # M3: Retry tối đa 2 lần khi Facebook API trả 5xx (transient)
    resp = None
    for attempt in range(3):
        resp = requests.get(url, params=params, timeout=30)
        if resp.status_code < 500:
            break
        if attempt < 2:
            time.sleep(2 ** attempt)

    if resp.status_code != 200:
        try:
            err_data = resp.json().get("error", {})
            err_msg = f"code={err_data.get('code')}, message={err_data.get('message', 'unknown')}"
        except Exception:
            err_msg = "(không parse được response)"
        raise ValueError(f"Facebook API trả về HTTP {resp.status_code}: {err_msg}")

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
        raise ValueError("Phản hồi không hợp lệ từ exchange endpoint: thiếu access_token")

    return data


def _derive_page_token(user_token: str, page_id: str) -> str:
    """
    Dùng Long-lived User Token để lấy Page Access Token từ GET /me/accounts.
    Raise Exception nếu không tìm thấy page_id hoặc API lỗi.
    """
    url = "https://graph.facebook.com/v21.0/me/accounts"
    params = {"access_token": user_token}
    max_pages = 50
    page_count = 0

    while url:
        page_count += 1
        if page_count > max_pages:
            break
        # M3: Retry tối đa 2 lần khi Facebook API trả 5xx (transient)
        resp = None
        for attempt in range(3):
            resp = requests.get(url, params=params, timeout=30)
            if resp.status_code < 500:
                break
            if attempt < 2:
                time.sleep(2 ** attempt)

        if resp.status_code != 200:
            try:
                err_data = resp.json().get("error", {})
                err_msg = f"code={err_data.get('code')}, message={err_data.get('message', 'unknown')}"
            except Exception:
                err_msg = "(không parse được response)"
            raise ValueError(f"Facebook API trả về HTTP {resp.status_code}: {err_msg}")

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
        page.token_refresh_error = msg
        db.commit()
        record_event(
            "token", "warning", msg, db=db,
            details={"page_id": page_id}
        )
        return RefreshResult(success=False, message=msg)

    # Chống double-refresh: bỏ qua nếu đã refresh trong vòng 1h gần đây
    if page.last_refresh_at:
        elapsed = datetime.now(timezone.utc).replace(tzinfo=None) - page.last_refresh_at
        if elapsed < timedelta(hours=1):
            msg = f"Đã refresh gần đây ({int(elapsed.total_seconds() / 60)} phút trước), bỏ qua."
            logger.info(f"Page {page_id}: {msg}")
            return RefreshResult(success=False, message=msg)

    try:
        raw_user_token = decrypt_secret(page.user_access_token)
    except Exception:
        msg = "Không thể giải mã user_access_token — encryption key có thể đã thay đổi."
        page.token_refresh_error = msg[:500]
        db.commit()
        record_event("token", "warning", "Làm mới token thất bại.", db=db,
                     details={"page_id": page_id, "error": msg})
        return RefreshResult(success=False, message=msg)

    # Bước 1: Exchange user token
    try:
        exchange_data = _exchange_user_token(raw_user_token)
    except Exception as exc:
        msg = f"Exchange user token thất bại: {exc}"
        logger.warning(f"Page {page_id}: {msg}")
        page.token_refresh_error = msg[:500]
        db.commit()
        record_event("token", "warning", "Làm mới token thất bại.", db=db,
                     details={"page_id": page_id, "error": str(exc)[:300]})
        return RefreshResult(success=False, message=msg)

    new_user_token = exchange_data["access_token"]
    expires_in_seconds = exchange_data.get("expires_in", 5184000)  # default 60 ngày
    if not expires_in_seconds or expires_in_seconds <= 0:
        msg = f"expires_in không hợp lệ: {expires_in_seconds}"
        logger.warning(f"Page {page_id}: {msg}")
        page.token_refresh_error = msg[:500]
        db.commit()
        record_event("token", "warning", "Làm mới token thất bại.", db=db,
                     details={"page_id": page_id, "error": msg})
        return RefreshResult(success=False, message=msg)

    # Bước 2: Derive page token từ user token mới
    try:
        new_page_token = _derive_page_token(new_user_token, page_id)
    except Exception as exc:
        msg = f"Derive page token thất bại: {exc}"
        logger.warning(f"Page {page_id}: {msg}")
        page.token_refresh_error = msg[:500]
        db.commit()
        record_event("token", "warning", "Làm mới token thất bại.", db=db,
                     details={"page_id": page_id, "error": str(exc)[:300]})
        return RefreshResult(success=False, message=msg)

    # Bước 3: Verify page token mới hoạt động trước khi ghi đè DB
    if not _verify_page_token(new_page_token, page_id):
        msg = "Page token mới không hợp lệ sau khi derive — giữ nguyên token cũ."
        logger.warning(f"Page {page_id}: {msg}")
        page.token_refresh_error = msg[:500]
        db.commit()
        record_event("token", "warning", "Làm mới token thất bại.", db=db,
                     details={"page_id": page_id, "error": msg})
        return RefreshResult(success=False, message=msg)

    # Atomic update: chỉ ghi đè sau khi CẢ BA bước (exchange + derive + verify) thành công
    new_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=expires_in_seconds)
    page.user_access_token = encrypt_secret(new_user_token)
    page.long_lived_access_token = encrypt_secret(new_page_token)
    page.token_expires_at = new_expires_at
    page.token_health_status = HEALTH_VALID
    page.token_last_checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
    page.last_refresh_at = datetime.now(timezone.utc).replace(tzinfo=None)
    page.token_refresh_error = None
    # NOTE: token_expires_at tính từ user token TTL (expires_in) vì page token derived
    # từ long-lived user token thường never-expire. Sau commit, check_token_health sẽ
    # gọi debug_token để lấy TTL thực nếu cần.
    db.commit()

    record_event(
        "token", "info", "Token đã làm mới thành công.", db=db,
        details={"page_id": page_id, "new_expires_at": new_expires_at.isoformat()}
    )

    # H1: Load fresh từ DB (không dùng page object đã stale sau commit) để tránh
    # ghi đè health_status đúng nếu debug_token trả kết quả khác do propagation delay.
    try:
        check_token_health(page_id, db)
    except Exception as exc:
        logger.warning(f"Page {page_id}: post-refresh health check thất bại: {exc}")

    logger.info(f"Page {page_id}: Token làm mới thành công, hết hạn {page.token_expires_at}.")
    return RefreshResult(success=True, message="Token đã làm mới thành công.", new_expires_at=page.token_expires_at)
