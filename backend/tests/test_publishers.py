import pytest
from unittest.mock import patch, MagicMock
from app.services.publishers.facebook import FacebookPublisher
from app.services.publishers.youtube import YouTubePublisher

def test_facebook_publisher_upload():
    publisher = FacebookPublisher()
    
    with patch("app.services.publishers.facebook.requests.post") as mock_post:
        # Mock 1: Khởi tạo
        mock_init = MagicMock()
        mock_init.json.return_value = {"video_id": "test_video_id"}
        
        # Mock 2: RUpload
        mock_rupload = MagicMock()
        mock_rupload.json.return_value = {"success": True}
        
        # Mock 3: Publish
        mock_publish = MagicMock()
        mock_publish.json.return_value = {"success": True}
        
        mock_post.side_effect = [mock_init, mock_rupload, mock_publish]
        
        with patch("app.services.publishers.facebook.os.path.exists", return_value=True), \
             patch("app.services.publishers.facebook.os.path.getsize", return_value=1024), \
             patch("builtins.open", new_callable=MagicMock), \
             patch("app.services.publishers.facebook.time.sleep"):
             
            result = publisher.upload_video("dummy.mp4", "caption", "123", "token")
            assert result == {"id": "test_video_id"}

def test_youtube_publisher_upload():
    publisher = YouTubePublisher()
    
    with patch("app.services.publishers.youtube.build") as mock_build, \
         patch("app.services.publishers.youtube.Credentials"), \
         patch("app.services.publishers.youtube.MediaFileUpload"), \
         patch("app.services.publishers.youtube.os.path.exists", return_value=True):
         
        mock_youtube = MagicMock()
        mock_build.return_value = mock_youtube
        
        mock_request = MagicMock()
        mock_youtube.videos().insert.return_value = mock_request
        
        mock_status = MagicMock()
        mock_status.progress.return_value = 1.0
        
        mock_response = {"id": "yt_video_id"}
        
        mock_request.next_chunk.return_value = (mock_status, mock_response)
        
        result = publisher.upload_video("dummy.mp4", "caption", "account_id", "token")
        assert result == {"id": "yt_video_id"}
