import pytest
from app.api.deps import RoleChecker, RBACException
from app.models.models import UserRole

class MockRole:
    def __init__(self, value):
        self.value = value

class MockUser:
    def __init__(self, role_value):
        self.role = MockRole(role_value) if role_value else None

def test_role_checker_allows_valid_role():
    checker = RoleChecker(["owner", "editor"])
    user = MockUser("editor")
    
    result = checker(current_user=user)
    assert result == user

def test_role_checker_allows_super_admin_always():
    checker = RoleChecker(["owner"])
    user = MockUser(UserRole.super_admin.value)
    
    result = checker(current_user=user)
    assert result == user

def test_role_checker_rejects_invalid_role():
    checker = RoleChecker(["owner"])
    user = MockUser("viewer")
    
    with pytest.raises(RBACException) as exc_info:
        checker(current_user=user)
        
    assert exc_info.value.message == "Bạn không có quyền thực hiện hành động này"

def test_role_checker_rejects_missing_role():
    checker = RoleChecker(["owner"])
    user = MockUser(None)
    
    with pytest.raises(RBACException):
        checker(current_user=user)
