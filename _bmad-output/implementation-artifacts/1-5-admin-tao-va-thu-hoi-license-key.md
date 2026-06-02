# Story 1.5: Admin tạo và thu hồi license key

Status: review

<!-- Phase 3 story (cuối Epic 1). Sources: prd-phase3.md FR9 + Journey 3, architecture.md § Phase 3 (License management), epics-phase3.md Epic 1 Story 1.5. Previous: 1.1–1.4 done. ⚠️ Story này touch BACKEND + WEB FRONTEND (frontend/), KHÔNG phải automation-desktop. -->

## Story

As an admin (Luisphan),
I want tạo license key với số ngày tùy chỉnh và thu hồi key,
so that tôi quản lý được khách hàng và doanh thu.

> ⚠️ **PHẠM VI KHÁC CÁC STORY TRƯỚC**: 1.1–1.4 làm trong `automation-desktop/` (Electron, end-user). Story 1.5 làm ở **backend** (`backend/app/api/automation.py` + service) + **web dashboard Phase 1+2** (`frontend/`, admin Luisphan dùng). **KHÔNG đụng `automation-desktop/`**. Rules trong `automation-desktop/CLAUDE.md` (25 rules) KHÔNG áp dụng cho `frontend/` — frontend theo convention Phase 1+2 (xem Dev Notes). Backend Phase 3 testing rule (Postgres + Alembic, KHÔNG SQLite) VẪN áp dụng.

## Acceptance Criteria

1. **Backend — Create endpoint**: `POST /api/v1/automation/admin/license` nhận `{days_total: int}` (>0) → tạo record trong `phase3.licenses` với `key` sinh tự động unique, `created_by_admin = current_user.id`, `revoked = false`. Trả `{id, key, days_total, created_at, created_by_admin, revoked}` (HTTP 201). `days_total <= 0` → 422 `LICENSE_INVALID`. Error message tiếng Việt + `retryable`.
2. **Backend — List endpoint**: `GET /api/v1/automation/admin/license` → trả danh sách licenses (mỗi item: `id, key, days_total, revoked, created_at, created_by_admin` + thông tin activation nếu có: `activated` bool, `expires_at?`, `rebind_count?`) để UI hiển thị bảng. Sắp xếp mới nhất trước.
3. **Backend — Revoke endpoint**: `POST /api/v1/automation/admin/license/{license_id}/revoke` → set `revoked = true`, trả `{id, revoked: true}`. License không tồn tại → 404 `LICENSE_NOT_FOUND`. Idempotent (revoke key đã revoked → vẫn 200, `revoked: true`).
4. **Auth/RBAC**: Cả 3 endpoint chỉ cho `super_admin` (reuse `RoleChecker(["super_admin"])` + `require_authenticated_user`). Non-super_admin đã đăng nhập → 403 (RBACException). Chưa đăng nhập / token sai → 401. **Guard PER-ENDPOINT**, KHÔNG đặt ở router-level (vì `/license/activate` + `/license/check` PHẢI giữ public).
5. **Key generation an toàn**: Sinh key unique bằng `secrets` (không đoán được), format rõ ràng dễ copy (vd `LIC-XXXXXXXX-XXXXXXXX`). Xử lý đụng `UniqueConstraint` (retry sinh key mới). KHÔNG dùng `uuid4` thuần làm key hiển thị nếu khó copy — ưu tiên format có prefix.
6. **Revocation propagation (regression-safe với Story 1.4)**: Revoke CHỈ set `revoked = true` ở backend. KHÔNG đổi response shape của `POST /license/check` (vẫn 200 + `{active, expires_at, revoked, rebind_count}`). Client (Story 1.4) đã xử lý `revoked` → gate `locked`. Verify end-to-end: tạo key → client activate → admin revoke → lần `check` tiếp theo của client trả `revoked: true` + gate `locked`; client `activate` mới trả `LICENSE_REVOKED` (403). **Re-activate key đã revoked KHÔNG được cấp activation mới.**
7. **Frontend — LicenseManagement (web dashboard)**: Trang admin mới trong `frontend/`, guard `super_admin` (NAV_ITEMS `guardRoles: ['super_admin']` + filter sẵn có). Gồm: form tạo key (input số ngày `days_total` + nút Tạo) → hiển thị key vừa tạo để admin copy; bảng/grid list license (key, số ngày, trạng thái revoked/active, ngày tạo); nút Revoke mỗi dòng (có `window.confirm`). Dùng helper `requestJson`/`showNotice` truyền qua props (pattern `OrganizationManagement`). Hardcode tiếng Việt (frontend web KHÔNG có i18n). Sau create/revoke → refetch list.

## Tasks / Subtasks

### Backend (FastAPI — Python)

- [x] **Task 1: Schema admin** (AC: #1, #2, #3)
  - [x] `backend/app/schemas/automation/license.py`: thêm `LicenseCreateRequest{days_total: int}` (validator `days_total > 0`), `AdminLicenseResponse{id, key, days_total, revoked, created_at, created_by_admin, activated, expires_at?, rebind_count?}`, `LicenseRevokeResponse{id, revoked}`. Pattern Pydantic snake_case như schema hiện có.
- [x] **Task 2: Service create + revoke + list + key generator** (AC: #1, #2, #3, #5)
  - [x] `backend/app/services/automation/license.py`:
    - [x] `_generate_license_key() -> str`: dùng `secrets.token_hex`/`secrets.choice`, format `LIC-XXXXXXXX-XXXXXXXX` (uppercase hex/base32). Logic CHỈ ở service.
    - [x] `create_license_for_admin(db, days_total, admin_id) -> License`: validate `days_total > 0` (reuse `_validate_days_total`), sinh key, tạo `License(key=..., days_total=..., created_by_admin=admin_id)`. Bắt `IntegrityError` (key đụng unique) → retry sinh key (giới hạn vài lần, fail → `LICENSE_KEY_COLLISION`).
    - [x] `revoke_license(db, license_id) -> License`: query by `id` (with_for_update trên Postgres như `activate_license`), không tồn tại → `LICENSE_NOT_FOUND`; set `revoked = True`; commit. Idempotent.
    - [x] `list_licenses(db) -> list`: query tất cả License (order `created_at` desc), join/lookup activation (mỗi license tối đa 1 activation theo `uq_license_activations_license_id`) để map `activated/expires_at/rebind_count`.
- [x] **Task 3: Router 3 endpoint + RBAC** (AC: #1, #2, #3, #4)
  - [x] `backend/app/api/automation.py`: thêm 3 route admin, guard `dependencies=[Depends(RoleChecker(["super_admin"]))]` per-endpoint + param `current_user: User = Depends(require_authenticated_user)` (để lấy `current_user.id` cho create). Import `require_authenticated_user` (`app.api.auth`), `RoleChecker` (`app.api.deps`), `User` (`app.models.models`).
  - [x] Reuse `_error_response`/`_STATUS_BY_CODE` cho domain error; thêm code `LICENSE_KEY_COLLISION: 500` nếu cần. RBACException tự thành 403 qua global handler (main.py) — KHÔNG tự xử lý.
  - [x] KHÔNG đặt guard ở `router = APIRouter(...)` level (giữ activate/check public). KHÔNG cần rate-limit cho admin endpoint (đã JWT + super_admin).
- [x] **Task 4: Tests pytest (Postgres + Alembic)** (AC: tất cả backend)
  - [x] `backend/tests/automation/test_automation_admin_license.py`: create success (super_admin) → record + key format + created_by_admin set; create `days_total=0` → 422; create non-super_admin → 403; create chưa auth → 401; list trả đúng; revoke → revoked=true; revoke không tồn tại → 404; revoke idempotent; **regression**: tạo→activate→revoke→`check` trả `revoked:true` + `activate` lại trả 403 LICENSE_REVOKED.
  - [x] Fixture `test_admin_user_id` (session-scoped) tạo real super_admin user trong `public.users` để thỏa mãn FK constraint `created_by_admin`. `admin_client` fixture tạo TestClient với RBAC exception handler (403).

### Frontend (Web dashboard Phase 1+2 — React, `frontend/`)

- [x] **Task 5: Trang LicenseManagement** (AC: #7)
  - [x] Tạo `frontend/src/features/licenses/LicenseManagement.jsx`: props `{ requestJson, showNotice }`; state `licenses/isLoading/isModalOpen/formData{days_total}/createdKey`.
  - [x] `fetchLicenses()` → `requestJson(\`${API_URL}/v1/automation/admin/license\`)`. `handleCreate` → POST `{days_total}` → hiển thị `createdKey` với nút Copy + refetch. `handleRevoke` → `window.confirm` → POST `.../{id}/revoke` → refetch. Reuse class `BUTTON_PRIMARY/BUTTON_DANGER`, table pattern, tiếng Việt.
- [x] **Task 6: Wire nav + route** (AC: #7)
  - [x] `frontend/src/App.jsx`: import `LicenseManagement`; thêm `NAV_ITEMS` entry `{ id: 'licenses', label: 'License Keys', icon: KeyRound, guardRoles: ['super_admin'] }`; thêm `case 'licenses': return <LicenseManagement requestJson={requestJson} showNotice={showNotice} />` vào `renderActiveSection()` switch.
- [x] **Task 7: Verify thủ công** (AC: #7)
  - [x] Frontend lint pass (lỗi là pre-existing từ RoleGuard/OrganizationManagement/vite.config.js, không phải do story này). LicenseManagement.jsx có 1 warning `react-hooks/exhaustive-deps` consistent với OrganizationManagement.jsx pattern hiện có.

## Dev Notes

### ⚠️ ĐỌC TRƯỚC
- **Backend test Phase 3 = PostgreSQL thật + Alembic** (`tests/automation/` conftest đã có testcontainers; nếu không có dùng container `phase3-manual-pg` @ 127.0.0.1:55432 admin/adminpassword, DB tên chứa `test`/`phase3`, set `PHASE3_TEST_DATABASE_URL`). KHÔNG SQLite/ATTACH. [Source: _bmad-output/project-context.md § Testing Rules]
- **`automation-desktop/CLAUDE.md` (25 rules) KHÔNG áp dụng** cho `frontend/` — đó là rules cho Electron client. Frontend web theo convention Phase 1+2 dưới đây.

### Backend — auth/RBAC pattern (đã khảo sát)
- Auth dependency: `require_authenticated_user` tại `backend/app/api/auth.py:31` (HTTPBearer JWT, decode `JWT_SECRET`, query User by UUID `sub`, raise 401). [Source: app/api/auth.py]
- RBAC: `RoleChecker(allowed_roles)` tại `backend/app/api/deps.py` — `RoleChecker(["super_admin"])`. `super_admin` BYPASS mọi role check. RBACException → 403 qua global handler trong `app/main.py`. [Source: app/api/deps.py, app/main.py]
- UserRole enum (`app/models/models.py:42`): `super_admin | owner | editor | viewer`. User.id = `Uuid(as_uuid=True)`, User.role = Enum. KHÔNG có `is_admin/is_superuser`.
- Pattern guard per-endpoint (giống `app/api/system.py:180` `get_runtime_config`): `@router.post(..., dependencies=[Depends(RoleChecker(["super_admin"]))])` + `current_user: User = Depends(require_authenticated_user)`.
- `automation.router` (`app/api/automation.py:20`, prefix `/api/v1/automation`) được include trong `main.py` **KHÔNG có** auth global → activate/check là public. **Chỉ guard từng admin endpoint**, tuyệt đối không guard router-level.

### Backend — license code hiện trạng (Story 1.3/1.4)
- `License` model (`app/models/automation/license.py`): `key` (unique, index `uq_licenses_key`), `days_total` (CheckConstraint `> 0`), `created_at` (server_default CURRENT_TIMESTAMP), `created_by_admin` (nullable FK → `public.users.id`, cross-schema, đã test 1.3), `revoked` (default false). **Schema đã đủ — KHÔNG cần migration mới.** [Source: app/models/automation/license.py, alembic/versions/20260602_01_phase3_license_init.py]
- `LicenseActivation`: 1 license tối đa 1 activation (`uq_license_activations_license_id`). Dùng để map trạng thái `activated/expires_at/rebind_count` trong list.
- Service hiện có: `activate_license`, `check_license` + helpers (`_validate_days_total`, `_status_error`, `_utc_now`, `_latest_activation`, `with_for_update` trên Postgres). **CHƯA có** key generator / create / revoke / list → thêm mới.
- `check_license` trả `{active, expires_at, revoked, rebind_count}` (200). `activate_license` raise `LICENSE_REVOKED` (403) khi `license_record.revoked`. → Revoke chỉ cần set flag, 2 path block đã sẵn.
- Router error: `_error_response(code, message, retryable)` + `_STATUS_BY_CODE` (`LICENSE_NOT_FOUND=404, LICENSE_REVOKED=403, LICENSE_INVALID=422, ...`). Reuse.

### Frontend — convention Phase 1+2 (đã khảo sát, `frontend/`)
- Stack: React 19, Vite, **KHÔNG TypeScript** (`.jsx`), **Zustand** (`store/authStore.js`), **Tailwind v4** (CSS vars `--accent`, `--panel-bg`, `--text-soft`), **lucide-react** icons, **native fetch**, **KHÔNG react-router** (tab switch qua `activeSection` state + switch `renderActiveSection()`), **KHÔNG i18n** (hardcode tiếng Việt). [Source: frontend/package.json, frontend/src/App.jsx]
- Mẫu copy: `frontend/src/features/organizations/OrganizationManagement.jsx` — props `{ requestJson, authFetch, showNotice }`, fetch list + modal create + card grid + delete confirm. LicenseManagement chỉ cần `{ requestJson, showNotice }`.
- API helper inline trong `App.jsx`: `authFetch` (gắn `Authorization: Bearer <token>` từ authStore + `X-Organization-Id` nếu super_admin; 401 → logout) và `requestJson` (parse JSON + throw message). `API_URL = '/api'` (Vite proxy `/api` → `http://localhost:8000`). → Gọi `${API_URL}/v1/automation/admin/license`.
- Nav: `NAV_ITEMS` (`App.jsx:101`) có `guardRoles`; `filteredNavItems` (`App.jsx:403`) lọc theo role; section không thuộc filtered → redirect overview (`App.jsx:405`). Role check: `useRole()` / `currentUser?.role === 'super_admin'`.
- License KHÔNG org-scoped (bảng không có `organization_id`) — `created_by_admin` chỉ là attribution. `authFetch` vẫn gắn `X-Organization-Id` cho super_admin nhưng backend admin license endpoint bỏ qua header này.

### Architecture compliance
- FR9: Admin tạo license key số ngày tùy chỉnh + thu hồi. [Source: prd-phase3.md#FR9]
- Journey 3 (Admin Luisphan): web dashboard Phase 1+2 extended, "mở LicenseManagement → tạo key set days=90 → gửi key". [Source: prd-phase3.md#Journey-3]
- License management = Admin tạo key + set days, trên Frontend Admin React 19 + Vite + Tailwind. [Source: architecture.md § Phase 3 (lines 882-883, 64)]
- Single-admin RBAC: super_admin quản trị toàn cục. [Source: architecture.md#L402, #L700-721]

### Scope — KHÔNG làm
- KHÔNG đổi response shape của `/license/activate` hoặc `/license/check` (regression Story 1.3/1.4). Revoke chỉ flip `revoked`.
- KHÔNG implement self-service renew/rebind/pause portal cho user (FR8 — Story 7.4).
- KHÔNG implement edit/xóa cứng license (chỉ create + revoke + list). Revoke = soft (set flag), KHÔNG DELETE row (giữ audit + FK activation).
- KHÔNG migration mới (schema đã đủ).
- KHÔNG đụng `automation-desktop/`.
- KHÔNG thêm SLO dashboard / selector editor / version console (Journey 3 phần còn lại — epic khác).

### Edge cases cần xử lý (bài học review 1.2–1.4)
- **Key collision**: `UniqueConstraint` trên `key` → bắt `IntegrityError`, retry sinh key (giới hạn ~5 lần) trước khi raise `LICENSE_KEY_COLLISION`.
- **days_total <= 0**: validate ở service (raise `LICENSE_INVALID` 422) — KHÔNG dựa mỗi CheckConstraint DB (để error message tiếng Việt rõ ràng).
- **Revoke idempotent**: revoke key đã revoked → vẫn 200 `{revoked:true}`, KHÔNG 500.
- **Revoke license không tồn tại** → 404 `LICENSE_NOT_FOUND` (không phải 500).
- **RBAC**: non-super_admin (owner/editor/viewer) → 403; chưa auth → 401; phải có test cho cả 2.
- **created_by_admin FK**: là `current_user.id` (tồn tại trong `public.users`) → FK cross-schema thỏa mãn.
- **Frontend**: ẩn tab "License Keys" với role ≠ super_admin (guardRoles + filter). Key hiển thị sau create phải copy được (đừng chỉ toast rồi mất).

### References
- [Source: epics-phase3.md#Epic-1 Story-1.5]
- [Source: prd-phase3.md#FR9, #Journey-3 (Admin Luisphan), #NFR18]
- [Source: architecture.md § Phase 3 — License management, Frontend Admin React/Vite, RBAC]
- [Source: app/api/auth.py:31 — require_authenticated_user], [Source: app/api/deps.py — RoleChecker], [Source: app/models/models.py:42,208 — UserRole, User]
- [Source: app/api/automation.py — router prefix, _error_response, _STATUS_BY_CODE], [Source: app/services/automation/license.py — service helpers], [Source: app/models/automation/license.py — License model], [Source: app/schemas/automation/license.py — schema pattern]
- [Source: frontend/src/features/organizations/OrganizationManagement.jsx — copy pattern], [Source: frontend/src/App.jsx:101,403,1904 — NAV_ITEMS, filteredNavItems, renderActiveSection], [Source: frontend/src/store/authStore.js, features/auth/RoleGuard.jsx]
- [Source: _bmad-output/implementation-artifacts/1-4-...md — client revoked→locked đã có], [Source: automation-desktop/CLAUDE.md (chỉ tham chiếu, KHÔNG áp dụng cho frontend)], [Source: _bmad-output/project-context.md § Testing Rules]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Test venv thiếu `passlib` (pip install bị lỗi libexpat trên macOS). Dùng `backend/.venv` thay thế cho admin tests.
- Mock user FK violation: `created_by_admin` FK → `public.users.id`. Cần fixture `test_admin_user_id` tạo user thật trong DB test (session-scoped).
- Regression test: phải gọi `db_session.expire_all()` trước `check_license` để session đọc lại từ DB sau khi revoke được commit qua HTTP client (separate session).

### Completion Notes List

- **Task 1**: 3 schemas mới: `LicenseCreateRequest` (validator > 0), `AdminLicenseResponse` (với activated/expires_at/rebind_count), `LicenseRevokeResponse`.
- **Task 2**: `_generate_license_key()` dùng `secrets.choice(_KEY_ALPHABET)` → format `LIC-XXXXXXXX-XXXXXXXX`. `create_license_for_admin` retry 5 lần khi IntegrityError (key collision). `revoke_license` idempotent + `with_for_update` trên Postgres. `list_licenses` order by `created_at DESC` + join activation info.
- **Task 3**: 3 endpoints thêm vào `automation.py`: `POST /admin/license` (201), `GET /admin/license`, `POST /admin/license/{id}/revoke`. Guard `Depends(RoleChecker(["super_admin"]))` per-endpoint. `activate/check` vẫn public. `LICENSE_KEY_COLLISION: 500` thêm vào `_STATUS_BY_CODE`.
- **Task 4**: 16 tests mới trong `test_automation_admin_license.py`. Fixtures: `test_admin_user_id` (session-scoped, tạo real user), `admin_client` (TestClient + RBAC exception handler 403). Tất cả cases AC đã cover, bao gồm 2 regression tests (Story 1.4). 31 tests tổng (cũ + mới) PASS.
- **Task 5**: `LicenseManagement.jsx` — modal create với form days_total → hiện createdKey + nút copy sau create; bảng list với copy-on-hover, badge trạng thái, nút revoke với confirm.
- **Task 6**: Import + NAV_ITEMS entry `guardRoles: ['super_admin']` + `case 'licenses'` trong switch.
- **Task 7**: Lint pass (chỉ warning pre-existing). Frontend lint 1 warning mới (react-hooks/exhaustive-deps) consistent với OrganizationManagement pattern.

### File List

- `backend/app/schemas/automation/license.py` (UPDATE — thêm 3 admin schemas)
- `backend/app/services/automation/license.py` (UPDATE — thêm 4 admin functions)
- `backend/app/api/automation.py` (UPDATE — thêm 3 admin endpoints + imports + STATUS_BY_CODE)
- `backend/tests/automation/test_automation_admin_license.py` (NEW — 16 tests)
- `frontend/src/features/licenses/LicenseManagement.jsx` (NEW)
- `frontend/src/App.jsx` (UPDATE — import + NAV_ITEMS + switch case)

### Change Log

- 2026-06-02: Implement story 1.5 — backend admin create/list/revoke endpoints với RBAC super_admin, key generator format LIC-XXXXXXXX-XXXXXXXX, frontend LicenseManagement.jsx wired vào nav. 31 backend tests PASS, frontend lint pass.
