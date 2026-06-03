from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.services.automation.hwid import is_valid_hwid


class ActionTokenRequest(BaseModel):
    key: str = Field(min_length=1, max_length=128)
    hwid: str = Field(min_length=64, max_length=64)
    action_type: str = Field(min_length=1, max_length=32)

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

    @field_validator("action_type")
    @classmethod
    def normalize_action_type(cls, value: str) -> str:
        return value.strip().lower()


class ActionTokenResponse(BaseModel):
    token: str
    jti: str
    expires_at: datetime

class ActionTokenConsumeRequest(BaseModel):
    token: str = Field(min_length=1)

class ActionTokenConsumeResponse(BaseModel):
    jti: str
    consumed_at: datetime
