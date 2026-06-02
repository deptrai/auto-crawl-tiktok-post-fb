from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import text

from app.models.automation.license import License, LicenseActivation
from app.services.automation.license import LicenseActivationError, activate_license

VALID_HWID = "a" * 64
OTHER_HWID = "b" * 64


def create_license(db_session, key: str = "LIC-TEST-001", days_total: int = 30, revoked: bool = False) -> License:
    license_record = License(key=key, days_total=days_total, revoked=revoked)
    db_session.add(license_record)
    db_session.commit()
    db_session.refresh(license_record)
    return license_record


def test_phase3_license_tables_exist(db_session):
    # Given: test database metadata has been initialized.
    # When: checking phase3 license tables.
    bind = db_session.get_bind()
    if bind.dialect.name == "sqlite":
        license_count = db_session.execute(text("SELECT COUNT(*) FROM phase3.licenses")).scalar_one()
        activation_count = db_session.execute(text("SELECT COUNT(*) FROM phase3.license_activations")).scalar_one()
        assert license_count == 0
        assert activation_count == 0
    else:
        rows = db_session.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'phase3' AND table_name IN ('licenses', 'license_activations')"
            )
        ).scalars().all()
        assert set(rows) == {"licenses", "license_activations"}


def test_activate_license_success_binds_hwid_and_computes_expiry(db_session):
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


def test_activate_license_same_hwid_is_idempotent(db_session):
    # Given: a license has already been activated on one HWID.
    license_record = create_license(db_session)
    first = activate_license(db_session, key=license_record.key, hwid=VALID_HWID)

    # When: activating again with the same HWID.
    second = activate_license(db_session, key=license_record.key, hwid=VALID_HWID)

    # Then: the same activation is returned rather than creating duplicates.
    assert second.activation_id == first.activation_id
    assert db_session.query(LicenseActivation).count() == 1


def test_activate_license_hwid_mismatch_returns_domain_error(db_session):
    # Given: a license has already been bound to another HWID.
    license_record = create_license(db_session)
    activate_license(db_session, key=license_record.key, hwid=VALID_HWID)

    # When/Then: a different HWID is rejected with a rebind instruction error.
    with pytest.raises(LicenseActivationError) as exc_info:
        activate_license(db_session, key=license_record.key, hwid=OTHER_HWID)

    assert exc_info.value.code == "LICENSE_HWID_MISMATCH"
    assert "rebind" in exc_info.value.message.lower()


def test_activate_license_rejects_revoked_and_missing_keys(db_session):
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


def test_activate_endpoint_returns_success_and_domain_errors(client, db_session):
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
