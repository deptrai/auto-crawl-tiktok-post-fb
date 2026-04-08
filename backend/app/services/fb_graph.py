from __future__ import annotations
import logging
import os
import time
from json import JSONDecodeError

import requests

logger = logging.getLogger(__name__)

GRAPH_API_BASE = "https://graph.facebook.com/v19.0"

def upload_video_to_facebook(file_path: str, caption: str, page_id: str, access_token: str):
    """ 
    Tải video trực tiếp lên Facebook Reels bằng Graph API 3 bước (khởi tạo -> tải lên -> công bố).
    Quy trình này ổn định hơn nhiều cho Reels so với việc đẩy file 1 lần.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Không tìm thấy file: {file_path}")

    # Nếu người dùng vẫn nhập URL webhook cũ, báo lỗi yêu cầu đổi sang mã truy cập thật
    if access_token.startswith("http://") or access_token.startswith("https://"):
        return {'error': 'Vui lòng thay URL webhook bằng mã truy cập trang Facebook thật trong cấu hình.'}

    try:
        # Giai đoạn 1: Khởi tạo
        logger.info(f"Khởi tạo tải Reels cho trang {page_id}...")
        init_url = f"{GRAPH_API_BASE}/{page_id}/video_reels"
        params = {
            'upload_phase': 'start',
            'access_token': access_token
        }
        res_init = requests.post(init_url, params=params, timeout=30)
        try:
            res_init_data = res_init.json()
        except (JSONDecodeError, ValueError):
            return {'error': f"Facebook trả lỗi không phải JSON (HTTP {res_init.status_code}). Thử lại sau."}

        if 'video_id' not in res_init_data:
            logger.error(f"Lỗi khởi tạo Reels (HTTP {res_init.status_code}): {res_init_data.get('error', {})}")
            return {'error': f"Lỗi khởi tạo Reels: {res_init_data.get('error', {}).get('message', 'Lỗi không xác định')}"}

        video_id = res_init_data['video_id']
        logger.info(f"Đã lấy mã video: {video_id}")

        # Giai đoạn 2: Tải lên - Dùng hạ tầng RUpload chuyên dụng
        logger.info("Đang tải dữ liệu video lên hạ tầng RUpload...")
        upload_url = f"https://rupload.facebook.com/video-upload/v19.0/{video_id}"

        file_size = os.path.getsize(file_path)
        with open(file_path, 'rb') as f:
            headers = {
                'Authorization': f'OAuth {access_token}',
                'offset': '0',
                'file_size': str(file_size),
                'X-Entity-Type': 'video/mp4',
                'X-Entity-Name': 'video.mp4'
            }
            # Tải toàn bộ tệp lên rupload
            res_upload = requests.post(
                upload_url,
                data=f,
                headers=headers,
                timeout=300 # Cho phép 5 phút để tải lên
            )

        try:
            res_upload_data = res_upload.json()
        except (JSONDecodeError, ValueError):
            return {'error': f"RUpload trả lỗi không phải JSON (HTTP {res_upload.status_code}). Thử lại sau."}
        # Chú ý: RUpload có thể trả về thành công theo kiểu khác, nên kiểm tra 'id' hoặc 'success'
        if 'id' not in res_upload_data and not res_upload_data.get('success'):
            logger.error(f"Lỗi RUpload (HTTP {res_upload.status_code}): {res_upload_data.get('error', {})}")
            return {'error': f"Lỗi tải video (RUpload): {res_upload_data.get('error', {}).get('message', 'Tải video thất bại')}"}

        # Giai đoạn 3: Hoàn tất và công bố
        logger.info("Đợi 20 giây để Facebook xử lý video trước khi công bố...")
        time.sleep(20) # Thời gian chờ rất quan trọng cho video lớn

        logger.info("Đang hoàn tất và công bố Reel...")
        publish_url = f"{GRAPH_API_BASE}/{page_id}/video_reels"
        publish_params = {
            'upload_phase': 'finish',
            'video_id': video_id,
            'video_state': 'PUBLISHED',
            'description': caption,
            'access_token': access_token
        }
        res_publish = requests.post(publish_url, params=publish_params, timeout=30)
        try:
            res_publish_data = res_publish.json()
        except (JSONDecodeError, ValueError):
            return {'error': f"Lỗi công bố: Facebook trả lỗi không phải JSON (HTTP {res_publish.status_code})."}

        if 'success' in res_publish_data and res_publish_data['success']:
            logger.info(f"Đã đăng Reel thành công. Mã video: {video_id}")
            return {'id': video_id}
        else:
            logger.error(f"Lỗi công bố Reel (HTTP {res_publish.status_code}): {res_publish_data.get('error', {})}")
            error_msg = res_publish_data.get('error', {}).get('message', 'Công bố thất bại')
            return {'error': f"Lỗi công bố: {error_msg}"}

    except Exception as e:
        logger.exception(f"Lỗi hệ thống khi đăng FB: {e}")
        return {'error': f"Lỗi hệ thống khi đăng FB: {str(e)}"}


def inspect_page_access(page_id: str, access_token: str):
    url = f"{GRAPH_API_BASE}/{page_id}"
    params = {
        "fields": "id,name,link,fan_count",
        "access_token": access_token,
    }
    try:
        response = requests.get(url, params=params, timeout=30)
        try:
            data = response.json()
        except (JSONDecodeError, ValueError):
            return {
                "ok": False,
                "message": f"Facebook trả lỗi không phải JSON (HTTP {response.status_code}).",
            }
    except Exception as exc:
        return {
            "ok": False,
            "message": f"Không thể kết nối tới Facebook Graph API: {exc}",
        }

    if "error" in data:
        return {
            "ok": False,
            "message": data["error"].get("message", "Mã truy cập không hợp lệ hoặc chưa đủ quyền."),
        }

    return {
        "ok": True,
        "message": f"Mã truy cập hợp lệ cho trang Facebook {data.get('name', page_id)}.",
        "page_id": data.get("id", page_id),
        "page_name": data.get("name"),
        "page_link": data.get("link"),
        "fan_count": data.get("fan_count"),
    }

def reply_to_comment(comment_id: str, message: str, access_token: str):
    """Trả lời bình luận thông qua Graph API."""
    url = f"https://graph.facebook.com/v19.0/{comment_id}/comments"
    data = {
        'message': message,
        'access_token': access_token
    }
    try:
        res = requests.post(url, data=data, timeout=30)
        try:
            res_data = res.json()
        except (JSONDecodeError, ValueError):
            logger.error(f"Phản hồi không phải JSON khi reply comment (HTTP {res.status_code})")
            return None
        if 'error' in res_data:
            logger.error(f"Graph API lỗi khi reply comment: {res_data['error'].get('message')}")
        return res_data
    except Exception as e:
        logger.error(f"Lỗi API trả lời Facebook: {e}")
        return None
