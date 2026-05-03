import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

def test_youtube_auth_endpoint(client: TestClient, db_session, auth_headers):
    with patch("app.api.youtube.get_flow") as mock_get_flow:
        mock_flow = MagicMock()
        mock_flow.authorization_url.return_value = ("https://accounts.google.com/o/oauth2/auth?test", "state")
        mock_get_flow.return_value = mock_flow
        
        response = client.get("/youtube/auth", headers=auth_headers)
        
        assert response.status_code == 200
        assert "url" in response.json()
        assert "https://accounts.google.com" in response.json()["url"]

def test_youtube_callback_missing_code(client: TestClient):
    response = client.get("/youtube/callback")
    assert response.status_code == 400
    assert "Missing code" in response.json()["detail"]

def test_youtube_callback_success(client: TestClient, db_session):
    with patch("app.api.youtube.get_flow") as mock_get_flow:
        mock_flow = MagicMock()
        
        mock_credentials = MagicMock()
        mock_credentials.token = "test_access_token"
        mock_credentials.refresh_token = "test_refresh_token"
        mock_credentials.expiry = None
        
        mock_flow.credentials = mock_credentials
        mock_get_flow.return_value = mock_flow
        
        response = client.get("/youtube/callback?code=test_code")
        
        assert response.status_code == 200
        assert "thành công" in response.json()["message"]
        
        from app.models.models import YouTubeChannel
        channel = db_session.query(YouTubeChannel).filter_by(channel_id="default_channel").first()
        assert channel is not None
        assert channel.access_token == "test_access_token"
        assert channel.refresh_token == "test_refresh_token"

def test_list_youtube_channels(client: TestClient, db_session, auth_headers):
    from app.models.models import YouTubeChannel
    channel = YouTubeChannel(channel_id="test_channel", channel_name="Test", access_token="abc", refresh_token="def")
    db_session.add(channel)
    db_session.commit()
    
    response = client.get("/youtube/channels", headers=auth_headers)
    
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    
    test_chan = next(c for c in data if c["channel_id"] == "test_channel")
    assert test_chan["channel_name"] == "Test"
    assert test_chan["has_refresh_token"] is True
