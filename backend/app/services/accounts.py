from __future__ import annotations
import secrets
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.models import User, UserRole
from app.services.observability import record_event
from app.core.security import get_password_hash

def serialize_user(user: User) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "avatar_url": user.avatar_url,
        "role": user.role.value if hasattr(user.role, "value") else user.role,
        "is_active": user.is_active,
        "must_change_password": user.must_change_password,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
    }

def ensure_default_admin(db: Session) -> User:
    # Ưu tiên root admin từ config mới
    root_email = settings.ROOT_ADMIN_EMAIL
    existing = db.query(User).filter(User.email == root_email).first()
    if existing:
        return existing

    default_admin = User(
        email=root_email,
        full_name=settings.DEFAULT_ADMIN_DISPLAY_NAME,
        hashed_password=get_password_hash(settings.ROOT_ADMIN_PASSWORD),
        role=UserRole.super_admin,
        is_active=True,
        must_change_password=True,
    )
    db.add(default_admin)
    db.commit()
    db.refresh(default_admin)
    record_event(
        "auth",
        "warning",
        "Đã tạo tài khoản quản trị mặc định.",
        db=db,
        details={"email": default_admin.email},
    )
    return default_admin

def count_admin_users(db: Session, *, active_only: bool = False, exclude_user_id: str | None = None) -> int:
    query = db.query(User).filter(User.role == UserRole.super_admin)
    if active_only:
        query = query.filter(User.is_active.is_(True))
    if exclude_user_id:
        query = query.filter(User.id != exclude_user_id)
    return query.count()

def generate_temporary_password(length: int = 12) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))
