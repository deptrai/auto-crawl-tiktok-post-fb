"""Tests for Story 1.5: Admin create, list, and revoke license keys.

Backend Phase 3 test - requires PostgreSQL + Alembic (uses session-scoped fixtures
from tests/automation/conftest.py). Run with PHASE3_TEST_DATABASE_URL set.

IMPORTANT: All app.* imports MUST be lazy (inside functions/fixtures) to avoid
importing app.core.database before PHASE3_TEST_DATABASE_URL is configured.
"""
from __future__ import annotations

import uuid
from typing import Iterator

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker


# ---------------------------------------------------------------------------
# Fixture: real super_admin user in public.users (FK for created_by_admin)
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def test_admin_user_id(postgres_engine) -> Iterator[uuid.UUID]:
    """Insert a real super_admin user into public.users for FK satisfaction."""
    user_id = uuid.uuid4()
    with postgres_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, role, is_active, must_change_password) "
                "VALUES (:id, :email, :pw, :role, :active, :mcp) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {
                "id": str(user_id),
                "email": f"test_admin_{user_id}@example.com",
                "pw": "hashed_for_test",
                "role": "super_admin",
                "active": True,
                "mcp": False,
            },
        )
    yield user_id
    with postgres_engine.begin() as conn:
        conn.execute(text("DELETE FROM users WHERE id = :id"), {"id": str(user_id)})


# ---------------------------------------------------------------------------
# Helpers - mock users (lazy imports inside to respect conftest guard)
# ---------------------------------------------------------------------------

def _make_mock_user(role: str, user_id: uuid.UUID):
    from app.models.models import User, UserRole
    return User(
        id=user_id,
        email=f"test_{role}@example.com",
        role=UserRole(role),
        is_active=True,
        organization_id=None,
        must_change_password=False,
    )


# ---------------------------------------------------------------------------
# admin_client fixture - TestClient with RBAC exception handler
# ---------------------------------------------------------------------------

@pytest.fixture
def admin_client(postgres_session_factory: sessionmaker) -> Iterator[TestClient]:
    """TestClient for admin endpoints - includes RBAC exception handler (403)."""
    from app.api import automation
    from app.api.deps import RBACException

    app = FastAPI()

    @app.exception_handler(RBACException)
    async def _rbac_handler(request, exc: RBACException):
        return JSONResponse(
            status_code=403,
            content={"detail": exc.message, "error": {"code": "FORBIDDEN", "message": exc.message, "retryable": False}},
        )

    def override_get_db() -> Iterator[Session]:
        db = postgres_session_factory()
        try:
            yield db
        finally:
            db.rollback()
            db.close()

    app.dependency_overrides[automation.get_db] = override_get_db
    app.include_router(automation.router)
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# Task 1 - schema validation
# ---------------------------------------------------------------------------

def test_license_create_request_rejects_zero_days():
    """Schema validator rejects days_total <= 0."""
    from pydantic import ValidationError
    from app.schemas.automation.license import LicenseCreateRequest

    with pytest.raises(ValidationError):
        LicenseCreateRequest(days_total=0)

    with pytest.raises(ValidationError):
        LicenseCreateRequest(days_total=-5)


def test_license_create_request_accepts_positive_days():
    from app.schemas.automation.license import LicenseCreateRequest
    req = LicenseCreateRequest(days_total=90)
    assert req.days_total == 90


# ---------------------------------------------------------------------------
# Task 2+3 - endpoint integration tests
# ---------------------------------------------------------------------------

def test_create_license_as_super_admin_returns_201(
    admin_client: TestClient, test_admin_user_id: uuid.UUID
):
    from app.api.auth import require_authenticated_user

    def _admin():
        return _make_mock_user("super_admin", test_admin_user_id)

    admin_client.app.dependency_overrides[require_authenticated_user] = _admin
    resp = admin_client.post("/api/v1/automation/admin/license", json={"days_total": 30})
    admin_client.app.dependency_overrides.pop(require_authenticated_user, None)

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["days_total"] == 30
    assert body["revoked"] is False
    key = body["key"]
    assert key.startswith("LIC-"), f"Key format wrong: {key}"
    assert "created_by_admin" in body
    assert body["created_by_admin"] == str(test_admin_user_id)
    assert "id" in body


def test_create_license_key_format_and_uniqueness(
    admin_client: TestClient, test_admin_user_id: uuid.UUID
):
    """Two consecutive creates must produce distinct keys with LIC-XXXXXXXX-XXXXXXXX format."""
    from app.api.auth import require_authenticated_user

    def _admin():
        return _make_mock_user("super_admin", test_admin_user_id)

    admin_client.app.dependency_overrides[require_authenticated_user] = _admin
    resp1 = admin_client.post("/api/v1/automation/admin/license", json={"days_total": 7})
    resp2 = admin_client.post("/api/v1/automation/admin/license", json={"days_total": 7})
    admin_client.app.dependency_overrides.pop(require_authenticated_user, None)

    assert resp1.status_code == 201
    assert resp2.status_code == 201
    key1 = resp1.json()["key"]
    key2 = resp2.json()["key"]
    assert key1 != key2, "Two generated keys must be unique"
    for k in (key1, key2):
        parts = k.split("-")
        assert parts[0] == "LIC"
        assert len(parts) == 3
        assert len(parts[1]) == 8
        assert len(parts[2]) == 8


def test_create_license_days_total_zero_returns_422(
    admin_client: TestClient, test_admin_user_id: uuid.UUID
):
    from app.api.auth import require_authenticated_user

    def _admin():
        return _make_mock_user("super_admin", test_admin_user_id)

    admin_client.app.dependency_overrides[require_authenticated_user] = _admin
    resp = admin_client.post("/api/v1/automation/admin/license", json={"days_total": 0})
    admin_client.app.dependency_overrides.pop(require_authenticated_user, None)
    assert resp.status_code == 422, resp.text


def test_create_license_non_super_admin_returns_403(admin_client: TestClient):
    from app.api.auth import require_authenticated_user

    non_admin_id = uuid.uuid4()

    def _owner():
        return _make_mock_user("owner", non_admin_id)

    admin_client.app.dependency_overrides[require_authenticated_user] = _owner
    resp = admin_client.post("/api/v1/automation/admin/license", json={"days_total": 30})
    admin_client.app.dependency_overrides.pop(require_authenticated_user, None)
    assert resp.status_code == 403, resp.text


def test_create_license_unauthenticated_returns_401(admin_client: TestClient):
    resp = admin_client.post(
        "/api/v1/automation/admin/license",
        json={"days_total": 30},
        headers={"Authorization": "Bearer invalid_token"},
    )
    assert resp.status_code == 401, resp.text


def test_list_licenses_returns_all_ordered_newest_first(
    admin_client: TestClient, db_session: Session, test_admin_user_id: uuid.UUID
):
    from app.api.auth import require_authenticated_user
    from app.services.automation.license import create_license_for_admin

    lic1 = create_license_for_admin(db_session, days_total=7, admin_id=test_admin_user_id)
    lic2 = create_license_for_admin(db_session, days_total=30, admin_id=test_admin_user_id)
    db_session.commit()

    def _admin():
        return _make_mock_user("super_admin", test_admin_user_id)

    admin_client.app.dependency_overrides[require_authenticated_user] = _admin
    resp = admin_client.get("/api/v1/automation/admin/license")
    admin_client.app.dependency_overrides.pop(require_authenticated_user, None)

    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) >= 2
    ids = [item["id"] for item in items]
    assert str(lic2.id) in ids
    assert str(lic1.id) in ids
    # Newest first: lic2 created after lic1
    assert ids.index(str(lic2.id)) < ids.index(str(lic1.id))


def test_list_licenses_includes_activation_info(
    admin_client: TestClient, db_session: Session, test_admin_user_id: uuid.UUID
):
    from app.api.auth import require_authenticated_user
    from app.services.automation.hwid import validate_hwid
    from app.services.automation.license import activate_license, create_license_for_admin

    lic = create_license_for_admin(db_session, days_total=30, admin_id=test_admin_user_id)
    db_session.commit()
    hwid = validate_hwid("c" * 64)
    activate_license(db_session, key=lic.key, hwid=hwid)

    def _admin():
        return _make_mock_user("super_admin", test_admin_user_id)

    admin_client.app.dependency_overrides[require_authenticated_user] = _admin
    resp = admin_client.get("/api/v1/automation/admin/license")
    admin_client.app.dependency_overrides.pop(require_authenticated_user, None)

    assert resp.status_code == 200
    items = resp.json()
    item = next(i for i in items if i["id"] == str(lic.id))
    assert item["activated"] is True
    assert item["expires_at"] is not None


def test_list_licenses_non_super_admin_returns_403(admin_client: TestClient):
    from app.api.auth import require_authenticated_user

    def _owner():
        return _make_mock_user("owner", uuid.uuid4())

    admin_client.app.dependency_overrides[require_authenticated_user] = _owner
    resp = admin_client.get("/api/v1/automation/admin/license")
    admin_client.app.dependency_overrides.pop(require_authenticated_user, None)
    assert resp.status_code == 403


def test_revoke_license_sets_revoked_true(
    admin_client: TestClient, db_session: Session, test_admin_user_id: uuid.UUID
):
    from app.api.auth import require_authenticated_user
    from app.services.automation.license import create_license_for_admin

    lic = create_license_for_admin(db_session, days_total=30, admin_id=test_admin_user_id)
    db_session.commit()

    def _admin():
        return _make_mock_user("super_admin", test_admin_user_id)

    admin_client.app.dependency_overrides[require_authenticated_user] = _admin
    resp = admin_client.post(f"/api/v1/automation/admin/license/{lic.id}/revoke")
    admin_client.app.dependency_overrides.pop(require_authenticated_user, None)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == str(lic.id)
    assert body["revoked"] is True

    db_session.refresh(lic)
    assert lic.revoked is True


def test_revoke_license_is_idempotent(
    admin_client: TestClient, db_session: Session, test_admin_user_id: uuid.UUID
):
    from app.api.auth import require_authenticated_user
    from app.services.automation.license import create_license_for_admin

    lic = create_license_for_admin(db_session, days_total=30, admin_id=test_admin_user_id)
    db_session.commit()

    def _admin():
        return _make_mock_user("super_admin", test_admin_user_id)

    admin_client.app.dependency_overrides[require_authenticated_user] = _admin
    resp1 = admin_client.post(f"/api/v1/automation/admin/license/{lic.id}/revoke")
    resp2 = admin_client.post(f"/api/v1/automation/admin/license/{lic.id}/revoke")
    admin_client.app.dependency_overrides.pop(require_authenticated_user, None)

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp2.json()["revoked"] is True


def test_revoke_nonexistent_license_returns_404(
    admin_client: TestClient, test_admin_user_id: uuid.UUID
):
    from app.api.auth import require_authenticated_user

    def _admin():
        return _make_mock_user("super_admin", test_admin_user_id)

    admin_client.app.dependency_overrides[require_authenticated_user] = _admin
    fake_id = uuid.uuid4()
    resp = admin_client.post(f"/api/v1/automation/admin/license/{fake_id}/revoke")
    admin_client.app.dependency_overrides.pop(require_authenticated_user, None)
    assert resp.status_code == 404, resp.text


def test_revoke_non_super_admin_returns_403(
    admin_client: TestClient, db_session: Session, test_admin_user_id: uuid.UUID
):
    from app.api.auth import require_authenticated_user
    from app.services.automation.license import create_license_for_admin

    lic = create_license_for_admin(db_session, days_total=30, admin_id=test_admin_user_id)
    db_session.commit()

    def _owner():
        return _make_mock_user("owner", uuid.uuid4())

    admin_client.app.dependency_overrides[require_authenticated_user] = _owner
    resp = admin_client.post(f"/api/v1/automation/admin/license/{lic.id}/revoke")
    admin_client.app.dependency_overrides.pop(require_authenticated_user, None)
    assert resp.status_code == 403


def test_regression_create_activate_revoke_check_returns_revoked(
    admin_client: TestClient, db_session: Session, test_admin_user_id: uuid.UUID
):
    """Regression Story 1.4: revoke -> /license/check returns revoked:true + active:false."""
    from app.api.auth import require_authenticated_user
    from app.services.automation.hwid import validate_hwid
    from app.services.automation.license import activate_license, check_license, create_license_for_admin

    lic = create_license_for_admin(db_session, days_total=30, admin_id=test_admin_user_id)
    db_session.commit()

    hwid = validate_hwid("a" * 64)
    activation_resp = activate_license(db_session, key=lic.key, hwid=hwid)
    activation_id = activation_resp.activation_id

    def _admin():
        return _make_mock_user("super_admin", test_admin_user_id)

    admin_client.app.dependency_overrides[require_authenticated_user] = _admin
    resp = admin_client.post(f"/api/v1/automation/admin/license/{lic.id}/revoke")
    admin_client.app.dependency_overrides.pop(require_authenticated_user, None)
    assert resp.status_code == 200

    # Expire db_session identity map so it re-fetches from DB (the revoke was committed
    # in the admin_client's separate session).
    db_session.expire_all()
    check_resp = check_license(db_session, activation_id=activation_id)
    assert check_resp.revoked is True
    assert check_resp.active is False


def test_regression_revoked_license_cannot_be_reactivated(
    db_session: Session, test_admin_user_id: uuid.UUID
):
    """Regression Story 1.4: activate revoked key -> LICENSE_REVOKED error."""
    from app.services.automation.hwid import validate_hwid
    from app.services.automation.license import (
        LicenseActivationError,
        activate_license,
        create_license_for_admin,
        revoke_license,
    )

    lic = create_license_for_admin(db_session, days_total=30, admin_id=test_admin_user_id)
    db_session.commit()
    revoke_license(db_session, license_id=lic.id)

    hwid = validate_hwid("b" * 64)
    with pytest.raises(LicenseActivationError) as exc_info:
        activate_license(db_session, key=lic.key, hwid=hwid)
    assert exc_info.value.code == "LICENSE_REVOKED"
