from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.services.automation.hwid import is_valid_hwid


class LicenseActivateRequest(BaseModel):
    key: str = Field(min_length=1, max_length=128)
    hwid: str = Field(min_length=64, max_length=64)

    @field_validator("key")
    @classmethod
    def normalize_key(cls, value: str) -> str:
        return value.strip()

    @field_validator("hwid")
    @classmethod
    def validate_hwid(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not is_valid_hwid(normalized):
            raise ValueError("HWID phải là chuỗi SHA-256 64 ký tự hex")
        return normalized


class LicenseActivateResponse(BaseModel):
    activation_id: UUID
    expires_at: datetime
    rebind_count: int

class LicenseCheckRequest(BaseModel):
    activation_id: UUID

class LicenseCheckResponse(BaseModel):
    active: bool
    expires_at: datetime
    revoked: bool
    rebind_count: int
