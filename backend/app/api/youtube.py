import os
from datetime import datetime, timezone
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
import google_auth_oauthlib.flow

from app.core.config import settings
from app.core.database import get_db
from app.models.models import YouTubeChannel
from app.api.auth import require_authenticated_user

router = APIRouter(prefix="/youtube", tags=["YouTube"])
logger = logging.getLogger(__name__)

# Scopes cần thiết để upload video
SCOPES = ['https://www.googleapis.com/auth/youtube.upload']

# Thư mục lưu credentials tĩnh nếu có, 
# hoặc lấy credentials từ biến môi trường (khuyến khích)
def get_flow():
    # Client ID và Secret cho OAuth 2.0 Client ID (Web application)
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    
    if not client_id or not client_secret:
        raise HTTPException(status_code=500, detail="Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET")

    client_config = {
        "web": {
            "client_id": client_id,
            "project_id": "medirus",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "client_secret": client_secret,
            "redirect_uris": [f"{settings.BASE_URL}/api/youtube/callback"]
        }
    }
    
    return google_auth_oauthlib.flow.Flow.from_client_config(
        client_config,
        scopes=SCOPES
    )

@router.get("/auth")
def youtube_auth(request: Request, db: Session = Depends(require_authenticated_user)):
    """Tạo URL để chuyển hướng người dùng đến Google OAuth consent screen."""
    try:
        flow = get_flow()
        flow.redirect_uri = f"{settings.BASE_URL}/api/youtube/callback"
        
        # Bắt buộc yêu cầu prompt='consent' để nhận refresh_token (chỉ nhận lần đầu nếu không có prompt)
        authorization_url, state = flow.authorization_url(
            access_type='offline',
            include_granted_scopes='true',
            prompt='consent'
        )
        return {"url": authorization_url}
    except Exception as e:
        logger.error(f"Lỗi khởi tạo luồng Google OAuth: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/callback")
def youtube_callback(request: Request, db: Session = Depends(get_db)):
    """Xử lý OAuth2 callback từ Google, lưu token."""
    code = request.query_params.get("code")
    if not code:
        raise HTTPException(status_code=400, detail="Missing code parameter")
        
    try:
        flow = get_flow()
        flow.redirect_uri = f"{settings.BASE_URL}/api/youtube/callback"
        
        # Đổi code lấy token
        flow.fetch_token(code=code)
        credentials = flow.credentials
        
        # Lấy thông tin cơ bản về kênh (nếu cần thiết phải query thêm API, tạm thời lưu token)
        # Vì chỉ có scope upload nên ta tạm gán id = 1 hoặc id = email nếu xin thêm scope
        # Tạm thời gán channel_id mặc định vì ta chỉ upload lên 1 kênh cấu hình
        channel_id = "default_channel" # Trong thực tế cần xin scope profile để lấy ID
        
        channel = db.query(YouTubeChannel).filter(YouTubeChannel.channel_id == channel_id).first()
        if not channel:
            channel = YouTubeChannel(channel_id=channel_id)
            db.add(channel)
            
        channel.access_token = credentials.token
        if credentials.refresh_token:
            channel.refresh_token = credentials.refresh_token
        
        if credentials.expiry:
            # expiry là chuỗi datetime hoặc đối tượng
            channel.token_expires_at = credentials.expiry
            
        channel.channel_name = "Kênh YouTube mặc định"
        db.commit()
        
        return {"message": "Kết nối YouTube thành công!", "channel_id": channel_id}
    except Exception as e:
        logger.error(f"Lỗi YouTube callback: {e}")
        raise HTTPException(status_code=500, detail=f"Lỗi xác thực YouTube: {str(e)}")

@router.get("/channels")
def list_youtube_channels(current_user=Depends(require_authenticated_user), db: Session = Depends(get_db)):
    channels = db.query(YouTubeChannel).all()
    return [{
        "channel_id": c.channel_id,
        "channel_name": c.channel_name,
        "has_refresh_token": bool(c.refresh_token),
        "expires_at": c.token_expires_at.isoformat() if c.token_expires_at else None
    } for c in channels]
