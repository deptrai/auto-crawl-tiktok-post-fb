from app.models.models import UserRole
import os

def test_login_me_and_change_password_flow(client, db_session):
    # Tạo user mới yêu cầu đổi mật khẩu
    from app.models.models import User, UserRole
    from app.core.security import get_password_hash
    import uuid
    test_user = User(
        id=uuid.uuid4(),
        email="test_change_pw@example.com",
        hashed_password=get_password_hash("test12345"),
        role=UserRole.owner,
        is_active=True,
        must_change_password=True
    )
    db_session.add(test_user)
    db_session.commit()

    login_response = client.post("/auth/login", json={"email": "test_change_pw@example.com", "password": "test12345"})
    assert login_response.status_code == 200
    login_payload = login_response.json()
    assert "access_token" in login_payload
    assert "refresh_token" in login_payload

    headers = {"Authorization": f"Bearer {login_payload['access_token']}"}
    me_response = client.get("/auth/me", headers=headers)
    assert me_response.status_code == 200
    me_data = me_response.json()
    assert me_data["email"] == "test_change_pw@example.com"
    assert me_data["must_change_password"] is True

    change_password_response = client.post(
        "/auth/change-password",
        headers=headers,
        json={"current_password": "test12345", "new_password": "Test56789!"},
    )
    assert change_password_response.status_code == 200
    
    relogin_response = client.post("/auth/login", json={"email": "test_change_pw@example.com", "password": "Test56789!"})
    assert relogin_response.status_code == 200


def test_admin_can_create_list_and_reset_user(client):
    # Login admin trước
    login_response = client.post("/auth/login", json={"email": "admin@example.com", "password": "admin12345"})
    auth_headers = {"Authorization": f"Bearer {login_response.json()['access_token']}"}

    create_response = client.post(
        "/users/",
        headers=auth_headers,
        json={
            "email": "editor1@example.com",
            "full_name": "Biên tập viên",
            "password": "Editor123!",
            "role": "editor",
            "avatar_url": "https://example.com/avatar.png"
        },
    )
    assert create_response.status_code == 200
    created_user = create_response.json()
    assert created_user["email"] == "editor1@example.com"
    assert created_user["role"] == "editor"
    assert created_user["avatar_url"] == "https://example.com/avatar.png"

    list_response = client.get("/users/", headers=auth_headers)
    assert list_response.status_code == 200
    emails = [user["email"] for user in list_response.json()]
    assert "editor1@example.com" in emails

    # Test update user
    update_response = client.patch(
        f"/users/{created_user['id']}", 
        headers=auth_headers,
        json={"password": "NewSecurePassword123!", "full_name": "Biên tập viên mới"}
    )
    assert update_response.status_code == 200
    assert update_response.json()["full_name"] == "Biên tập viên mới"
    
    editor_login = client.post(
        "/auth/login",
        json={"email": "editor1@example.com", "password": "NewSecurePassword123!"},
    )
    assert editor_login.status_code == 200
