import pytest
from fastapi.testclient import TestClient
from app.api.auth import require_authenticated_user
from app.models.models import User, UserRole
from app.api.deps import RBACException
from fastapi import Request
from fastapi.responses import JSONResponse
import uuid

def create_mock_user(role: str):
    return User(
        id=uuid.uuid4(),
        email=f"test_{role}@example.com",
        role=UserRole(role) if role else None,
        is_active=True
    )

def override_auth_owner():
    return create_mock_user("owner")

def override_auth_editor():
    return create_mock_user("editor")

def override_auth_viewer():
    return create_mock_user("viewer")

def override_auth_super_admin():
    return create_mock_user("super_admin")

@pytest.fixture(autouse=True)
def setup_test_app(client: TestClient):
    client.app.dependency_overrides.clear()
    yield
    client.app.dependency_overrides.clear()

def test_system_endpoint_owner_allowed(client: TestClient):
    client.app.dependency_overrides[require_authenticated_user] = override_auth_owner
    response = client.put("/system/runtime-config", json={})
    # If it passes RBAC, it might hit DB and get 200 or 500 or 422. Just ensure it's not 403.
    assert response.status_code != 403

def test_system_endpoint_viewer_rejected(client: TestClient):
    client.app.dependency_overrides[require_authenticated_user] = override_auth_viewer
    response = client.put("/system/runtime-config", json={})
    assert response.status_code == 403
    assert response.json()["error"]["message"] == "Bạn không có quyền thực hiện hành động này"
def test_campaign_create_editor_allowed(client: TestClient):
    client.app.dependency_overrides[require_authenticated_user] = override_auth_editor
    response = client.post("/campaigns/", json={})
    assert response.status_code != 403

def test_campaign_create_viewer_rejected(client: TestClient):
    client.app.dependency_overrides[require_authenticated_user] = override_auth_viewer
    response = client.post("/campaigns/", json={})
    assert response.status_code == 403

def test_users_endpoint_super_admin_allowed(client: TestClient):
    client.app.dependency_overrides[require_authenticated_user] = override_auth_super_admin
    response = client.get("/users/")
    assert response.status_code != 403

def test_users_endpoint_editor_rejected(client: TestClient):
    client.app.dependency_overrides[require_authenticated_user] = override_auth_editor
    response = client.get("/users/")
    assert response.status_code == 403
