from __future__ import annotations

import re

_HWID_RE = re.compile(r"^[0-9a-f]{64}$")


def is_valid_hwid(hwid: str) -> bool:
    return bool(_HWID_RE.fullmatch(hwid.strip().lower()))


def validate_hwid(hwid: str) -> str:
    normalized = hwid.strip().lower()
    if not is_valid_hwid(normalized):
        raise ValueError("HWID không hợp lệ. HWID phải là SHA-256 64 ký tự hex.")
    return normalized
