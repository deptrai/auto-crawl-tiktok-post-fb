# Story 7.1: Hỗ Trợ System User Token Không Hết Hạn (Never-Expiring Token)

Status: ready-for-dev

## Story

As an Admin,
I want to hệ thống hỗ trợ Facebook System User Token (không hết hạn) và tự động kiểm tra sức khỏe token định kỳ,
so that hệ thống đăng bài hoạt động liên tục 24/7 mà không bị gián đoạn do token hết hạn.

## Bối Cảnh & Lý Do

### Vấn đề hiện tại
- Token từ Graph API Explorer là **short-lived** (~1-2 giờ) → hết hạn liên tục, phải renew thủ công
- `FacebookPage` model chỉ có field `long_lived_access_token` — không track loại token, thời hạn, hay trạng thái
- `auto_post_job` trong `cron.py` fail silently khi token hết hạn — video bị mark `failed` nhưng Admin không biết nguyên nhân
- Không có cron job nào kiểm tra token health proactively
- Graph API lỗi `OAuthException` (error code 190) không được xử lý riêng biệt

### Giải pháp
- Thêm token metadata fields vào `FacebookPage` model
- Tạo `token_lifecycle_service.py` dùng Facebook `/debug_token` API để inspect token
- Thêm APScheduler cron job kiểm tra token health mỗi 24h
- Hiển thị token status trên UI (badge + alert)
- Hướng dẫn in-app tạo System User Token

## Acceptance Criteria

### AC1: Schema mở rộng FacebookPage
**Given** Alembic migration chạy thành công
**When** hệ thống khởi động
**Then** bảng `facebook_pages` có thêm 4 columns mới:
- `token_type`: Enum(`short_lived`, `long_lived`, `system_user`) DEFAULT `long_lived`
- `token_expires_at`: DateTime NULLABLE (NULL = never expires hoặc unknown)
- `token_last_checked_at`: DateTime NULLABLE
- `token_health_status`: String DEFAULT `unknown` (values: `valid`, `expiring_soon`, `expired`, `invalid`, `unknown`)

### AC2: Token Inspect Service dùng /debug_token API
**Given** `FB_APP_ID` và `FB_APP_SECRET` được cấu hình trong `.env`
**When** gọi `check_token_health(page_id)`
**Then** service decrypt token → gọi `GET https://graph.facebook.com/debug_token?input_token={token}&access_token={app_id}|{app_secret}`
**And** parse response: `data.is_valid`, `data.expires_at` (0 = never), `data.type`, `data.scopes`
**And** cập nhật `token_expires_at`, `token_health_status`, `token_last_checked_at` vào DB
**And** trả về `TokenHealthResult(is_valid, token_type, expires_at, days_remaining, scopes, health_status)`

### AC3: APScheduler cron job kiểm tra token health
**Given** Scheduler đang chạy
**When** `token_health_check_job` trigger mỗi 24 giờ
**Then** query tất cả `FacebookPage` records có `long_lived_access_token IS NOT NULL`
**And** gọi `check_token_health()` cho từng page
**And** nếu `health_status = "expired"` hoặc `"invalid"` → tự động pause tất cả campaigns dùng page đó
**And** ghi `SystemEvent(scope="token", level="warning/error", message="Token hết hạn/invalid")` cho mỗi page có vấn đề

### AC4: API endpoint trả về token health info
**Given** Admin gọi `GET /facebook/config`
**When** response trả về
**Then** mỗi page object có thêm: `token_type`, `token_expires_at`, `token_health_status`, `token_last_checked_at`, `days_remaining` (computed)
**And** `GET /facebook/config/{page_id}/check-health` trigger check ngay lập tức (không cần chờ cron)

### AC5: Auto-detect token type khi save
**Given** Admin POST token mới qua `POST /facebook/config`
**When** token được lưu
**Then** hệ thống tự động gọi `/debug_token` để detect `token_type` từ `data.expires_at`:
- `expires_at = 0` → `system_user` (never expires)
- `expires_at > 0 AND expires_in > 50 ngày` → `long_lived`
- `expires_at > 0 AND expires_in <= 50 ngày` → `short_lived`
**And** cập nhật `token_type`, `token_expires_at`, `token_health_status` ngay lập tức

## Tasks / Subtasks

- [ ] Task 1: Alembic migration — thêm 4 columns vào `facebook_pages` (AC: #1)
  - [ ] 1.1: Thêm `TokenType` enum + 4 columns vào `models.py`
  - [ ] 1.2: Tạo Alembic migration file
  - [ ] 1.3: Test migration up/down

- [ ] Task 2: Token lifecycle service (AC: #2)
  - [ ] 2.1: Tạo `backend/app/services/token_lifecycle.py`
  - [ ] 2.2: Implement `check_token_health(page_id: str, db: Session) -> TokenHealthResult`
  - [ ] 2.3: Implement `check_all_tokens(db: Session) -> list[TokenHealthResult]`
  - [ ] 2.4: Implement `detect_token_type(token: str) -> tuple[str, datetime | None]`
  - [ ] 2.5: Handle lỗi khi `FB_APP_ID`/`FB_APP_SECRET` chưa config (graceful skip, log warning)

- [ ] Task 3: APScheduler cron job (AC: #3)
  - [ ] 3.1: Thêm `token_health_check_job` vào `cron.py`, trigger mỗi 24h
  - [ ] 3.2: Implement auto-pause campaigns khi token expired/invalid
  - [ ] 3.3: Ghi `SystemEvent` cho mỗi token có vấn đề

- [ ] Task 4: API endpoints mở rộng (AC: #4, #5)
  - [ ] 4.1: Mở rộng `GET /facebook/config` response với token health fields
  - [ ] 4.2: Thêm endpoint `GET /facebook/config/{page_id}/check-health`
  - [ ] 4.3: Mở rộng `POST /facebook/config` — auto-detect token type sau khi save

- [ ] Task 5: Unit tests (AC: #1-5)
  - [ ] 5.1: Test `detect_token_type()` với mock `/debug_token` responses
  - [ ] 5.2: Test `check_token_health()` — happy path + expired + invalid + network error
  - [ ] 5.3: Test auto-pause campaigns khi token expired
  - [ ] 5.4: Test API response format mới
  - [ ] 5.5: Test migration up/down

## Dev Notes

### Facebook /debug_token API Reference

```
GET https://graph.facebook.com/debug_token
  ?input_token={token-to-inspect}
  &access_token={app_id}|{app_secret}

Response:
{
  "data": {
    "app_id": "123456",
    "type": "PAGE",            // "USER" | "PAGE"
    "is_valid": true,
    "expires_at": 0,           // 0 = never expires
    "data_access_expires_at": 1748000000,
    "scopes": ["pages_manage_posts", "publish_video", ...],
    "issued_at": 1716000000
  }
}
```

**Token type detection logic:**
- `expires_at == 0` → System User Token hoặc Long-lived Page Token (cả hai never expire)
- `expires_at > 0` → Short-lived hoặc Long-lived User Token
- Phân biệt short vs long: `expires_at - now > 50 days` → long-lived

**App Access Token format:** `{app_id}|{app_secret}` — không cần call API, chỉ cần concatenate.

### Existing Code Patterns — MUST Follow

**Token encryption/decryption — `security.py`:**
```python
from app.services.security import encrypt_secret, decrypt_secret
# Khi đọc token từ DB → decrypt_secret(page.long_lived_access_token)
# Khi lưu token → encrypt_secret(raw_token)
# Prefix "enc::" = đã encrypted
```

**Event logging — `observability.py`:**
```python
from app.services.observability import record_event
record_event("token", "warning", "Token sắp hết hạn.", db=db, details={...})
record_event("token", "error", "Token đã hết hạn.", db=db, details={...})
```

**APScheduler job registration — `cron.py`:**
```python
# Pattern hiện tại trong start_scheduler():
scheduler.add_job(
    token_health_check_job,           # function
    "interval",
    hours=24,                          # mỗi 24h
    id="token_health_check_job",
    replace_existing=True,
    next_run_time=datetime.utcnow() + timedelta(minutes=5),  # chạy lần đầu sau 5 phút
)
```

**API response format — `facebook.py`:**
```python
# Pattern hiện tại: trả dict trực tiếp cho mỗi page
{
    "page_id": page.page_id,
    "page_name": page.page_name,
    "has_token": bool(...),
    "token_kind": get_token_kind(raw_token),
    "token_preview": mask_secret(raw_token),
    "token_is_encrypted": is_secret_encrypted(page.long_lived_access_token),
    # THÊM MỚI:
    "token_type": page.token_type,
    "token_expires_at": page.token_expires_at.isoformat() if page.token_expires_at else None,
    "token_health_status": page.token_health_status,
    "token_last_checked_at": page.token_last_checked_at.isoformat() if ... else None,
    "days_remaining": _calc_days_remaining(page.token_expires_at),  # None if never expires
}
```

### Config Vars Mới

Thêm vào `Settings` class trong `config.py`:
```python
FB_APP_ID: str = ""        # Facebook App ID cho /debug_token
FB_APP_SECRET: str = ""    # Facebook App Secret cho /debug_token
TOKEN_CHECK_INTERVAL_HOURS: int = 24
```

Thêm vào `.env.example`:
```
FB_APP_ID=
FB_APP_SECRET=
TOKEN_CHECK_INTERVAL_HOURS=24
```

### Project Structure Notes

**Files mới:**
- `backend/app/services/token_lifecycle.py` — Token health check logic
- `backend/alembic/versions/xxxx_add_token_lifecycle_fields.py` — Migration
- `backend/tests/test_token_lifecycle.py` — Unit tests

**Files sửa:**
- `backend/app/models/models.py` — Thêm `TokenType` enum + 4 columns vào `FacebookPage`
- `backend/app/core/config.py` — Thêm `FB_APP_ID`, `FB_APP_SECRET`, `TOKEN_CHECK_INTERVAL_HOURS`
- `backend/app/api/facebook.py` — Mở rộng response + thêm `/check-health` endpoint
- `backend/app/worker/cron.py` — Thêm `token_health_check_job`

**KHÔNG SỬA (backward compatible):**
- `fb_graph.py` — Upload logic giữ nguyên, nhận token đã decrypt
- `campaign_jobs.py` — Flow giữ nguyên
- `security.py` — Encryption/decryption giữ nguyên

### Edge Cases & Error Handling

1. **`FB_APP_ID` hoặc `FB_APP_SECRET` chưa config:** Skip token health check, log warning `"FB_APP_ID/FB_APP_SECRET chưa cấu hình, bỏ qua token health check."`, set `token_health_status = "unknown"`
2. **Network error khi gọi `/debug_token`:** Catch exception, giữ nguyên status hiện tại, log warning, KHÔNG auto-pause
3. **Token bị revoke (is_valid=false):** Set `health_status = "invalid"`, auto-pause campaigns, ghi event error
4. **Token sắp hết hạn (< 14 ngày):** Set `health_status = "expiring_soon"`, ghi event warning, KHÔNG pause
5. **Multiple pages, mixed status:** Xử lý từng page độc lập, không fail-fast

### Anti-Patterns to Avoid

- **KHÔNG** gọi `/debug_token` trên mỗi lần upload video — chỉ check mỗi 24h hoặc on-demand
- **KHÔNG** lưu `FB_APP_SECRET` vào DB — giữ trong `.env` / `Settings`
- **KHÔNG** trả `token_expires_at` dạng Unix timestamp cho frontend — luôn dùng ISO 8601 string
- **KHÔNG** hard-code Graph API version — dùng `v21.0` hiện tại, dễ thay đổi sau

### References

- [Source: architecture.md#D2: Token Lifecycle Architecture]
- [Source: epics.md#Epic 7, Story 7.1]
- [Source: Facebook Graph API — Access Token Debugger](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/debugging)
- [Source: Facebook System User Tokens](https://developers.facebook.com/docs/marketing-api/system-users/)
- [Source: backend/app/services/security.py — encrypt_secret, decrypt_secret]
- [Source: backend/app/worker/cron.py — APScheduler job pattern]
- [Source: backend/app/api/facebook.py — GET/POST /facebook/config]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### Change Log

### File List
