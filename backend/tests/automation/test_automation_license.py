from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

VALID_HWID = "a" * 64
OTHER_HWID = "b" * 64

pytestmark = pytest.mark.postgres


def create_license(
    db_session: Session,
    key: str = "LIC-TEST-001",
    days_total: int = 30,
    revoked: bool = False,
):
    from app.models.automation.license import License

    license_record = License(key=key, days_total=days_total, revoked=revoked)
    db_session.add(license_record)
    db_session.commit()
    db_session.refresh(license_record)
    return license_record


def test_phase3_license_tables_exist(db_session: Session):
    # Given: Alembic migrations have been applied to a real PostgreSQL database.
    # When: checking phase3 license tables via information_schema.
    rows = db_session.execute(
        text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'phase3' AND table_name IN ('licenses', 'license_activations')"
        )
    ).scalars().all()

    # Then: both Phase 3 tables exist in the production schema namespace.
    assert set(rows) == {"licenses", "license_activations"}


def test_phase3_activation_fk_is_enforced(db_session: Session):
    # Given: PostgreSQL has the phase3 schema and FK constraints from Alembic.
    missing_license_id = uuid.uuid4()

    # When/Then: inserting an activation for a non-existent license fails the FK.
    with pytest.raises(IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO phase3.license_activations "
                "(id, license_id, hwid_hash, expires_at) "
                "VALUES (:id, :license_id, :hwid_hash, now() + interval '1 day')"
            ),
            {
                "id": uuid.uuid4(),
                "license_id": missing_license_id,
                "hwid_hash": VALID_HWID,
            },
        )
        db_session.commit()
    db_session.rollback()


def test_phase3_created_by_admin_cross_schema_fk_is_enforced(db_session: Session):
    # Given: the phase3 licenses table references public.users explicitly.
    missing_user_id = uuid.uuid4()

    # When/Then: inserting a license with a missing public.users id fails FK enforcement.
    with pytest.raises(IntegrityError):
        db_session.execute(
            text(
                "INSERT INTO phase3.licenses (id, key, days_total, created_by_admin) "
                "VALUES (:id, :key, :days_total, :created_by_admin)"
            ),
            {
                "id": uuid.uuid4(),
                "key": "LIC-CROSS-FK",
                "days_total": 7,
                "created_by_admin": missing_user_id,
            },
        )
        db_session.commit()
    db_session.rollback()


def test_phase3_license_days_total_check_constraint(db_session: Session):
    # Given/When/Then: migration enforces positive license duration at DB level.
    with pytest.raises(IntegrityError):
        db_session.execute(
            text("INSERT INTO phase3.licenses (id, key, days_total) VALUES (:id, :key, :days_total)"),
            {"id": uuid.uuid4(), "key": "LIC-ZERO", "days_total": 0},
        )
        db_session.commit()
    db_session.rollback()


def test_license_activation_error_str_contains_message():
    from app.services.automation.license import LicenseActivationError

    error = LicenseActivationError("LICENSE_X", "Thông báo lỗi", retryable=True)

    assert str(error) == "Thông báo lỗi"
    assert error.args == ("Thông báo lỗi",)


def test_activate_license_success_binds_hwid_and_computes_expiry(db_session: Session):
    from app.models.automation.license import LicenseActivation
    from app.services.automation.license import activate_license

    # Given: an active license exists.
    license_record = create_license(db_session, days_total=30)

    # When: activating with a valid HWID.
    response = activate_license(db_session, key=license_record.key, hwid=VALID_HWID)

    # Then: activation is persisted and expiry is computed from activation time.
    assert response.rebind_count == 0
    assert response.expires_at > datetime.now(timezone.utc)
    activation = db_session.query(LicenseActivation).filter_by(id=response.activation_id).one()
    assert activation.license_id == license_record.id
    assert activation.hwid_hash == VALID_HWID


def test_activate_license_same_hwid_is_idempotent_while_active(db_session: Session):
    from app.models.automation.license import LicenseActivation
    from app.services.automation.license import activate_license

    # Given: a license has already been activated on one HWID.
    license_record = create_license(db_session)
    first = activate_license(db_session, key=license_record.key, hwid=VALID_HWID)

    # When: activating again with the same HWID.
    second = activate_license(db_session, key=license_record.key, hwid=VALID_HWID)

    # Then: the same activation is returned rather than creating duplicates.
    assert second.activation_id == first.activation_id
    assert db_session.query(LicenseActivation).count() == 1


def test_activate_license_same_hwid_renews_after_expiry(db_session: Session):
    from app.models.automation.license import LicenseActivation
    from app.services.automation.license import activate_license

    # Given: an activation exists but is already expired.
    license_record = create_license(db_session, days_total=7)
    first = activate_license(db_session, key=license_record.key, hwid=VALID_HWID)
    expired_at = datetime.now(timezone.utc) - timedelta(days=1)
    activation = db_session.query(LicenseActivation).filter_by(id=first.activation_id).one()
    activation.activated_at = expired_at - timedelta(days=7)
    activation.expires_at = expired_at
    db_session.commit()

    # When: activating again on the same HWID.
    renewed = activate_license(db_session, key=license_record.key, hwid=VALID_HWID)

    # Then: expiry is recomputed from now while preserving one activation row per license.
    assert renewed.activation_id == first.activation_id
    assert renewed.expires_at > datetime.now(timezone.utc) + timedelta(days=6)
    assert db_session.query(LicenseActivation).count() == 1


def test_service_rejects_invalid_days_total_before_creating_activation():
    from app.services.automation.license import LicenseActivationError, _validate_days_total

    # Given/When/Then: service rejects invalid duration before creating expired access.
    with pytest.raises(LicenseActivationError) as exc_info:
        _validate_days_total(0)
    assert exc_info.value.code == "LICENSE_INVALID"


def test_activate_license_hwid_mismatch_returns_domain_error(db_session: Session):
    from app.services.automation.license import LicenseActivationError, activate_license

    # Given: a license has already been bound to another HWID.
    license_record = create_license(db_session)
    activate_license(db_session, key=license_record.key, hwid=VALID_HWID)

    # When/Then: a different HWID is rejected with a rebind instruction error.
    with pytest.raises(LicenseActivationError) as exc_info:
        activate_license(db_session, key=license_record.key, hwid=OTHER_HWID)

    assert exc_info.value.code == "LICENSE_HWID_MISMATCH"
    assert "rebind" in exc_info.value.message.lower()


def test_activate_license_rejects_revoked_and_missing_keys(db_session: Session):
    from app.services.automation.license import LicenseActivationError, activate_license

    # Given: one revoked license and one missing key.
    revoked = create_license(db_session, key="LIC-REVOKED", revoked=True)

    # When/Then: revoked license is rejected.
    with pytest.raises(LicenseActivationError) as revoked_error:
        activate_license(db_session, key=revoked.key, hwid=VALID_HWID)
    assert revoked_error.value.code == "LICENSE_REVOKED"

    # When/Then: missing license is rejected.
    with pytest.raises(LicenseActivationError) as missing_error:
        activate_license(db_session, key="LIC-MISSING", hwid=VALID_HWID)
    assert missing_error.value.code == "LICENSE_NOT_FOUND"


def test_activate_endpoint_returns_success_and_domain_errors(client: TestClient, db_session: Session):
    # Given: active and revoked license records exist.
    active = create_license(db_session, key="LIC-API-OK", days_total=7)
    revoked = create_license(db_session, key="LIC-API-REVOKED", revoked=True)

    # When: activating through the public automation endpoint.
    response = client.post(
        "/api/v1/automation/license/activate",
        json={"key": active.key, "hwid": VALID_HWID},
    )

    # Then: activation response returns the public status only.
    assert response.status_code == 200
    payload = response.json()
    assert payload["activation_id"]
    assert payload["rebind_count"] == 0
    assert payload["expires_at"]

    mismatch_response = client.post(
        "/api/v1/automation/license/activate",
        json={"key": active.key, "hwid": OTHER_HWID},
    )
    assert mismatch_response.status_code == 409
    assert mismatch_response.json()["error"]["code"] == "LICENSE_HWID_MISMATCH"

    revoked_response = client.post(
        "/api/v1/automation/license/activate",
        json={"key": revoked.key, "hwid": VALID_HWID},
    )
    assert revoked_response.status_code == 403
    assert revoked_response.json()["error"]["code"] == "LICENSE_REVOKED"

    missing_response = client.post(
        "/api/v1/automation/license/activate",
        json={"key": "LIC-NOT-FOUND", "hwid": VALID_HWID},
    )
    assert missing_response.status_code == 404
    assert missing_response.json()["error"]["code"] == "LICENSE_NOT_FOUND"


def test_activate_endpoint_rate_limits_per_ip_and_key(client: TestClient, db_session: Session):
    from app.api.automation import reset_activation_rate_limiter

    reset_activation_rate_limiter()
    license_record = create_license(db_session, key="LIC-RATE-LIMIT", days_total=7)

    for _ in range(10):
        response = client.post(
            "/api/v1/automation/license/activate",
            json={"key": license_record.key, "hwid": VALID_HWID},
        )
        assert response.status_code == 200

    limited = client.post(
        "/api/v1/automation/license/activate",
        json={"key": license_record.key, "hwid": VALID_HWID},
    )

    assert limited.status_code == 429
    assert limited.json()["error"] == {
        "code": "RATE_LIMITED",
        "message": "Bạn đã thử kích hoạt quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.",
        "retryable": True,
    }
    reset_activation_rate_limiter()
