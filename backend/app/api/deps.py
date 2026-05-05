from typing import List
from fastapi import Depends
from app.models.models import User, UserRole
from app.api.auth import require_authenticated_user

class RBACException(Exception):
    def __init__(self, message: str = "Bạn không có quyền thực hiện hành động này"):
        self.message = message

class RoleChecker:
    def __init__(self, allowed_roles: List[str]):
        self.allowed_roles = allowed_roles

    def __call__(self, current_user: User = Depends(require_authenticated_user)):
        user_role = current_user.role.value if current_user.role else None
        if not user_role or user_role not in self.allowed_roles:
            if user_role != UserRole.super_admin.value:
                raise RBACException()
        return current_user