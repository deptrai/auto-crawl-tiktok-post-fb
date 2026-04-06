import logging
from datetime import datetime, timezone
from dataclasses import dataclass
import requests

from sqlalchemy.orm import Session
from app.models.models import FacebookPage, TokenType, SystemEvent
from app.core.config import settings
from app.services.security import decrypt_secret

logger = logging.getLogger(__name__)

@dataclass
class TokenHealthResult:
    is_valid: bool
    token_type: str | None
    expires_at: datetime | None
    days_remaining: int | None
    scopes: list[str]
    health_status: str


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
