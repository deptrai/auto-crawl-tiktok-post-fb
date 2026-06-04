from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from test_automation_license import OTHER_HWID, VALID_HWID, create_license

pytestmark = pytest.mark.postgres


def _activate(db_session: Session, key: str = "LIC-ACTION-OK"):
    from app.services.automation.license import activate_license

    license_record = create_license(db_session, key=key, days_total=7)
    activation_response = activate_license(db_session, key=license_record.key, hwid=VALID_HWID)
    return license_record, activation_response


def test_phase3_action_tokens_table_exists(db_session: Session):
    rows = db_session.execute(
        text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'phase3' AND table_name IN ('licenses', 'license_activations', 'action_tokens')"
        )
    ).scalars().all()

    assert set(rows) == {"licenses", "license_activations", "action_tokens"}


def test_action_token_issue_success_persists_jti_and_jwt_claims(client: TestClient, db_session: Session):
    from app.core.config import settings
    from app.models.automation.action_token import ActionToken

    license_record, activation_response = _activate(db_session)

    before = datetime.now(timezone.utc)
    response = client.post(
        "/api/v1/automation/action/token",
        json={"key": license_record.key, "hwid": VALID_HWID, "action_type": "comment"},
    )
    after = datetime.now(timezone.utc)

    assert response.status_code == 200
    payload = response.json()
    assert payload["token"]
    assert payload["jti"]
    assert payload["expires_at"]

    decoded = jwt.decode(payload["token"], settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    assert decoded["jti"] == payload["jti"]
    assert decoded["sub"] == str(activation_response.activation_id)
    assert decoded["action"] == "comment"

    expires_at = datetime.fromisoformat(payload["expires_at"].replace("Z", "+00:00"))
    assert before + timedelta(seconds=55) <= expires_at <= after + timedelta(seconds=65)
    assert decoded["exp"] == int(expires_at.timestamp())

    row = db_session.query(ActionToken).filter_by(jti=payload["jti"]).one()
    assert row.license_activation_id == activation_response.activation_id
    assert row.action_type == "comment"
    assert row.used_at is None


def test_action_token_issue_and_consume_message_action(client: TestClient, db_session: Session):
    from app.core.config import settings
    from app.models.automation.action_token import ActionToken

    license_record, _activation_response = _activate(db_session, key="LIC-ACTION-MESSAGE")

    issued_response = client.post(
        "/api/v1/automation/action/token",
        json={"key": license_record.key, "hwid": VALID_HWID, "action_type": "message"},
    )

    assert issued_response.status_code == 200
    issued = issued_response.json()
    decoded = jwt.decode(issued["token"], settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    assert decoded["action"] == "message"

    row = db_session.query(ActionToken).filter_by(jti=issued["jti"]).one()
    assert row.action_type == "message"
    assert row.used_at is None

    consumed_response = client.post(
        "/api/v1/automation/action/token/consume", json={"token": issued["token"]}
    )

    assert consumed_response.status_code == 200
    assert consumed_response.json()["jti"] == issued["jti"]
    db_session.refresh(row)
    assert row.used_at is not None


def test_action_token_denies_invalid_expired_hwid_and_action(client: TestClient, db_session: Session):
    from app.models.automation.license import LicenseActivation

    active, activation_response = _activate(db_session, key="LIC-ACTION-DENY")

    invalid_response = client.post(
        "/api/v1/automation/action/token",
        json={"key": "LIC-MISSING-ACTION", "hwid": VALID_HWID, "action_type": "comment"},
    )
    assert invalid_response.status_code == 422
    assert invalid_response.json()["error"] == {
        "code": "LICENSE_INVALID",
        "message": "License không hợp lệ.",
        "retryable": False,
    }

    mismatch_response = client.post(
        "/api/v1/automation/action/token",
        json={"key": active.key, "hwid": OTHER_HWID, "action_type": "comment"},
    )
    assert mismatch_response.status_code == 409
    assert mismatch_response.json()["error"]["code"] == "LICENSE_HWID_MISMATCH"

    bad_action_response = client.post(
        "/api/v1/automation/action/token",
        json={"key": active.key, "hwid": VALID_HWID, "action_type": "view"},
    )
    assert bad_action_response.status_code == 403
    assert bad_action_response.json()["error"]["code"] == "ACTION_NOT_ALLOWED"

    activation = db_session.query(LicenseActivation).filter_by(id=activation_response.activation_id).one()
    activation.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    expired_response = client.post(
        "/api/v1/automation/action/token",
        json={"key": active.key, "hwid": VALID_HWID, "action_type": "comment"},
    )
    assert expired_response.status_code == 403
    assert expired_response.json()["error"] == {
        "code": "LICENSE_EXPIRED",
        "message": "License đã hết hạn.",
        "retryable": False,
    }


def test_action_token_denies_revoked_license_as_invalid(client: TestClient, db_session: Session):
    revoked = create_license(db_session, key="LIC-ACTION-REVOKED", revoked=True)

    response = client.post(
        "/api/v1/automation/action/token",
        json={"key": revoked.key, "hwid": VALID_HWID, "action_type": "comment"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "LICENSE_INVALID"


def test_action_token_rate_limits_per_ip_and_key(client: TestClient, db_session: Session):
    from app.api.automation import reset_activation_rate_limiter

    reset_activation_rate_limiter()
    license_record, _activation_response = _activate(db_session, key="LIC-ACTION-RATE")

    for _ in range(60):
        response = client.post(
            "/api/v1/automation/action/token",
            json={"key": license_record.key, "hwid": VALID_HWID, "action_type": "comment"},
        )
        assert response.status_code == 200

    limited = client.post(
        "/api/v1/automation/action/token",
        json={"key": license_record.key, "hwid": VALID_HWID, "action_type": "comment"},
    )

    assert limited.status_code == 429
    assert limited.json()["error"] == {
        "code": "RATE_LIMITED",
        "message": "Bạn đã yêu cầu token hành động quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.",
        "retryable": True,
    }
    reset_activation_rate_limiter()


def test_action_token_issues_unique_jtis(client: TestClient, db_session: Session):
    from app.models.automation.action_token import ActionToken

    license_record, _activation_response = _activate(db_session, key="LIC-ACTION-UNIQUE")

    first = client.post(
        "/api/v1/automation/action/token",
        json={"key": license_record.key, "hwid": VALID_HWID, "action_type": "comment"},
    )
    second = client.post(
        "/api/v1/automation/action/token",
        json={"key": license_record.key, "hwid": VALID_HWID, "action_type": "comment"},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["jti"] != second.json()["jti"]
    assert db_session.query(ActionToken).count() == 2


def test_action_token_rejects_malformed_hwid_at_schema_layer(client: TestClient, db_session: Session):
    """Pydantic ActionTokenRequest (hwid Field 64/64 + is_valid_hwid) rejects malformed
    hwid with 422 BEFORE reaching the service — locks the schema-layer defense."""
    license_record, _ = _activate(db_session, key="LIC-ACTION-BADHWID")

    response = client.post(
        "/api/v1/automation/action/token",
        json={"key": license_record.key, "hwid": "not-a-valid-hwid", "action_type": "comment"},
    )

    assert response.status_code == 422


def test_action_token_consume_success_sets_used_at(client: TestClient, db_session: Session):
    from app.models.automation.action_token import ActionToken

    license_record, _activation_response = _activate(db_session, key="LIC-ACTION-CONSUME")
    issued = client.post(
        "/api/v1/automation/action/token",
        json={"key": license_record.key, "hwid": VALID_HWID, "action_type": "comment"},
    ).json()

    response = client.post("/api/v1/automation/action/token/consume", json={"token": issued["token"]})

    assert response.status_code == 200
    assert response.json()["jti"] == issued["jti"]
    assert response.json()["consumed_at"]
    row = db_session.query(ActionToken).filter_by(jti=issued["jti"]).one()
    assert row.used_at is not None


def test_action_token_consume_reuse_returns_409(client: TestClient, db_session: Session):
    license_record, _activation_response = _activate(db_session, key="LIC-ACTION-REUSE")
    issued = client.post(
        "/api/v1/automation/action/token",
        json={"key": license_record.key, "hwid": VALID_HWID, "action_type": "comment"},
    ).json()

    assert client.post("/api/v1/automation/action/token/consume", json={"token": issued["token"]}).status_code == 200
    reused = client.post("/api/v1/automation/action/token/consume", json={"token": issued["token"]})

    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "ACTION_TOKEN_REUSED"


def test_action_token_consume_expired_returns_401(client: TestClient, db_session: Session):
    from app.services.automation.action_token import issue_action_token

    license_record, _activation_response = _activate(db_session, key="LIC-ACTION-EXPIRED-CONSUME")
    issued = issue_action_token(
        db_session,
        key=license_record.key,
        hwid=VALID_HWID,
        action_type="comment",
        now=datetime.now(timezone.utc) - timedelta(minutes=2),
    )

    response = client.post("/api/v1/automation/action/token/consume", json={"token": issued.token})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "ACTION_TOKEN_EXPIRED"


def test_action_token_consume_unknown_jti_returns_422(client: TestClient, db_session: Session):
    from app.core.config import settings

    token = jwt.encode(
        {
            "jti": "missing-jti",
            "sub": "activation-id",
            "action": "comment",
            "exp": int((datetime.now(timezone.utc) + timedelta(minutes=1)).timestamp()),
        },
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )

    response = client.post("/api/v1/automation/action/token/consume", json={"token": token})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "ACTION_TOKEN_INVALID"
