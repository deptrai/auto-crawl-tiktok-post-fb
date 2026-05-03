import pytest
from unittest.mock import patch, MagicMock
from app.services.publishers.instagram import InstagramPublisher

def test_instagram_publisher_upload():
    publisher = InstagramPublisher()
    
    with patch("app.services.publishers.instagram.requests.get") as mock_get, \
         patch("app.services.publishers.instagram.requests.post") as mock_post, \
         patch("app.services.publishers.instagram.time.sleep"):
        
        # Mock get_ig_user_id
        mock_ig_resp = MagicMock()
        mock_ig_resp.json.return_value = {"instagram_business_account": {"id": "test_ig_user_id"}}
        
        # Mock Container status polling (1st time IN_PROGRESS, 2nd time FINISHED)
        mock_status_progress = MagicMock()
        mock_status_progress.json.return_value = {"status_code": "IN_PROGRESS"}
        mock_status_finished = MagicMock()
        mock_status_finished.json.return_value = {"status_code": "FINISHED"}
        
        mock_get.side_effect = [mock_ig_resp, mock_status_progress, mock_status_finished]
        
        # Mock init container
        mock_init = MagicMock()
        mock_init.json.return_value = {"id": "test_container_id"}
        
        # Mock publish container
        mock_publish = MagicMock()
        mock_publish.json.return_value = {"id": "test_ig_media_id"}
        
        mock_post.side_effect = [mock_init, mock_publish]
        
        result = publisher.upload_video("dummy.mp4", "caption", "fb_page_123", "token", video_url="http://public.url/video.mp4")
        assert result == {"id": "test_ig_media_id"}
