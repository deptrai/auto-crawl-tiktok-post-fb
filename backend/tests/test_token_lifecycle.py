import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock

from app.models.models import FacebookPage, Campaign, CampaignStatus, TokenType
from app.services.token_lifecycle import detect_token_type, check_token_health
from app.worker.cron import token_health_check_job
from app.services.security import encrypt_secret
from app.core.config import settings

def test_detect_token_type():
    ttype, dt = detect_token_type(0)
    assert ttype == TokenType.system_user.value
    assert dt is None
    
    short_ts = int((datetime.utcnow() + timedelta(days=10)).replace(tzinfo=timezone.utc).timestamp())
    ttype, dt = detect_token_type(short_ts)
    assert ttype == TokenType.short_lived.value
    assert dt is not None
    
    long_ts = int((datetime.utcnow() + timedelta(days=60)).replace(tzinfo=timezone.utc).timestamp())
    ttype, dt = detect_token_type(long_ts)
    assert ttype == TokenType.long_lived.value

@patch("app.services.token_lifecycle.requests.get")
def test_check_token_health_valid(mock_get, db_session):
    page = FacebookPage(
        page_id="test_page_1",
        page_name="Page 1",
        long_lived_access_token=encrypt_secret("raw_token")
    )
    db_session.add(page)
    db_session.commit()
    
    settings.FB_APP_ID = "mock_id"
    settings.FB_APP_SECRET = "mock_secret"
    
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "data": {
            "is_valid": True,
            "expires_at": int((datetime.utcnow() + timedelta(days=60)).replace(tzinfo=timezone.utc).timestamp()),
            "scopes": ["public_profile"]
        }
    }
    mock_get.return_value = mock_resp
    
    res = check_token_health("test_page_1", db_session)
    assert res is not None
    assert res.is_valid is True
    assert res.health_status == "valid"
    assert res.token_type == TokenType.long_lived.value

@patch("app.services.token_lifecycle.requests.get")
def test_cron_auto_pause(mock_get, db_session):
    page = FacebookPage(
        page_id="test_page_2",
        page_name="Page 2",
        long_lived_access_token=encrypt_secret("raw_token")
    )
    db_session.add(page)
    
    camp = Campaign(
        name="Camp 1",
        target_page_id="test_page_2",
        status=CampaignStatus.active
    )
    db_session.add(camp)
    db_session.commit()
    
    settings.FB_APP_ID = "mock_id"
    settings.FB_APP_SECRET = "mock_secret"
    
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"data": {"is_valid": False}}
    mock_get.return_value = mock_resp
    
    from app.worker.cron import SessionLocal
    with patch("app.worker.cron.SessionLocal", return_value=db_session), patch.object(db_session, "close"):
        token_health_check_job()
        
    db_session.refresh(page)
    db_session.refresh(camp)
    assert page.token_health_status == "invalid"
    assert camp.status == CampaignStatus.paused
