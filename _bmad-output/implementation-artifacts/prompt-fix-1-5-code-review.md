# Dev Fix Prompt — Story 1.5 Code Review (G1–G6)

> Dán cho dev agent. Story 1.5 (admin tạo/thu hồi license) 7 AC cơ bản ĐÃ đạt, happy-path + 2 regression test (revoke→check/activate) PASS. Đây là 6 patch từ 3-layer adversarial review: **2 Major** (input overflow + error envelope sai AC1) + **4 Minor cheap**. KHÔNG đổi happy-path đã verify.
>
> ⚠️ ĐỌC TRƯỚC: `_bmad-output/project-context.md` § Testing Rules (Phase 3 backend test = PostgreSQL thật + Alembic, KHÔNG SQLite). Sau khi fix: `pytest backend/tests/automation/` PASS trên Postgres (`PHASE3_TEST_DATABASE_URL=postgresql://admin:adminpassword@127.0.0.1:55432/phase3_test` hoặc testcontainers) + `cd frontend && npm run lint`. Set Status story → `review` để re-review.
>
> Phạm vi: **backend** (`backend/app/...`) + **web `frontend/`**. KHÔNG đụng `automation-desktop/`. `automation-desktop/CLAUDE.md` KHÔNG áp dụng cho frontend (Phase 1+2 convention: no TS, native fetch, Tailwind, hardcode VN).

---

## 🟠 MAJOR

### G1 + G2 — Gộp: chuyển validation `days_total` về SERVICE (fix overflow + đúng envelope `LICENSE_INVALID`)

**Vấn đề:**
- **G1** (`schemas/automation/license.py:49-54`): `days_total` chỉ check `<= 0`, không có upper bound. Giá trị cực lớn (vd `1_000_000_000`) → tạo license 201, nhưng khi client `activate` chạy `now + timedelta(days=days_total)` → Python `timedelta` max ~999,999,999 ngày → `OverflowError` (không phải `SQLAlchemyError`/`LicenseActivationError` → không bị catch) → **unhandled 500** + license vĩnh viễn không activate được.
- **G2** (`schemas/automation/license.py:49`): pydantic `field_validator` raise `ValueError` TRƯỚC handler → FastAPI trả 422 standard `{"detail":[...]}`, KHÔNG phải envelope `{error:{code:"LICENSE_INVALID",message,retryable}}` mà AC1 yêu cầu. `_validate_days_total` ở service là dead-code cho path create.

**Fix:**

1. `backend/app/services/automation/license.py` — thêm hằng số + mở rộng `_validate_days_total`:
   ```python
   MAX_LICENSE_DAYS = 36500  # 100 năm — an toàn dưới ngưỡng timedelta (~2.7M ngày)
   ```
   Sửa `_validate_days_total(days_total: int)`:
   ```python
   def _validate_days_total(days_total: int) -> None:
       if days_total <= 0:
           raise _status_error("LICENSE_INVALID", "Số ngày sử dụng phải lớn hơn 0.")
       if days_total > MAX_LICENSE_DAYS:
           raise _status_error(
               "LICENSE_INVALID",
               f"Số ngày sử dụng không được vượt quá {MAX_LICENSE_DAYS} ngày.",
           )
   ```
   (Hàm này đã được `create_license_for_admin:194` VÀ `activate_license` gọi → cả 2 path tự bảo vệ.)

2. `backend/app/schemas/automation/license.py` — BỎ pydantic business validator, GIỮ type check:
   ```python
   class LicenseCreateRequest(BaseModel):
       days_total: int
   ```
   Xóa `@field_validator("days_total") validate_days_total`. (Type sai như string vẫn → 422 standard, chấp nhận được; còn rule `>0`/`<=MAX` về service → trả envelope `LICENSE_INVALID`.)

3. Vì validation giờ ở service, `create_license_endpoint` đã `except LicenseActivationError → _error_response(exc.code, ...)` (line 168-169) → tự động trả `LICENSE_INVALID` envelope. KHÔNG cần sửa endpoint cho phần này.

**Test cần cập nhật/ thêm** (`backend/tests/automation/test_automation_admin_license.py`):
- Đổi `test_license_create_request_rejects_zero_days` (line ~104): KHÔNG còn test pydantic raise. Thay bằng test ENDPOINT: `POST /admin/license {days_total:0}` → 422 + `resp.json()["error"]["code"] == "LICENSE_INVALID"` (verify envelope, không chỉ status code).
- Thêm `test_create_license_days_total_exceeds_max_returns_422`: `{days_total: 1_000_000_000}` → 422 + `error.code == "LICENSE_INVALID"`.
- (Tùy chọn) thêm test service `_validate_days_total(MAX_LICENSE_DAYS + 1)` raise `LICENSE_INVALID`.
- Giữ `test_license_create_request_accepts_positive_days` nhưng đổi sang giá trị hợp lệ qua endpoint nếu cần.

---

## ⚪ MINOR (cheap — fix cùng đợt)

### G3 — Thiếu test 401 cho `list` + `revoke`
`backend/tests/automation/test_automation_admin_license.py`: hiện chỉ có `test_create_license_unauthenticated_returns_401`. Guard giống nhau (RoleChecker→require_authenticated_user) nên hành vi đã đúng, chỉ thiếu coverage.
**Fix:** thêm 2 test:
- `test_list_licenses_unauthenticated_returns_401`: `GET /admin/license` không header Authorization → 401.
- `test_revoke_license_unauthenticated_returns_401`: `POST /admin/license/{uuid}/revoke` không header → 401.

### G4 — Frontend badge "Hoạt động" sai cho license đã hết hạn
`frontend/src/features/licenses/LicenseManagement.jsx` (chỗ render badge trạng thái): hiện chỉ phân biệt theo `lic.revoked`. License đã activate + `expires_at < now` vẫn hiện badge xanh "Hoạt động".
**Fix:** logic badge 3 nhánh: `revoked` → "Đã thu hồi" (đỏ); `activated && expires_at && new Date(expires_at) < new Date()` → "Hết hạn" (vàng/xám); còn lại nếu `activated` → "Hoạt động" (xanh); chưa activate → "Chưa kích hoạt" (xám). Giữ tiếng Việt + class màu hiện có.

### G5 — Cleanup import
- `backend/app/api/automation.py:165`: xóa inline import `from app.services.automation.license import _latest_activation, _admin_license_response  # noqa: PLC0415` → đưa 2 symbol này vào import top-level cùng nhóm `from app.services.automation.license import (...)` ở đầu file.
- `backend/app/services/automation/license.py:12`: xóa `LicenseRevokeResponse` khỏi import (KHÔNG dùng trong file service — chỉ dùng ở `automation.py`).

### G6 — `create_license_endpoint` thiếu `db.rollback()` trong `except SQLAlchemyError`
`backend/app/api/automation.py:170-175`: nhánh `except SQLAlchemyError` trả `_error_response` nhưng không `db.rollback()` → nếu `db.flush()` raise non-IntegrityError (vd `DataError`), session để dirty.
**Fix:** thêm `db.rollback()` ở đầu nhánh `except SQLAlchemyError` của `create_license_endpoint` (nhất quán với pattern rollback ở service check/activate).

---

## ⚪ Defer/accept (KHÔNG fix đợt này — đã note trong story)
N+1 list (admin low-volume), revoke double-click (idempotent), formatDate Invalid Date (backend luôn ISO), IntegrityError-misreport (near-impossible), key entropy 63-bit (đủ an toàn). KHÔNG cần đụng.

## ❌ KHÔNG phải lỗi (đừng "fix")
- RoleChecker đã enforce auth (depends require_authenticated_user) — list/revoke KHÔNG cần thêm `current_user` param.
- KHÔNG đổi response shape `/license/check` hoặc `/license/activate` (regression Story 1.4).
- KHÔNG guard router-level (giữ activate/check public).

## Definition of Done
- [ ] G1+G2: validation days_total ở service (`0 < days <= 36500`), bỏ pydantic business validator; `days_total<=0` và `>max` đều trả 422 envelope `LICENSE_INVALID`.
- [ ] G3: +2 test 401 (list, revoke).
- [ ] G4: badge frontend phân biệt revoked / hết hạn / hoạt động / chưa kích hoạt.
- [ ] G5: bỏ inline import + dead import.
- [ ] G6: `db.rollback()` trong create endpoint SQLAlchemyError handler.
- [ ] `pytest backend/tests/automation/` PASS trên Postgres thật (gồm test mới + 2 regression cũ vẫn xanh).
- [ ] `cd frontend && npm run lint` không thêm error mới.
- [ ] KHÔNG đổi `/license/check`, `/license/activate`, KHÔNG đụng `automation-desktop/`.
- [ ] Set Story 1.5 Status → `review`.

## Tham chiếu
- Story: `1-5-admin-tao-va-thu-hoi-license-key.md` § Review Findings (full triage).
- Rules: `_bmad-output/project-context.md` § Testing Rules; memory `phase3-review-rules`.
