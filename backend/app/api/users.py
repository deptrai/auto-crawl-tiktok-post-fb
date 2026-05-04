from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List
import re

from app.api.auth import require_super_admin
from app.core.database import get_db
from app.models.models import User, UserRole
from app.schemas.users import UserCreate, UserUpdate, UserResponse
from app.core.security import get_password_hash
from app.services.observability import record_event

router = APIRouter(prefix="/users", tags=["Người dùng"])

def validate_email(email: str):
    if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
        raise HTTPException(status_code=400, detail="Email không hợp lệ.")

def parse_uuid_or_400(raw_id: str):
    try:
        return UUID(raw_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Mã người dùng không hợp lệ.")

@router.get("/", response_model=List[UserResponse])
def get_users(
    admin_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    users = db.query(User).order_by(User.created_at.desc()).all()
    return users

@router.post("/", response_model=UserResponse)
def create_user(
    payload: UserCreate,
    admin_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    email = payload.email.strip().lower()
    validate_email(email)
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=400, detail="Email đã tồn tại.")

    user = User(
        email=email,
        full_name=payload.full_name,
        hashed_password=get_password_hash(payload.password),
        role=payload.role,
        is_active=payload.is_active,
        avatar_url=payload.avatar_url,
        must_change_password=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    record_event("auth", "info", "Đã tạo người dùng mới.", db=db, actor_user_id=str(admin_user.id), details={"email": user.email, "role": user.role.value})
    return user

@router.patch("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: str,
    payload: UserUpdate,
    admin_user: User = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    target_uuid = parse_uuid_or_400(user_id)
    user = db.query(User).filter(User.id == target_uuid).first()
    if not user:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng.")

    update_data = payload.model_dump(exclude_unset=True)
    
    # Whitelist các trường được phép update
    allowed_fields = {"email", "full_name", "role", "is_active", "password", "avatar_url"}
    update_data = {k: v for k, v in update_data.items() if k in allowed_fields}

    # Kiểm tra email trùng
    if "email" in update_data:
        new_email = update_data["email"].strip().lower()
        validate_email(new_email)
        if db.query(User).filter(User.email == new_email, User.id != target_uuid).first():
            raise HTTPException(status_code=400, detail="Email đã tồn tại ở tài khoản khác.")
        update_data["email"] = new_email

    # Ngăn Admin tự khóa hoặc hạ quyền chính mình
    if target_uuid == admin_user.id:
        if "is_active" in update_data and not update_data["is_active"]:
            raise HTTPException(status_code=400, detail="Bạn không thể tự khóa tài khoản của chính mình.")
        if "role" in update_data and update_data["role"] != UserRole.super_admin:
            raise HTTPException(status_code=400, detail="Bạn không thể tự hạ cấp quyền Super Admin của chính mình.")

    if "password" in update_data and update_data["password"]:
        update_data["hashed_password"] = get_password_hash(update_data.pop("password"))
        update_data["must_change_password"] = True
    elif "password" in update_data:
        update_data.pop("password")

    for key, value in update_data.items():
        setattr(user, key, value)

    db.commit()
    db.refresh(user)
    
    record_event("auth", "info", "Đã cập nhật thông tin người dùng.", db=db, actor_user_id=str(admin_user.id), details={"target_email": user.email})
    return user
