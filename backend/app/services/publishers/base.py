from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Dict, Any

class BasePublisher(ABC):
    """
    Interface cơ sở cho các dịch vụ Publish đa nền tảng.
    """
    
    @abstractmethod
    def upload_video(self, file_path: str, caption: str, account_id: str, access_token: str, video_url: str | None = None, **kwargs) -> Dict[str, Any]:
        """
        Thực hiện tải lên video.
        
        Args:
            file_path: Đường dẫn tới file video local.
            caption: Nội dung mô tả video (caption).
            account_id: ID của tài khoản/kênh/trang đích.
            access_token: Token xác thực.
            video_url: URL công khai của video (bắt buộc cho Instagram).
            **kwargs: Các tham số bổ sung tùy nền tảng.
            
        Returns:
            Dict chứa id của video đã đăng (ví dụ: {'id': '...'}) hoặc {'error': '...'} nếu lỗi.
        """
        pass