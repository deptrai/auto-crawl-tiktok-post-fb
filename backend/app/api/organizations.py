from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List
from pydantic import BaseModel, ConfigDict
import re
from datetime import datetime

from app.api.deps import RoleChecker
from app.core.database import get_db
from app.models.models import Organization, User
from app.services.observability import record_event

router = APIRouter(prefix="/organizations", tags=["Tổ chức"], dependencies=[Depends(RoleChecker(["super_admin"]))])

class OrganizationCreate(BaseModel):
    name: str
    slug: str

class OrganizationUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None

class OrganizationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    slug: str
    created_at: datetime | None

@router.get("/", response_model=List[OrganizationResponse])
def get_organizations(db: Session = Depends(get_db)):
    return db.query(Organization).order_by(Organization.name).all()

@router.post("/", response_model=OrganizationResponse)
def create_organization(payload: OrganizationCreate, db: Session = Depends(get_db)):
    # Validate slug
    if not re.match(r"^[a-z0-9-]+$", payload.slug):
        raise HTTPException(status_code=400, detail="Slug chỉ được chứa chữ cái thường, số và dấu gạch ngang.")
    
    if db.query(Organization).filter(Organization.slug == payload.slug).first():
        raise HTTPException(status_code=400, detail="Slug này đã được sử dụng.")

    org = Organization(name=payload.name.strip(), slug=payload.slug.strip())
    db.add(org)
    db.commit()
    db.refresh(org)
    
    record_event("organization", "info", "Đã tạo tổ chức mới.", db=db, details={"org_id": str(org.id), "name": org.name})
    return org

@router.patch("/{org_id}", response_model=OrganizationResponse)
def update_organization(org_id: str, payload: OrganizationUpdate, db: Session = Depends(get_db)):
    try:
        org_uuid = UUID(org_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Mã tổ chức không hợp lệ.")
        
    org = db.query(Organization).filter(Organization.id == org_uuid).first()
    if not org:
        raise HTTPException(status_code=404, detail="Không tìm thấy tổ chức.")

    if payload.slug is not None:
        payload.slug = payload.slug.strip()
        if not re.match(r"^[a-z0-9-]+$", payload.slug):
            raise HTTPException(status_code=400, detail="Slug chỉ được chứa chữ cái thường, số và dấu gạch ngang.")
        if payload.slug != org.slug and db.query(Organization).filter(Organization.slug == payload.slug).first():
            raise HTTPException(status_code=400, detail="Slug này đã được sử dụng.")
        org.slug = payload.slug
        
    if payload.name is not None:
        org.name = payload.name.strip()

    db.commit()
    db.refresh(org)
    
    record_event("organization", "info", "Đã cập nhật tổ chức.", db=db, details={"org_id": str(org.id)})
    return org

@router.delete("/{org_id}")
def delete_organization(org_id: str, db: Session = Depends(get_db)):
    try:
        org_uuid = UUID(org_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Mã tổ chức không hợp lệ.")
        
    org = db.query(Organization).filter(Organization.id == org_uuid).first()
    if not org:
        raise HTTPException(status_code=404, detail="Không tìm thấy tổ chức.")

    db.delete(org)
    db.commit()
    
    record_event("organization", "info", "Đã xóa tổ chức.", db=db, details={"org_id": str(org.id)})
    return {"message": "Đã xóa tổ chức thành công."}
