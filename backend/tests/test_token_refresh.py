"""
Tests cho Story 7.2: Auto Token Refresh
AC1-AC5: refresh_long_lived_token, cron integration, API endpoints
"""
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

from app.models.models import FacebookPage, Campaign, CampaignStatus, TokenType
from app.services.token_lifecycle import (
    refresh_long_lived_token,
    _exchange_user_token,
    _derive_page_token,
)
from app.worker.cron import token_health_check_job
from app.services.security import encrypt_secret, decrypt_secret
from app.core.config import settings


# ─── Fixtures ───────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def mock_fb_settings():
    """Patch FB_APP_ID/FB_APP_SECRET cho tất cả test — tự động restore sau mỗi test."""
    with patch.object(settings, "FB_APP_ID", "mock_id"), \
         patch.object(settings, "FB_APP_SECRET", "mock_secret"), \
         patch.object(settings, "TOKEN_REFRESH_DAYS_BEFORE", 7):
        yield


# ─── Helpers ────────────────────────────────────────────────────────────────

def make_page(db_session, page_id="page_123", token_type=TokenType.long_lived,
              auto_refresh_enabled=True, with_user_token=True,
              expires_days=5, health_status="expiring_soon"):
    """Tạo FacebookPage mẫu cho test."""
    page = FacebookPage(
        page_id=page_id,
        page_name="Test Page",
        long_lived_access_token=encrypt_secret("old_page_token"),
        token_type=token_type,
        token_expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=expires_days),
        token_health_status=health_status,
        auto_refresh_enabled=auto_refresh_enabled,
    )
    if with_user_token:
        page.user_access_token = encrypt_secret("old_user_token")
    db_session.add(page)
    db_session.commit()
    return page


# ─── Test _exchange_user_token ───────────────────────────────────────────────

@patch("app.services.token_lifecycle.requests.get")
def test_exchange_user_token_success(mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"access_token": "new_user_token_abc", "expires_in": 5184000}
    mock_get.return_value = mock_resp

    result = _exchange_user_token("old_user_token")
    assert result["access_token"] == "new_user_token_abc"
    assert result["expires_in"] == 5184000


@patch("app.services.token_lifecycle.requests.get")
def test_exchange_user_token_api_error(mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "error": {"code": 190, "error_subcode": 463, "message": "Token expired"}
    }
    mock_get.return_value = mock_resp

    with pytest.raises(ValueError, match="190/463"):
        _exchange_user_token("expired_user_token")


# ─── Test _derive_page_token ─────────────────────────────────────────────────

@patch("app.services.token_lifecycle.requests.get")
def test_derive_page_token_success(mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "data": [
            {"id": "page_111", "access_token": "new_page_token_xyz", "name": "Page 111"},
            {"id": "page_222", "access_token": "other_page_token", "name": "Page 222"},
        ]
    }
    mock_get.return_value = mock_resp

    token = _derive_page_token("user_token", "page_111")
    assert token == "new_page_token_xyz"


@patch("app.services.token_lifecycle.requests.get")
def test_derive_page_token_not_found(mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "data": [{"id": "other_page", "access_token": "some_token"}]
    }
    mock_get.return_value = mock_resp

    with pytest.raises(ValueError, match="page_999"):
        _derive_page_token("user_token", "page_999")


@patch("app.services.token_lifecycle.requests.get")
def test_derive_page_token_api_error(mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "error": {"message": "Invalid OAuth access token"}
    }
    mock_get.return_value = mock_resp

    with pytest.raises(ValueError, match="Invalid OAuth"):
        _derive_page_token("bad_token", "page_123")


# ─── Test refresh_long_lived_token — happy path ──────────────────────────────

@patch("app.services.token_lifecycle.requests.get")
def test_refresh_token_happy_path(mock_get, db_session):
    """AC2: Token refresh thành công → cập nhật DB."""


    page = make_page(db_session, page_id="page_happy")

    # Mock exchange, derive, verify
    exchange_resp = MagicMock()
    exchange_resp.status_code = 200
    exchange_resp.json.return_value = {"access_token": "new_user_token", "expires_in": 5184000}

    derive_resp = MagicMock()
    derive_resp.status_code = 200
    derive_resp.json.return_value = {
        "data": [{"id": "page_happy", "access_token": "new_page_token"}]
    }

    verify_resp = MagicMock()
    verify_resp.status_code = 200
    verify_resp.json.return_value = {"id": "page_happy"}

    mock_get.side_effect = [exchange_resp, derive_resp, verify_resp]

    result = refresh_long_lived_token("page_happy", db_session)

    assert result.success is True
    assert result.new_expires_at is not None

    db_session.refresh(page)
    # Page token và user token phải được cập nhật
    assert decrypt_secret(page.long_lived_access_token) == "new_page_token"
    assert decrypt_secret(page.user_access_token) == "new_user_token"
    assert page.token_health_status == "valid"
    assert page.last_refresh_at is not None
    assert page.token_refresh_error is None


# ─── Test refresh_long_lived_token — exchange thất bại ──────────────────────

@patch("app.services.token_lifecycle.requests.get")
def test_refresh_token_exchange_fails_keeps_old_token(mock_get, db_session):
    """AC5: Exchange thất bại → token cũ giữ nguyên (atomic)."""


    page = make_page(db_session, page_id="page_exchange_fail")

    exchange_resp = MagicMock()
    exchange_resp.status_code = 200
    exchange_resp.json.return_value = {
        "error": {"code": 190, "error_subcode": 463, "message": "Token expired"}
    }
    mock_get.return_value = exchange_resp

    result = refresh_long_lived_token("page_exchange_fail", db_session)

    assert result.success is False
    assert "Exchange" in result.message or "190" in result.message

    db_session.refresh(page)
    # Token cũ phải được giữ nguyên
    assert decrypt_secret(page.long_lived_access_token) == "old_page_token"
    assert page.token_refresh_error is not None


# ─── Test refresh_long_lived_token — derive thất bại ───────────────────────

@patch("app.services.token_lifecycle.requests.get")
def test_refresh_token_derive_fails_keeps_old_token(mock_get, db_session):
    """AC5: Exchange thành công nhưng derive thất bại → token cũ giữ nguyên (atomic)."""


    page = make_page(db_session, page_id="page_derive_fail")

    exchange_resp = MagicMock()
    exchange_resp.status_code = 200
    exchange_resp.json.return_value = {"access_token": "new_user_token", "expires_in": 5184000}

    derive_resp = MagicMock()
    derive_resp.status_code = 200
    derive_resp.json.return_value = {
        "data": [{"id": "other_page", "access_token": "some_token"}]
    }

    mock_get.side_effect = [exchange_resp, derive_resp]

    result = refresh_long_lived_token("page_derive_fail", db_session)

    assert result.success is False
    assert "Derive" in result.message or "page_derive_fail" in result.message

    db_session.refresh(page)
    # Page token phải được giữ nguyên
    assert decrypt_secret(page.long_lived_access_token) == "old_page_token"
    assert page.token_refresh_error is not None


# ─── Test refresh_long_lived_token — missing user token ─────────────────────

def test_refresh_token_no_user_token(db_session):
    """AC5: auto_refresh_enabled=True nhưng không có user_access_token → warning, skip."""
    page = make_page(db_session, page_id="page_no_user_tok", with_user_token=False)

    result = refresh_long_lived_token("page_no_user_tok", db_session)

    assert result.success is False
    assert "User Token" in result.message or "user_access_token" in result.message.lower() or "chưa cung cấp" in result.message


# ─── Test refresh_long_lived_token — system user token ──────────────────────

def test_refresh_token_system_user_skipped(db_session):
    """System User Token không bao giờ refresh."""
    page = make_page(db_session, page_id="page_sys", token_type=TokenType.system_user)

    result = refresh_long_lived_token("page_sys", db_session)

    assert result.success is False
    assert "System User" in result.message or "không cần refresh" in result.message


# ─── Test cron integration — expiring_soon + auto_refresh_enabled=True ──────

@patch("app.services.token_lifecycle.requests.get")
def test_cron_auto_refresh_triggered(mock_get, db_session):
    """AC3: cron phát hiện expiring_soon + auto_refresh_enabled=True → gọi refresh."""

    page = make_page(db_session, page_id="page_cron_refresh",
                     expires_days=5, auto_refresh_enabled=True,
                     health_status="valid")

    # Mock calls: debug_token, exchange, derive, verify
    debug_resp = MagicMock()
    debug_resp.status_code = 200
    debug_resp.json.return_value = {
        "data": {
            "is_valid": True,
            "expires_at": int((datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=5)).timestamp()),
            "scopes": ["pages_manage_posts"],
        }
    }

    exchange_resp = MagicMock()
    exchange_resp.status_code = 200
    exchange_resp.json.return_value = {"access_token": "refreshed_user_token", "expires_in": 5184000}

    derive_resp = MagicMock()
    derive_resp.status_code = 200
    derive_resp.json.return_value = {
        "data": [{"id": "page_cron_refresh", "access_token": "refreshed_page_token"}]
    }

    verify_resp = MagicMock()
    verify_resp.status_code = 200
    verify_resp.json.return_value = {"id": "page_cron_refresh"}

    # M5: Thêm post-refresh debug_token call (check_token_health được gọi sau refresh)
    post_refresh_debug_resp = MagicMock()
    post_refresh_debug_resp.status_code = 200
    post_refresh_debug_resp.json.return_value = {
        "data": {
            "is_valid": True,
            "expires_at": int((datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=60)).timestamp()),
            "scopes": ["pages_manage_posts"],
        }
    }

    mock_get.side_effect = [debug_resp, exchange_resp, derive_resp, verify_resp, post_refresh_debug_resp]

    with patch("app.worker.cron.SessionLocal", return_value=db_session), \
         patch.object(db_session, "close"):
        token_health_check_job()

    db_session.refresh(page)
    # Token phải được làm mới
    assert decrypt_secret(page.long_lived_access_token) == "refreshed_page_token"
    assert page.token_health_status == "valid"
    assert page.last_refresh_at is not None


@patch("app.services.token_lifecycle.requests.get")
def test_cron_expiring_soon_no_auto_refresh(mock_get, db_session):
    """AC3: cron phát hiện expiring_soon + auto_refresh_enabled=False → chỉ warning, không refresh."""


    page = make_page(db_session, page_id="page_cron_no_refresh",
                     expires_days=5, auto_refresh_enabled=False,
                     health_status="valid")

    debug_resp = MagicMock()
    debug_resp.status_code = 200
    debug_resp.json.return_value = {
        "data": {
            "is_valid": True,
            "expires_at": int((datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=5)).timestamp()),
            "scopes": [],
        }
    }
    mock_get.return_value = debug_resp

    with patch("app.worker.cron.SessionLocal", return_value=db_session), \
         patch.object(db_session, "close"):
        token_health_check_job()

    db_session.refresh(page)
    # Token cũ phải giữ nguyên — chưa làm mới
    assert page.last_refresh_at is None
    assert decrypt_secret(page.long_lived_access_token) == "old_page_token"


# ─── Test API endpoint /refresh-token ────────────────────────────────────────

@patch("app.services.token_lifecycle.requests.get")
def test_api_manual_refresh_success(mock_get, client, auth_headers, db_session):
    """AC4: POST /facebook/config/{page_id}/refresh-token — trigger refresh thủ công."""


    page = make_page(db_session, page_id="page_api_refresh")

    exchange_resp = MagicMock()
    exchange_resp.status_code = 200
    exchange_resp.json.return_value = {"access_token": "api_new_user_token", "expires_in": 5184000}

    derive_resp = MagicMock()
    derive_resp.status_code = 200
    derive_resp.json.return_value = {
        "data": [{"id": "page_api_refresh", "access_token": "api_new_page_token"}]
    }

    verify_resp = MagicMock()
    verify_resp.status_code = 200
    verify_resp.json.return_value = {"id": "page_api_refresh"}

    mock_get.side_effect = [exchange_resp, derive_resp, verify_resp]

    resp = client.post(
        "/facebook/config/page_api_refresh/refresh-token",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "Token" in data["message"] or "thành công" in data["message"]
    assert data["new_expires_at"] is not None


def test_api_manual_refresh_no_user_token(client, auth_headers, db_session):
    """AC4: POST /refresh-token khi chưa có user_access_token → 400."""
    page = make_page(db_session, page_id="page_api_no_user", with_user_token=False)

    resp = client.post(
        "/facebook/config/page_api_no_user/refresh-token",
        headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "User Access Token" in resp.json()["detail"] or "user_access_token" in resp.json()["detail"].lower()


def test_api_manual_refresh_not_found(client, auth_headers):
    """AC4: POST /refresh-token với page_id không tồn tại → 404."""
    resp = client.post(
        "/facebook/config/nonexistent_page/refresh-token",
        headers=auth_headers,
    )
    assert resp.status_code == 404


def test_api_set_config_with_user_token(client, auth_headers, db_session):
    """AC1+AC4: POST /facebook/config chấp nhận user_access_token và auto_refresh_enabled."""
    resp = client.post(
        "/facebook/config",
        headers=auth_headers,
        json={
            "page_id": "page_config_test",
            "page_name": "Config Test Page",
            "long_lived_access_token": "fake_page_token_abc",
            "user_access_token": "fake_user_token_xyz",
            "auto_refresh_enabled": True,
        },
    )
    assert resp.status_code == 200

    page = db_session.query(FacebookPage).filter_by(page_id="page_config_test").first()
    assert page is not None
    assert page.auto_refresh_enabled is True
    assert page.user_access_token is not None
    assert decrypt_secret(page.user_access_token) == "fake_user_token_xyz"


def test_api_get_config_includes_refresh_fields(client, auth_headers, db_session):
    """AC4: GET /facebook/config trả về auto_refresh_enabled, has_user_token, last_refresh_at."""
    page = make_page(db_session, page_id="page_get_config")

    resp = client.get("/facebook/config", headers=auth_headers)
    assert resp.status_code == 200
    pages = resp.json()
    page_data = next((p for p in pages if p["page_id"] == "page_get_config"), None)
    assert page_data is not None
    assert "auto_refresh_enabled" in page_data
    assert "has_user_token" in page_data
    assert "last_refresh_at" in page_data
    assert "token_refresh_error" in page_data
    # has_user_token phải là True vì make_page tạo với user token
    assert page_data["has_user_token"] is True
    # user_access_token value không được xuất hiện trong response
    assert "user_access_token" not in page_data
