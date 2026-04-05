# Story 7.3: Cảnh Báo & Giám Sát Hạn Token (Token Expiry Monitor & Dashboard Alerts)

Status: ready-for-dev

## Story

As an Admin,
I want to nhận cảnh báo sớm khi token sắp hết hạn trên Dashboard,
so that có đủ thời gian can thiệp thủ công nếu auto-refresh thất bại hoặc token bị revoke.

## Bối Cảnh & Lý Do

### Phụ thuộc
- **Story 7.1 PHẢI hoàn thành trước** — cần:
  - `token_type`, `token_expires_at`, `token_health_status`, `token_last_checked_at` columns trên `facebook_pages`
  - `token_lifecycle.py` service với `check_token_health()`, `detect_token_type()`, `check_all_tokens()`
  - `token_health_check_job` cron job đã đăng ký trong `cron.py`
  - `FB_APP_ID`, `FB_APP_SECRET` config vars
- **Story 7.2 đã implement** (nếu hoàn thành trước):
  - `user_access_token`, `auto_refresh_enabled`, `token_refresh_error`, `last_refresh_at` fields
  - `refresh_long_lived_token()` function trong `token_lifecycle.py`

### Vấn đề cần giải quyết
- Story 7.1 check token health + auto-pause campaigns nhưng Admin KHÔNG BIẾT cho đến khi video fail
- Story 7.2 auto-refresh nhưng nếu refresh thất bại → Admin cũng không biết
- Cần visual feedback rõ ràng trên Dashboard để Admin phản ứng kịp thời
- Cần hệ thống cảnh báo phân cấp: `valid` → `expiring_soon` → `expired` → `invalid`

### UI/UX Context
- Frontend: **React 19 SPA**, single-file `frontend/src/App.jsx` (~2000+ lines)
- Icon library: **lucide-react** (đã import: `AlertTriangle`, `ShieldCheck`, `CircleCheck`, `CircleX`, etc.)
- API base: `/api` prefix, auto-refresh data mỗi 5 giây (`AUTO_REFRESH_MS = 5000`)
- Design: dark theme, rounded-2xl cards, Tailwind CSS classes

## Acceptance Criteria

### AC1: API trả về token health summary cho Dashboard
**Given** Admin mở Dashboard
**When** Frontend gọi `GET /facebook/config`
**Then** mỗi page object có đầy đủ token health info:
- `token_type`: "short_lived" | "long_lived" | "system_user"
- `token_health_status`: "valid" | "expiring_soon" | "expired" | "invalid" | "unknown"
- `token_expires_at`: ISO 8601 string hoặc null (null = never expires)
- `days_remaining`: integer hoặc null (null = never expires)
- `token_last_checked_at`: ISO 8601 string hoặc null
**And** thêm endpoint `GET /facebook/token-summary` trả aggregate:
```json
{
  "total_pages": 3,
  "healthy": 2,
  "expiring_soon": 1,
  "expired": 0,
  "invalid": 0,
  "unknown": 0,
  "worst_status": "expiring_soon"
}
```

### AC2: Badge cảnh báo trên card Facebook Page
**Given** Dashboard hiển thị danh sách Facebook Pages
**When** token có `health_status = "valid"` hoặc `"system_user"`
**Then** hiển thị badge xanh lá: "Token hợp lệ" (icon `CircleCheck`)
**When** token có `health_status = "expiring_soon"`
**Then** hiển thị badge vàng: "Sắp hết hạn (X ngày)" (icon `AlertTriangle`)
**When** token có `health_status = "expired"`
**Then** hiển thị badge đỏ: "Đã hết hạn" (icon `CircleX`)
**When** token có `health_status = "invalid"`
**Then** hiển thị badge đỏ: "Token không hợp lệ" (icon `CircleX`)
**When** token có `health_status = "unknown"`
**Then** hiển thị badge xám: "Chưa kiểm tra" (icon `Clock`)

### AC3: Banner cảnh báo toàn Dashboard
**Given** Admin mở Dashboard
**When** có BẤT KỲ page nào với `health_status` là `expired` hoặc `invalid`
**Then** hiển thị banner đỏ nổi bật ở đầu Dashboard:
- Text: "Token Facebook đã hết hạn hoặc không hợp lệ! Một số chiến dịch đã bị tạm dừng tự động."
- Link "Xem chi tiết →" dẫn đến section Facebook Config
**When** có page với `health_status = "expiring_soon"` (nhưng không có expired/invalid)
**Then** hiển thị banner vàng: "Token Facebook sắp hết hạn trong X ngày. Kiểm tra ngay!"

### AC4: Nút "Kiểm tra ngay" trên mỗi page card
**Given** Admin đang xem Facebook Config section trên Dashboard
**When** Admin bấm nút "Kiểm tra Token" trên card một page
**Then** Frontend gọi `GET /facebook/config/{page_id}/check-health` (từ Story 7.1)
**And** hiển thị loading state trên nút
**And** sau khi response → cập nhật badge status ngay lập tức (không cần chờ auto-refresh 5s)

### AC5: SystemEvent cảnh báo cho monitoring
**Given** `token_health_check_job` cron chạy mỗi 24h
**When** phát hiện token chuyển từ `valid` → `expiring_soon`
**Then** ghi `SystemEvent(scope="token", level="warning", message="Token sắp hết hạn trong X ngày.")` với details chứa `page_id`, `page_name`, `days_remaining`
**When** phát hiện token chuyển từ any → `expired` hoặc `invalid`
**Then** ghi `SystemEvent(scope="token", level="error", message="Token đã hết hạn/không hợp lệ!")` với details chứa `page_id`, `page_name`, `previous_status`
**And** KHÔNG ghi event nếu status KHÔNG thay đổi (tránh spam event log mỗi 24h)

## Tasks / Subtasks

- [ ] Task 1: Backend — Token summary endpoint (AC: #1)
  - [ ] 1.1: Thêm `GET /facebook/token-summary` endpoint trong `facebook.py` — aggregate health status từ tất cả pages
  - [ ] 1.2: Mở rộng `GET /facebook/config` response — đảm bảo có đầy đủ token health fields (Story 7.1 đã thêm columns, đây là đảm bảo response format)
  - [ ] 1.3: Helper function `_calc_days_remaining(expires_at: datetime | None) -> int | None`

- [ ] Task 2: Backend — Smart event logging chỉ khi status thay đổi (AC: #5)
  - [ ] 2.1: Mở rộng `check_all_tokens()` trong `token_lifecycle.py` — so sánh `previous_status` vs `new_status` trước khi ghi event
  - [ ] 2.2: Ghi `SystemEvent` level "warning" khi valid→expiring_soon, level "error" khi any→expired/invalid
  - [ ] 2.3: Skip event nếu status giữ nguyên (ví dụ: `expiring_soon` → `expiring_soon` = không ghi lại)

- [ ] Task 3: Frontend — Token health badges trên page card (AC: #2)
  - [ ] 3.1: Tạo component function `TokenHealthBadge({ status, daysRemaining })` trong `App.jsx`
  - [ ] 3.2: Render badge theo 5 trạng thái: valid (xanh), expiring_soon (vàng), expired (đỏ), invalid (đỏ), unknown (xám)
  - [ ] 3.3: Sử dụng lucide-react icons đã import: `CircleCheck`, `AlertTriangle`, `CircleX`, `Clock`
  - [ ] 3.4: Integrate vào Facebook Page card — hiển thị badge bên cạnh page name

- [ ] Task 4: Frontend — Dashboard warning banner (AC: #3)
  - [ ] 4.1: Gọi `GET /facebook/token-summary` khi load Dashboard
  - [ ] 4.2: Tạo component function `TokenAlertBanner({ summary })` — banner đỏ (expired/invalid) hoặc vàng (expiring_soon)
  - [ ] 4.3: Render banner ở đầu Dashboard, trên các section cards
  - [ ] 4.4: Link "Xem chi tiết →" scroll đến Facebook Config section

- [ ] Task 5: Frontend — Nút "Kiểm tra Token" trên page card (AC: #4)
  - [ ] 5.1: Thêm button "Kiểm tra Token" với `ShieldCheck` icon trên mỗi page card
  - [ ] 5.2: Gọi `GET /facebook/config/{page_id}/check-health` khi click
  - [ ] 5.3: Loading state trên button khi đang check
  - [ ] 5.4: Update badge ngay sau response (local state update, không cần refetch all)

- [ ] Task 6: Unit tests backend (AC: #1, #5)
  - [ ] 6.1: Test `GET /facebook/token-summary` — mixed statuses → correct aggregate + worst_status
  - [ ] 6.2: Test `_calc_days_remaining()` — future date, past date, None (never expires)
  - [ ] 6.3: Test smart event logging — status changed → event written, status unchanged → no event
  - [ ] 6.4: Test event level mapping — warning cho expiring_soon, error cho expired/invalid

## Dev Notes

### Existing Code Patterns — MUST Follow

**Story 7.1 đã tạo (dùng lại, KHÔNG tạo mới):**
- `token_lifecycle.py` → `check_token_health()`, `detect_token_type()`, `check_all_tokens()`
- `cron.py` → `token_health_check_job` (mở rộng thêm smart event logging)
- `FacebookPage` model → `token_type`, `token_expires_at`, `token_health_status`, `token_last_checked_at`

**Story 7.2 đã tạo (có thể có hoặc chưa implement):**
- `token_lifecycle.py` → `refresh_long_lived_token()`, `_exchange_user_token()`, `_derive_page_token()`
- `FacebookPage` model → `user_access_token`, `auto_refresh_enabled`, `token_refresh_error`, `last_refresh_at`
- **Kiểm tra model hiện tại trước khi code** — nếu Story 7.2 chưa implement, các fields này chưa có

**Event logging — `observability.py`:**
```python
from app.services.observability import record_event
record_event("token", "warning", "Token sắp hết hạn trong 5 ngày.", db=db,
    details={"page_id": page.page_id, "page_name": page.page_name, "days_remaining": 5})
record_event("token", "error", "Token đã hết hạn!", db=db,
    details={"page_id": page.page_id, "page_name": page.page_name, "previous_status": "expiring_soon"})
```

**API response format — mở rộng từ hiện tại:**
```python
# GET /facebook/config hiện tại trả:
{
    "page_id": page.page_id,
    "page_name": page.page_name,
    "has_token": bool(raw_token),
    "token_kind": get_token_kind(raw_token),
    "token_preview": mask_secret(decrypted),
    "token_is_encrypted": bool(...),
    # Story 7.1 thêm:
    "token_type": page.token_type,
    "token_expires_at": page.token_expires_at.isoformat() if page.token_expires_at else None,
    "token_health_status": page.token_health_status or "unknown",
    "token_last_checked_at": page.token_last_checked_at.isoformat() if ... else None,
    "days_remaining": _calc_days_remaining(page.token_expires_at),
}
```

**Frontend patterns — `App.jsx`:**
```jsx
// Icon usage pattern (đã import sẵn):
<CircleCheck className="w-4 h-4 text-green-400" />
<AlertTriangle className="w-4 h-4 text-yellow-400" />
<CircleX className="w-4 h-4 text-red-400" />
<Clock className="w-4 h-4 text-gray-400" />

// API call pattern:
const res = await fetch(`${API_URL}/facebook/config`);
const data = await res.json();

// Button pattern:
<button className={BUTTON_SECONDARY} disabled={loading} onClick={handleCheck}>
  {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
  Kiểm tra Token
</button>

// Banner pattern — render ở đầu Dashboard return:
{tokenSummary?.worst_status === 'expired' && (
  <div className="rounded-2xl bg-red-900/30 border border-red-500/30 p-4 mb-4 flex items-center gap-3">
    <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
    <span className="text-sm text-red-300">Token Facebook đã hết hạn!</span>
  </div>
)}
```

### Token Summary Endpoint Logic

```python
@router.get("/token-summary")
def get_token_summary(db: Session = Depends(get_db)):
    pages = db.query(FacebookPage).filter(
        FacebookPage.long_lived_access_token.isnot(None)
    ).all()

    counts = {"valid": 0, "expiring_soon": 0, "expired": 0, "invalid": 0, "unknown": 0}
    for page in pages:
        status = page.token_health_status or "unknown"
        if status in counts:
            counts[status] += 1

    # worst_status priority: invalid > expired > expiring_soon > unknown > valid
    priority = ["invalid", "expired", "expiring_soon", "unknown", "valid"]
    worst = "valid"
    for p in priority:
        if counts.get(p, 0) > 0:
            worst = p
            break

    return {
        "total_pages": len(pages),
        **counts,
        "worst_status": worst,
    }
```

### Smart Event Logging — Status Change Detection

```python
# Trong check_all_tokens() — mở rộng logic:
def check_all_tokens(db: Session):
    pages = db.query(FacebookPage).filter(...).all()
    for page in pages:
        previous_status = page.token_health_status  # lưu status cũ
        result = check_token_health(page.page_id, db)
        new_status = result.health_status

        # Chỉ ghi event khi status THAY ĐỔI
        if previous_status != new_status:
            if new_status == "expiring_soon":
                record_event("token", "warning",
                    f"Token sắp hết hạn trong {result.days_remaining} ngày.",
                    db=db, details={...})
            elif new_status in ("expired", "invalid"):
                record_event("token", "error",
                    f"Token đã {new_status}!",
                    db=db, details={"previous_status": previous_status, ...})
            elif new_status == "valid" and previous_status in ("expiring_soon", "expired", "invalid"):
                record_event("token", "info",
                    "Token đã khôi phục trạng thái hợp lệ.",
                    db=db, details={...})
```

### Config Vars
**KHÔNG cần thêm config mới** — Story 7.3 chỉ dùng infrastructure từ Story 7.1/7.2.

### Project Structure Notes

**Files sửa:**
- `backend/app/api/facebook.py` — Thêm `/token-summary` endpoint, đảm bảo response format có health fields
- `backend/app/services/token_lifecycle.py` — Mở rộng `check_all_tokens()` thêm smart event logging
- `frontend/src/App.jsx` — Thêm `TokenHealthBadge`, `TokenAlertBanner`, nút "Kiểm tra Token"

**Files mới:**
- `backend/tests/test_token_monitor.py` — Unit tests cho token summary + smart events

**KHÔNG SỬA:**
- `models.py` — Story 7.1 đã thêm columns cần thiết
- `cron.py` — Logic chạy từ Story 7.1, chỉ sửa `token_lifecycle.py`
- `security.py`, `fb_graph.py`, `campaign_jobs.py` — không liên quan

### Edge Cases & Error Handling

1. **Không có FacebookPage nào:** `/token-summary` trả `total_pages: 0`, `worst_status: "valid"` — Frontend không render banner
2. **Story 7.1 chưa implement:** `token_health_status` column chưa có → kiểm tra column exists trước, fallback "unknown"
3. **All pages are system_user:** `days_remaining = null` cho tất cả → badge xanh, không banner warning
4. **Multiple pages mixed status:** Banner hiển thị worst case — ưu tiên: invalid > expired > expiring_soon
5. **Check-health endpoint timeout:** Frontend catch error → hiển thị toast "Không thể kiểm tra token" + giữ badge cũ
6. **Auto-refresh 5s race condition:** Token summary cache ngắn — Frontend gọi mỗi 5s không gây load nặng (query đơn giản)

### Anti-Patterns to Avoid

- **KHÔNG** ghi `SystemEvent` mỗi 24h nếu status không thay đổi — chỉ ghi khi status transition
- **KHÔNG** tạo component file riêng cho badge/banner — giữ trong `App.jsx` theo pattern hiện tại (single-file SPA)
- **KHÔNG** hard-code badge colors — dùng Tailwind utility classes consistent với design hiện tại
- **KHÔNG** gọi `/check-health` tự động mỗi 5s — chỉ gọi khi Admin bấm nút (tránh rate limit Graph API)
- **KHÔNG** show token value trên badge/banner — chỉ hiển thị status text

### References

- [Source: architecture.md#D2: Token Lifecycle Architecture]
- [Source: epics.md#Epic 7, Story 7.3]
- [Source: Story 7.1 — 7-1-ho-tro-system-user-token-khong-het-han.md]
- [Source: Story 7.2 — 7-2-tu-dong-lam-moi-long-lived-token.md]
- [Source: backend/app/api/facebook.py — GET/POST /facebook/config patterns]
- [Source: backend/app/services/observability.py — record_event()]
- [Source: frontend/src/App.jsx — lucide-react icons, Tailwind classes, API patterns]
- [Source: backend/app/models/models.py — FacebookPage, SystemEvent models]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### Change Log

### File List
