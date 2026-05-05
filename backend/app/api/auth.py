from fastapi import APIRouter, Depends, HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import jwt
from uuid import UUID

from app.core.database import get_db
from app.models.models import User, UserRole
from app.core.security import verify_password, get_password_hash, create_access_token, create_refresh_token
from app.schemas.users import Token, UserResponse
from pydantic import BaseModel
from app.core.config import settings
from app.services.observability import record_event
from app.services.security import (
    check_login_rate_limit,
    clear_login_rate_limit,
    get_client_identity,
    register_failed_login,
)

router = APIRouter(prefix="/auth", tags=["Xác thực"])
security = HTTPBearer()

class LoginRequest(BaseModel):
    email: str
    password: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

def require_authenticated_user(
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: Session = Depends(get_db),
) -> User:
    try:
        payload = jwt.decode(credentials.credentials, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Phiên đăng nhập đã hết hạn")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Mã truy cập không hợp lệ")

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Loại mã truy cập không hợp lệ")

    try:
        user_id = UUID(payload.get("sub", ""))
    except (ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Mã truy cập không hợp lệ")

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Tài khoản không còn hoạt động")
    return user


@router.post("/login", response_model=Token)
def login(creds: LoginRequest, request: Request, db: Session = Depends(get_db)):
    try:
        email = creds.email.strip().lower()
        client_id = get_client_identity(request)
        
        retry_after = check_login_rate_limit(client_id, email)
        if retry_after > 0:
            raise HTTPException(
                status_code=429,
                detail=f"Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau {retry_after} giây.",
            )

        user = db.query(User).filter(User.email == email).first()
        if user and user.is_active and verify_password(creds.password, user.hashed_password):
            clear_login_rate_limit(client_id, email)
            user.last_login_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
            
            access_token = create_access_token(user.id, role=user.role.value)
            refresh_token = create_refresh_token(user.id, role=user.role.value)
            
            record_event("auth", "info", "Đăng nhập thành công.", db=db, actor_user_id=str(user.id), details={"email": user.email, "ip": client_id})
            return {
                "access_token": access_token, 
                "refresh_token": refresh_token,
                "token_type": "bearer"
            }

        register_failed_login(client_id, email)
        record_event("auth", "warning", "Đăng nhập thất bại.", db=db, details={"email": email, "ip": client_id})
        raise HTTPException(status_code=401, detail="Sai email đăng nhập hoặc mật khẩu!")

    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(require_authenticated_user)):
    return current_user

@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(require_authenticated_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không chính xác.")

    current_user.hashed_password = get_password_hash(payload.new_password)
    current_user.must_change_password = False
    db.commit()
    record_event("auth", "info", "Người dùng đã đổi mật khẩu.", db=db, actor_user_id=str(current_user.id), details={"email": current_user.email})
    return {"message": "Đã cập nhật mật khẩu thành công."}

