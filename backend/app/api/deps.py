from __future__ import annotations
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
        if current_user.must_change_password:
            raise RBACException("Bạn phải đổi mật khẩu trước khi tiếp tục sử dụng hệ thống.")
        user_role = current_user.role.value if current_user.role else None
        if not user_role or user_role not in self.allowed_roles:
            if user_role != UserRole.super_admin.value:
                raise RBACException()
        return current_user

from uuid import UUID
from fastapi import Request

def get_current_organization_id(
    request: Request,
    current_user: User = Depends(require_authenticated_user)
) -> UUID | None:
    """
    Returns the organization ID for data isolation.
    - If user is super_admin, they can provide an X-Organization-Id header to act on behalf of an org.
      If not provided, returns None (global access or no specific org context).
    - If user is not super_admin, it returns their own organization_id.
    """
    if current_user.role == UserRole.super_admin:
        org_id_str = request.headers.get("X-Organization-Id")
        if org_id_str:
            try:
                return UUID(org_id_str)
            except ValueError:
                return None
        return None
    
    if current_user.organization_id is None:
        raise RBACException("Người dùng chưa được phân bổ vào tổ chức nào.")
    return current_user.organization_id

from sqlalchemy.orm import Query
from typing import TypeVar, Type
from app.core.database import Base

ModelType = TypeVar("ModelType", bound=Base)

def apply_org_filter(query: Query, model: Type[ModelType], org_id: UUID | None) -> Query:
    """
    Applies an organization filter to a query if org_id is provided.
    Assumes the model has an `organization_id` column.
    """
    if org_id is not None:
        if hasattr(model, 'organization_id'):
            query = query.filter(model.organization_id == org_id)
        else:
            raise ValueError(f"Model {model.__name__} does not have an organization_id column for data isolation.")
    return query