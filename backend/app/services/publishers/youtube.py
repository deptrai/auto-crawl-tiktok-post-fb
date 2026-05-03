import logging
import os
import time
from typing import Dict, Any

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from googleapiclient.errors import HttpError

from app.services.publishers.base import BasePublisher

logger = logging.getLogger(__name__)

class YouTubePublisher(BasePublisher):
    def upload_video(self, file_path: str, caption: str, account_id: str, access_token: str, **kwargs) -> Dict[str, Any]:
        """
        Tải video lên YouTube Shorts sử dụng Resumable Upload (YouTube Data API v3).
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Không tìm thấy file: {file_path}")
            
        refresh_token = kwargs.get("refresh_token")
        client_id = kwargs.get("client_id")
        client_secret = kwargs.get("client_secret")

        try:
            # Tạo credentials, google-api-python-client có thể tự auto-refresh nếu có refresh_token
            creds = Credentials(
                token=access_token,
                refresh_token=refresh_token,
                token_uri="https://oauth2.googleapis.com/token",
                client_id=client_id,
                client_secret=client_secret
            )

            youtube = build('youtube', 'v3', credentials=creds)

            # Tạo title (lấy câu đầu tiên của caption hoặc tối đa 80 ký tự)
            title = caption.split('\n')[0].strip()
            if len(title) > 80:
                title = title[:77] + "..."
            
            # Luôn thêm #shorts vào description để YouTube nhận dạng
            description = caption
            if "#shorts" not in description.lower():
                description += "\n\n#shorts"

            body = {
                'snippet': {
                    'title': title,
                    'description': description,
                    'categoryId': '22', # People & Blogs default
                },
                'status': {
                    'privacyStatus': 'public',
                    'selfDeclaredMadeForKids': False
                }
            }

            # Resumable upload chunk size (ví dụ: 1MB)
            media = MediaFileUpload(file_path, mimetype='video/mp4', resumable=True, chunksize=1024*1024)

            logger.info(f"Bắt đầu upload YouTube Shorts cho channel {account_id}...")
            request = youtube.videos().insert(
                part=','.join(body.keys()),
                body=body,
                media_body=media
            )

            response = None
            while response is None:
                status, response = request.next_chunk()
                if status:
                    logger.info(f"Uploaded {int(status.progress() * 100)}%")

            logger.info(f"Đã upload thành công lên YouTube. Video ID: {response['id']}")
            return {'id': response['id']}

        except HttpError as e:
            logger.error(f"YouTube API Error: {e.resp.status} - {e.content}")
            if e.resp.status == 403 and "quota" in str(e.content).lower():
                return {'error': 'RATE_LIMITED: YouTube Quota Exceeded.'}
            return {'error': f"Lỗi YouTube API: {e.content.decode('utf-8') if isinstance(e.content, bytes) else e.content}"}
        except Exception as e:
            logger.exception(f"Lỗi hệ thống khi đăng YouTube: {e}")
            return {'error': f"Lỗi hệ thống khi đăng YouTube: {str(e)}"}
