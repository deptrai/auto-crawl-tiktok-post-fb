from unittest.mock import patch, MagicMock
from app.services.metrics_collector import _fetch_batch_metrics, AuthFailedError, RateLimitError
import pytest
import requests

def test_fetch_batch_metrics_success():
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "12345": {
            "likes": {"summary": {"total_count": 10}},
            "comments": {"summary": {"total_count": 5}},
            "shares": {"count": 2},
            "video_insights": {
                "data": [
                    {"name": "post_video_views", "values": [{"value": 100}]},
                    {"name": "post_impressions_unique", "values": [{"value": 80}]}
                ]
            }
        }
    }
    
    with patch('requests.get', return_value=mock_resp):
        data = _fetch_batch_metrics("url", {})
        assert "12345" in data
        assert data["12345"]["likes"]["summary"]["total_count"] == 10

def test_fetch_batch_metrics_auth_error():
    mock_resp = MagicMock()
    mock_resp.status_code = 400
    mock_resp.json.return_value = {
        "error": {"code": 190, "message": "Invalid token"}
    }
    
    with patch('requests.get', return_value=mock_resp):
        with pytest.raises(AuthFailedError):
            _fetch_batch_metrics("url", {})

def test_fetch_batch_metrics_rate_limit_error():
    mock_resp = MagicMock()
    mock_resp.status_code = 400
    mock_resp.json.return_value = {
        "error": {"code": 613, "message": "Calls to this api have exceeded the rate limit."}
    }
    
    with patch('requests.get', return_value=mock_resp):
        with pytest.raises(RateLimitError):
            _fetch_batch_metrics("url", {})
