"""Unit tests cho Story 7-3: Token monitor — /token-summary endpoint + smart event logging."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.models.models import FacebookPage, TokenType
from app.services.security import encrypt_secret


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _make_page(page_id: str, health_status: str | None, expires_at: datetime | None = None, token: str = "enc_token"):
    """Tạo mock FacebookPage object (dùng cho TestSmartEventLogging)."""
    page = MagicMock()
    page.page_id = page_id
    page.page_name = f"Page {page_id}"
    page.long_lived_access_token = token
    page.token_health_status = health_status
    page.token_expires_at = expires_at
    page.token_type = MagicMock()
    page.token_type.value = "long_lived"
    return page


def _insert_page(db_session, page_id: str, health_status: str | None) -> FacebookPage:
    """Tạo real FacebookPage trong DB cho endpoint tests.
    health_status=None → dùng DB default ("unknown") vì nullable=False."""
    kwargs: dict = dict(
        page_id=page_id,
        page_name=f"Page {page_id}",
        long_lived_access_token=encrypt_secret("fake_token"),
        token_type=TokenType.long_lived,
    )
    if health_status is not None:
        kwargs["token_health_status"] = health_status
    page = FacebookPage(**kwargs)
    db_session.add(page)
    db_session.commit()
    return page


# ---------------------------------------------------------------------------
# AC1 / Task 1: _calc_days_remaining helper
# ---------------------------------------------------------------------------

class TestCalcDaysRemaining:
    def test_none_returns_none(self):
        """_calc_days_remaining(None) → None (system_user / never-expire)."""
        from app.api.facebook import _calc_days_remaining
        assert _calc_days_remaining(None) is None

    def test_future_date_returns_positive_days(self):
        """Future expiry → positive integer."""
        from app.api.facebook import _calc_days_remaining
        future = _utcnow() + timedelta(days=30)
        result = _calc_days_remaining(future)
        assert result == 29 or result == 30  # lax 1 ngày do ceiling

    def test_expired_date_returns_zero(self):
        """Past expiry → 0 (không trả số âm)."""
        from app.api.facebook import _calc_days_remaining
        past = _utcnow() - timedelta(days=5)
        result = _calc_days_remaining(past)
        assert result == 0


# ---------------------------------------------------------------------------
# AC1 / Task 1: GET /facebook/token-summary endpoint
# ---------------------------------------------------------------------------

class TestTokenSummaryEndpoint:
    def test_empty_pages_returns_zero_counts(self, client, auth_headers):
        """Không có pages → total_pages=0, worst_status='valid'."""
        resp = client.get("/facebook/token-summary", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert data["total_pages"] == 0
        assert data["worst_status"] == "valid"
        assert data["expired"] == 0
        assert data["invalid"] == 0

    def test_mixed_statuses_correct_aggregate(self, client, auth_headers, db_session):
        """Mixed statuses → correct counts + worst_status."""
        _insert_page(db_session, "p1", "valid")
        _insert_page(db_session, "p2", "expiring_soon")
        _insert_page(db_session, "p3", "expired")

        resp = client.get("/facebook/token-summary", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert data["total_pages"] == 3
        assert data["healthy"] == 1
        assert data["expiring_soon"] == 1
        assert data["expired"] == 1
        assert data["worst_status"] == "expired"

    def test_worst_status_priority_invalid_beats_expired(self, client, auth_headers, db_session):
        """invalid có ưu tiên cao hơn expired."""
        _insert_page(db_session, "p1", "expired")
        _insert_page(db_session, "p2", "invalid")

        resp = client.get("/facebook/token-summary", headers=auth_headers)

        assert resp.status_code == 200
        assert resp.json()["worst_status"] == "invalid"

    def test_all_valid_worst_status_is_valid(self, client, auth_headers, db_session):
        """Tất cả valid → worst_status='valid'."""
        _insert_page(db_session, "p1", "valid")
        _insert_page(db_session, "p2", "valid")

        resp = client.get("/facebook/token-summary", headers=auth_headers)

        assert resp.json()["worst_status"] == "valid"

    def test_expiring_soon_worst_status(self, client, auth_headers, db_session):
        """Chỉ expiring_soon (không có expired/invalid) → worst_status='expiring_soon'."""
        _insert_page(db_session, "p1", "valid")
        _insert_page(db_session, "p2", "expiring_soon")

        resp = client.get("/facebook/token-summary", headers=auth_headers)

        assert resp.json()["worst_status"] == "expiring_soon"

    def test_response_has_required_fields(self, client, auth_headers):
        """Response phải có đủ tất cả required fields."""
        resp = client.get("/facebook/token-summary", headers=auth_headers)

        data = resp.json()
        required_keys = {"total_pages", "healthy", "expiring_soon", "expired", "invalid", "unknown", "worst_status"}
        assert required_keys.issubset(set(data.keys()))

    def test_unknown_status_counted_correctly(self, client, auth_headers, db_session):
        """Pages với status=None → đếm vào 'unknown'."""
        _insert_page(db_session, "p1", None)

        resp = client.get("/facebook/token-summary", headers=auth_headers)

        data = resp.json()
        assert data["unknown"] == 1


# ---------------------------------------------------------------------------
# AC4: GET /facebook/config/{page_id}/check-health endpoint
# ---------------------------------------------------------------------------

class TestCheckHealthEndpoint:
    def test_page_not_found_returns_404(self, client, auth_headers):
        """page_id không tồn tại → 404."""
        resp = client.get("/facebook/config/nonexistent/check-health", headers=auth_headers)
        assert resp.status_code == 404

    def test_page_without_token_returns_400(self, client, auth_headers, db_session):
        """Page tồn tại nhưng không có token → 400."""
        page = FacebookPage(page_id="no_token", page_name="No Token Page")
        db_session.add(page)
        db_session.commit()

        resp = client.get("/facebook/config/no_token/check-health", headers=auth_headers)
        assert resp.status_code == 400

    def test_successful_check_returns_health_result(self, client, auth_headers, db_session):
        """Page có token → trả về health result."""
        from unittest.mock import patch
        from app.services.token_lifecycle import TokenHealthResult
        _insert_page(db_session, "p_check", "valid")

        mock_result = TokenHealthResult(
            is_valid=True,
            token_type="long_lived",
            expires_at=None,
            days_remaining=45,
            scopes=[],
            health_status="valid",
        )

        with patch("app.api.facebook.check_token_health", return_value=mock_result):
            resp = client.get("/facebook/config/p_check/check-health", headers=auth_headers)

        assert resp.status_code == 200
        data = resp.json()
        assert data["health_status"] == "valid"
        assert data["days_remaining"] == 45


# ---------------------------------------------------------------------------
# AC5 / Task 2: Smart event logging — status change detection
# ---------------------------------------------------------------------------

class TestSmartEventLogging:
    def _run_check_all(self, pages_data: list[tuple], new_health: str):
        """Helper: mock check_all_tokens với pages và expected new health result."""
        from app.services import token_lifecycle

        mock_db = MagicMock()
        pages = []
        for page_id, prev_status in pages_data:
            p = _make_page(page_id, prev_status)
            pages.append(p)

        mock_db.query.return_value.filter.return_value.all.return_value = pages

        mock_result = MagicMock()
        mock_result.health_status = new_health
        mock_result.days_remaining = 5 if new_health == "expiring_soon" else None

        with patch.object(token_lifecycle, "check_token_health", return_value=mock_result) as mock_chk, \
             patch.object(token_lifecycle, "record_event") as mock_rec:
            token_lifecycle.check_all_tokens(mock_db)
            return mock_rec

    def test_status_unchanged_no_event(self):
        """Status giữ nguyên → KHÔNG ghi event."""
        mock_rec = self._run_check_all([("p1", "valid")], "valid")
        mock_rec.assert_not_called()

    def test_valid_to_expiring_soon_writes_warning(self):
        """valid → expiring_soon → ghi event level='warning'."""
        from app.services import token_lifecycle

        mock_db = MagicMock()
        page = _make_page("p1", "valid")
        mock_db.query.return_value.filter.return_value.all.return_value = [page]

        mock_result = MagicMock()
        mock_result.health_status = "expiring_soon"
        mock_result.days_remaining = 5

        with patch.object(token_lifecycle, "check_token_health", return_value=mock_result), \
             patch.object(token_lifecycle, "record_event") as mock_rec:
            token_lifecycle.check_all_tokens(mock_db)

        mock_rec.assert_called_once()
        call_args = mock_rec.call_args
        assert call_args[0][0] == "token"
        assert call_args[0][1] == "warning"

    def test_valid_to_expired_writes_error(self):
        """valid → expired → ghi event level='error'."""
        from app.services import token_lifecycle

        mock_db = MagicMock()
        page = _make_page("p1", "valid")
        mock_db.query.return_value.filter.return_value.all.return_value = [page]

        mock_result = MagicMock()
        mock_result.health_status = "expired"
        mock_result.days_remaining = 0

        with patch.object(token_lifecycle, "check_token_health", return_value=mock_result), \
             patch.object(token_lifecycle, "record_event") as mock_rec:
            token_lifecycle.check_all_tokens(mock_db)

        mock_rec.assert_called_once()
        assert mock_rec.call_args[0][1] == "error"

    def test_valid_to_invalid_writes_error(self):
        """valid → invalid → ghi event level='error'."""
        from app.services import token_lifecycle

        mock_db = MagicMock()
        page = _make_page("p1", "valid")
        mock_db.query.return_value.filter.return_value.all.return_value = [page]

        mock_result = MagicMock()
        mock_result.health_status = "invalid"
        mock_result.days_remaining = None

        with patch.object(token_lifecycle, "check_token_health", return_value=mock_result), \
             patch.object(token_lifecycle, "record_event") as mock_rec:
            token_lifecycle.check_all_tokens(mock_db)

        mock_rec.assert_called_once()
        assert mock_rec.call_args[0][1] == "error"

    def test_expiring_soon_to_expiring_soon_no_event(self):
        """expiring_soon → expiring_soon (status unchanged) → KHÔNG ghi event."""
        from app.services import token_lifecycle

        mock_db = MagicMock()
        page = _make_page("p1", "expiring_soon")
        mock_db.query.return_value.filter.return_value.all.return_value = [page]

        mock_result = MagicMock()
        mock_result.health_status = "expiring_soon"
        mock_result.days_remaining = 3

        with patch.object(token_lifecycle, "check_token_health", return_value=mock_result), \
             patch.object(token_lifecycle, "record_event") as mock_rec:
            token_lifecycle.check_all_tokens(mock_db)

        mock_rec.assert_not_called()

    def test_invalid_to_valid_writes_info(self):
        """invalid → valid (recovery) → ghi event level='info'."""
        from app.services import token_lifecycle

        mock_db = MagicMock()
        page = _make_page("p1", "invalid")
        mock_db.query.return_value.filter.return_value.all.return_value = [page]

        mock_result = MagicMock()
        mock_result.health_status = "valid"
        mock_result.days_remaining = 45

        with patch.object(token_lifecycle, "check_token_health", return_value=mock_result), \
             patch.object(token_lifecycle, "record_event") as mock_rec:
            token_lifecycle.check_all_tokens(mock_db)

        mock_rec.assert_called_once()
        assert mock_rec.call_args[0][1] == "info"

    def test_event_details_include_page_info(self):
        """Event details phải chứa page_id và page_name."""
        from app.services import token_lifecycle

        mock_db = MagicMock()
        page = _make_page("p_abc", "valid")
        mock_db.query.return_value.filter.return_value.all.return_value = [page]

        mock_result = MagicMock()
        mock_result.health_status = "expiring_soon"
        mock_result.days_remaining = 7

        with patch.object(token_lifecycle, "check_token_health", return_value=mock_result), \
             patch.object(token_lifecycle, "record_event") as mock_rec:
            token_lifecycle.check_all_tokens(mock_db)

        call_kwargs = mock_rec.call_args[1]
        details = call_kwargs.get("details", {})
        assert "page_id" in details
        assert "page_name" in details

    def test_multiple_pages_only_changed_write_events(self):
        """Multiple pages — chỉ những trang thay đổi status mới ghi event."""
        from app.services import token_lifecycle

        mock_db = MagicMock()
        pages = [
            _make_page("p1", "valid"),     # valid → valid: no event
            _make_page("p2", "valid"),     # valid → expiring_soon: write event
        ]
        mock_db.query.return_value.filter.return_value.all.return_value = pages

        def side_effect(page_id, db, **kwargs):
            r = MagicMock()
            if page_id == "p1":
                r.health_status = "valid"
                r.days_remaining = 30
            else:
                r.health_status = "expiring_soon"
                r.days_remaining = 5
            return r

        with patch.object(token_lifecycle, "check_token_health", side_effect=side_effect), \
             patch.object(token_lifecycle, "record_event") as mock_rec:
            token_lifecycle.check_all_tokens(mock_db)

        assert mock_rec.call_count == 1  # chỉ p2 thay đổi
