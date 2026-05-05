import pytest
import uuid
from fastapi.testclient import TestClient
from app.models.organization import Organization
from app.models.models import UserRole

def test_data_isolation_campaigns(client: TestClient, db_session):
    # Tạo 2 orgs
    org1 = Organization(name="Org 1", slug="org-1")
    org2 = Organization(name="Org 2", slug="org-2")
    db_session.add_all([org1, org2])
    db_session.commit()
    
    # Tạo 2 users
    from app.models.models import User
    user1 = User(email="u1@test.com", hashed_password="pw", role=UserRole.owner, is_active=True, organization_id=org1.id)
    user2 = User(email="u2@test.com", hashed_password="pw", role=UserRole.owner, is_active=True, organization_id=org2.id)
    db_session.add_all([user1, user2])
    db_session.commit()
    
    # Cấp token
    from app.core.security import create_access_token
    token1 = create_access_token(user1.id, role=user1.role.value)
    token2 = create_access_token(user2.id, role=user2.role.value)
    
    # User 1 tạo campaign
    res1 = client.post(
        "/campaigns/", 
        json={"name": "Camp 1", "source_url": "https://example.com"}, 
        headers={"Authorization": f"Bearer {token1}"}
    )
    assert res1.status_code == 200
    
    # User 2 fetch campaigns, must be empty
    res2 = client.get("/campaigns/", headers={"Authorization": f"Bearer {token2}"})
    assert res2.status_code == 200
    assert len(res2.json()) == 0

    # User 1 fetch campaigns, must have 1
    res1_get = client.get("/campaigns/", headers={"Authorization": f"Bearer {token1}"})
    assert res1_get.status_code == 200
    assert len(res1_get.json()) == 1
