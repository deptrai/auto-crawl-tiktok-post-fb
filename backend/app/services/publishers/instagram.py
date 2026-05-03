import logging
import os
import time
from json import JSONDecodeError
from typing import Dict, Any

import requests

from app.core.config import settings
from app.services.publishers.base import BasePublisher

logger = logging.getLogger(__name__)

GRAPH_API_BASE = "https://graph.facebook.com/v19.0"

class InstagramPublisher(BasePublisher):
    def get_ig_user_id(self, page_id: str, access_token: str) -> str:
        """Lấy Instagram Business Account ID từ Facebook Page ID."""
        url = f"{GRAPH_API_BASE}/{page_id}"
        params = {
            'fields': 'instagram_business_account',
            'access_token': access_token
        }
        res = requests.get(url, params=params, timeout=30)
        
        try:
            data = res.json()
        except (JSONDecodeError, ValueError):
            raise RuntimeError(f"Lỗi lấy IG User ID: Facebook trả lỗi không phải JSON (HTTP {res.status_code})")

        if 'error' in data:
            raise RuntimeError(f"Lỗi Graph API khi lấy IG Account: {data['error'].get('message')}")

        ig_account = data.get("instagram_business_account")
        if not isinstance(ig_account, dict) or "id" not in ig_account:
            raise ValueError("Fanpage không có Instagram Business Account được liên kết.")
            
        return ig_account["id"]

    def upload_video(self, file_path: str, caption: str, account_id: str, access_token: str, video_url: str | None = None, **kwargs) -> Dict[str, Any]:
        """
        Đăng video lên Instagram Reels qua luồng Container.
        - account_id: ở đây là Facebook Page ID, ta sẽ fetch IG User ID từ đó.
        - video_url: phải là URL public.
        """
        if not video_url:
            return {'error': 'Cần video_url để đăng lên Instagram Reels.'}

        try:
            logger.info(f"Lấy IG User ID từ Page {account_id}...")
            ig_user_id = self.get_ig_user_id(account_id, access_token)
            logger.info(f"IG User ID: {ig_user_id}")

            # Bước 1: Khởi tạo Container
            logger.info(f"Khởi tạo Container upload Reels cho IG {ig_user_id}...")
            init_url = f"{GRAPH_API_BASE}/{ig_user_id}/media"
            params = {
                'media_type': 'REELS',
                'video_url': video_url,
                'caption': caption,
                'share_to_feed': 'true',
                'access_token': access_token
            }
            res_init = requests.post(init_url, params=params, timeout=30)
            
            try:
                res_init_data = res_init.json()
            except (JSONDecodeError, ValueError):
                return {'error': f"Khởi tạo IG Container trả lỗi không phải JSON (HTTP {res_init.status_code})."}

            if 'id' not in res_init_data:
                logger.error(f"Lỗi khởi tạo Container (HTTP {res_init.status_code}): {res_init_data.get('error', {})}")
                return {'error': f"Lỗi khởi tạo IG Container: {res_init_data.get('error', {}).get('message', 'Lỗi không xác định')}"}

            container_id = res_init_data['id']
            logger.info(f"Đã tạo Container IG: {container_id}")

            # Bước 2: Polling status (Wait for rendering)
            status_url = f"{GRAPH_API_BASE}/{container_id}"
            status_params = {
                'fields': 'status_code,status',
                'access_token': access_token
            }
            
            max_polls = 12
            poll_interval = 10 # seconds
            
            for i in range(max_polls):
                logger.info(f"Polling IG Container status lần {i+1}...")
                try:
                    res_status = requests.get(status_url, params=status_params, timeout=30)
                    try:
                        status_data = res_status.json()
                    except (JSONDecodeError, ValueError):
                        logger.warning(f"Polling IG trả lỗi không phải JSON (HTTP {res_status.status_code}). Thử lại...")
                        time.sleep(poll_interval)
                        continue
                    
                    status_code = status_data.get('status_code')
                    if status_code == 'FINISHED':
                        logger.info("Container render xong.")
                        break
                    elif status_code == 'ERROR':
                        logger.error(f"Lỗi render IG: {status_data}")
                        return {'error': f"Lỗi xử lý video từ phía Instagram: {status_data.get('status', 'Unknown error')}"}
                    elif status_code == 'EXPIRED':
                        return {'error': 'IG Container hết hạn xử lý (quá 24h).'}
                    elif status_code == 'IN_PROGRESS':
                        time.sleep(poll_interval)
                    else:
                        logger.warning(f"Unknown status: {status_code}. Thử lại...")
                        time.sleep(poll_interval)
                except requests.RequestException as e:
                    logger.warning(f"Lỗi mạng khi polling IG: {e}. Thử lại...")
                    time.sleep(poll_interval)
            else:
                return {'error': 'Timeout khi chờ Instagram render video.'}

            # Bước 3: Publish Container
            logger.info("Đang Publish IG Container...")
            publish_url = f"{GRAPH_API_BASE}/{ig_user_id}/media_publish"
            publish_params = {
                'creation_id': container_id,
                'access_token': access_token
            }
            res_publish = requests.post(publish_url, params=publish_params, timeout=30)
            
            try:
                res_publish_data = res_publish.json()
            except (JSONDecodeError, ValueError):
                return {'error': f"Publish IG trả lỗi không phải JSON (HTTP {res_publish.status_code})."}

            if 'id' in res_publish_data:
                video_id = res_publish_data['id']
                logger.info(f"Đã đăng Reel thành công. Mã video: {video_id}")
                return {'id': video_id}
            else:
                logger.error(f"Lỗi công bố IG Reel (HTTP {res_publish.status_code}): {res_publish_data.get('error', {})}")
                error_msg = res_publish_data.get('error', {}).get('message', 'Công bố thất bại')
                return {'error': f"Lỗi công bố IG: {error_msg}"}

        except Exception as e:
            logger.exception(f"Lỗi hệ thống khi đăng Instagram: {e}")
            return {'error': f"Lỗi hệ thống khi đăng Instagram: {str(e)}"}
