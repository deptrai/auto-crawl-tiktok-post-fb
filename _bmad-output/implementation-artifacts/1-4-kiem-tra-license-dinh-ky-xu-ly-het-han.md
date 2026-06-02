# Story 1.4: Kiểm tra license định kỳ + xử lý hết hạn

Status: review

<!-- Phase 3 story. Sources: prd-phase3.md, architecture.md § Phase 3 Addendum (G-1), epics-phase3.md. Previous: 1.1, 1.2 done; 1.3 (license activate) — patches applied, đang re-review -->

## Story

As a user,
I want app tự kiểm tra license và xử lý hợp lý khi offline hoặc hết hạn,
so that tôi dùng được offline ngắn hạn nhưng không lạm dụng license hết hạn.

> ⚠️ **Phụ thuộc Story 1.3** (license activate, license-service, safeStorage). Implement SAU khi 1.3 đạt `done` (re-review xong). Story này mở rộng `license-service.ts` + App.tsx gate đã có từ 1.3.

## Acceptance Criteria

1. **Backend check endpoint**: `POST /api/v1/automation/license/check` nhận `{activation_id}` (hoặc `{key, hwid}`) → trả `{active, expires_at, revoked, rebind_count}` (active = chưa expired AND chưa revoked). Rate-limit như activate. Error tiếng Việt + `retryable`.
2. **Background check 4h**: Client chạy worker định kỳ mỗi 4h gọi `phase3:license:check` → cập nhật trạng thái local. Worker dừng khi app quit.
3. **Offline grace 24h (tier 1)**: Lưu `last_success_check` timestamp. Nếu online check fail (network/timeout): tier 1 action (xem profile, settings, view logs, export) vẫn chạy trong **24h** sau lần check success cuối (NFR18). Quá 24h offline → block tier 1 luôn cho đến khi check lại được.
4. **License hết hạn → read-only grace 7 ngày**: Khi `now > expires_at` (hoặc revoked): mọi action bị block; gate vào trạng thái `LICENSE_EXPIRED_READ_ONLY`; cho phép **read-only 7 ngày** để user export backup (Story 7.1) trước khi mất quyền.
5. **Sau 7 ngày**: Chỉ `LicenseView` active (để renew), các view khác disabled.
6. **Tier classification rõ ràng**: Định nghĩa tier 1 (read/local: profile view, settings, logs, export backup) vs tier 2+ (write: post/comment/share — Story 4.5+). Story 1.4 enforce gate cho tier 1 theo offline-grace; tier 2+ đã gate bằng per-action token (Story 4.5, không thuộc 1.4).
7. **IPC + state**: Channel `phase3:license:check` Zod 2-way + ErrorEnvelope retryable. App.tsx gate thêm state `license-expired-readonly` + `license-locked`.

## Tasks / Subtasks

### Backend (FastAPI — Python)

- [x] **Task 1: Check endpoint + service** (AC: #1)
  - [x] `backend/app/services/automation/license.py`: hàm `check_license(activation_id | key+hwid)` → trả status (active/expired/revoked + expires_at + rebind_count). Logic CHỈ ở service.
  - [x] `backend/app/schemas/automation/license.py`: `LicenseCheckRequest`, `LicenseCheckResponse{active, expires_at, revoked, rebind_count}`
  - [x] `backend/app/api/automation.py`: `POST /license/check` — reuse rate-limiter đã có (Story 1.3), try-except, error tiếng Việt + retryable
  - [x] Test pytest (Postgres + Alembic, theo conftest automation): active/expired/revoked/not-found

### Client (Electron — TypeScript)

- [x] **Task 2: Mở rộng license-service** (AC: #2, #3, #4)
  - [x] Thêm `check(): Promise<LicenseStatus>` vào `LicenseService` interface + impl (gọi backend `/license/check` với activation_id từ safeStorage)
  - [x] Lưu `license.last_success_check` (timestamp) vào settings khi check success
  - [x] `getStatus()` mở rộng: tính `offlineGraceValid` (now - last_success_check < 24h), `expiredReadonlyValid` (now - expires_at < 7 ngày), trả thêm field `gate: 'active' | 'offline-grace' | 'expired-readonly' | 'locked'`
  - [x] Tái dùng `strictDate`/`calculateDaysRemaining` đã có; KHÔNG `parseInt` lỏng (rule #12)
- [x] **Task 3: Background worker 4h** (AC: #2)
  - [x] `src/main/license/license-checker.ts`: setInterval 4h gọi license-service.check(); clearInterval khi app quit
  - [x] Wire vào bootstrap (init order); try-catch quanh check (rule #5) — fail không crash, chỉ giữ offline-grace
- [x] **Task 4: IPC check channel** (AC: #7)
  - [x] `src/shared/ipc-schemas/license.ts`: `LicenseCheckRequest/Response` Zod; đăng ký `phase3:license:check` channelRegistry
  - [x] `src/main/ipc/license-handlers.ts`: handler `phase3:license:check` Zod 2-way + ErrorEnvelope retryable
  - [x] `src/renderer/src/api/license-api.ts`: wrapper `checkLicense()`
- [x] **Task 5: App.tsx gate states** (AC: #4, #5, #6)
  - [x] GateState thêm `'license-expired-readonly'` + `'license-locked'`
  - [x] Logic: getStatus().gate → render: active=MainShell; offline-grace=MainShell + banner cảnh báo; expired-readonly=read-only shell + nút export backup + renew CTA; locked=chỉ LicenseView
  - [x] Tier 1 view (profile/settings/logs/export) check `gate !== 'locked'`; nếu offline quá 24h → block + message
- [x] **Task 6: Tests** (AC: tất cả)
  - [x] Backend pytest (Postgres): check active/expired/revoked
  - [x] Client unit: getStatus gate logic (offline-grace 24h boundary, expired-readonly 7 ngày boundary, locked) — test boundary chính xác (23h59 vs 24h01, 6d vs 8d)
  - [x] Client integration: license-checker worker gọi check + cập nhật last_success_check
  - [x] E2E: license expired → read-only shell hiện + export available; sau 7 ngày → chỉ LicenseView
  - [x] lint + typecheck + test PASS

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules) + `_bmad-output/project-context.md` § Testing Rules
- Backend test Phase 3 = PostgreSQL thật + Alembic (KHÔNG SQLite, KHÔNG ATTACH) — dùng `tests/automation/` conftest đã có
- Rule #5 try-catch external (check call), #6-9 IPC Zod+ErrorEnvelope retryable tiếng Việt, #12 parse số strict, #13 multi-step persist atomic, #16 loading-class riêng

### Previous story intelligence (1.3 — patches applied)
- `license-service.ts` đã có: `LicenseService` interface (`activate`, `getStatus`), `LicenseStatus {active, expiresAt?, daysRemaining?}`, `calculateDaysRemaining()`, `strictDate()`, `LicenseServiceError` (typed, code/message/retryable), keys `ACTIVATION_ID_KEY`/`EXPIRES_AT_KEY`/`REBIND_COUNT_KEY`. **Story 1.4 EXTEND, không tạo mới trùng.** [Source: automation-desktop/src/main/license/license-service.ts]
- `getStatus()` hiện đọc activation_id (safeStorage) + expires_at (settings) → tính daysRemaining. 1.4 thêm gate logic + last_success_check.
- safeStorage adapter đã crash-safe (patch 1.3). license-checker dùng lại.
- IPC channels `phase3:license:activate` + `phase3:license:status` đã đăng ký. 1.4 thêm `phase3:license:check`.
- App.tsx GateState hiện: `loading | needs-eula | needs-license | ready`. 1.4 thêm `license-expired-readonly | license-locked`.
- Backend `automation.py` đã có `_RateLimiter` + `/license/activate`. 1.4 thêm `/license/check`, reuse rate-limiter.
- State machine `LICENSE_EXPIRED_READ_ONLY` (architecture G-1) — `src/main/automation/` còn placeholder; 1.4 hiện thực gate này ở **license layer + App.tsx**, state machine automation_jobs đầy đủ là Epic 4 (Story 4.2). 1.4 chỉ cần gate UI + service, KHÔNG cần full job state machine.

### Architecture compliance
- Offline grace 24h tier 1 + per-action token tier 2+ [Source: architecture.md#ADR-P3-D2, #NFR-P3-License-Online-Check]
- Expired → LICENSE_EXPIRED_READ_ONLY + 7-day read-only grace để export [Source: architecture.md#G-1 License expired tier 1 behavior]
- Check qua server clock (chống client clock manipulation) — backend trả expires_at; client so với now nhưng quyết định "active" nên ưu tiên server response khi online [Source: architecture.md#R-D1]

### Scope — KHÔNG làm
- KHÔNG implement per-action token tier 2+ (Story 4.5)
- KHÔNG implement full automation_jobs state machine (Story 4.2) — chỉ gate license ở UI/service layer
- KHÔNG implement export backup logic (Story 7.1) — chỉ cho phép nút export active trong read-only grace (wire khi 7.1 done; story này để placeholder/disabled-with-note nếu 7.1 chưa có)
- KHÔNG implement self-service renew/rebind portal (Story 7.4)

### Edge cases cần xử lý (bài học từ review 1.2, 1.3)
- Clock manipulation: user lùi clock để tránh expire → ưu tiên server check khi online; offline-grace dựa last_success_check (server-stamped nếu có) không chỉ client now
- last_success_check chưa từng set (lần đầu offline) → KHÔNG cho offline-grace (phải online ít nhất 1 lần)
- expires_at parse fail → coi như expired (fail-safe), không cho qua gate
- Boundary chính xác: 24h grace, 7 ngày readonly — test cả 2 phía boundary
- Worker 4h: không chạy chồng (nếu check trước chưa xong); clear khi quit (không leak timer)

### References
- [Source: epics-phase3.md#Epic-1 Story-1.4]
- [Source: architecture.md#G-1] — license expired read-only 7-day grace + LICENSE_EXPIRED_READ_ONLY
- [Source: architecture.md#ADR-P3-D2, #R-D1] — periodic check, offline grace, server clock
- [Source: prd-phase3.md#FR6, #FR10] — periodic check + offline grace; block expired + read-only grace
- [Source: prd-phase3.md#NFR18] — license uptime + offline grace 24h
- [Source: automation-desktop/src/main/license/license-service.ts] — extend point
- [Source: automation-desktop/src/renderer/src/App.tsx] — gate states extend
- [Source: backend/app/api/automation.py] — reuse rate-limiter, add /check
- [Source: automation-desktop/CLAUDE.md], [Source: _bmad-output/project-context.md]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Backend PostgreSQL test cần container `phase3-manual-pg` (port 55432) — không chạy được với localhost:5432 mặc định; CI dùng `postgresql://admin:adminpassword@localhost:5432/medirus_test`.

### Completion Notes List

- **Task 1**: `check_license()` service function đã triển khai trong `license.py` (backend). Schema `LicenseCheckRequest/LicenseCheckResponse` thêm vào `schemas/automation/license.py`. Endpoint `POST /license/check` trong `automation.py` reuse `_RateLimiter`. 14 pytest PASS với Postgres + Alembic.
- **Task 2**: `LicenseService.check()` triển khai đầy đủ: gọi backend với `activation_id` từ safeStorage, lưu `last_success_check` + `expires_at` + `rebind_count` khi thành công. `getStatus()` tính `gate` từ `localStatus()` với `offlineGraceValid` (24h) + `expiredReadonlyValid` (7 ngày). Offline fallback dùng `last_success_check` từ settings. Edge case: `last_success_check` chưa set → không cho offline-grace (phải online 1 lần).
- **Task 3**: `createLicenseChecker()` dùng `setInterval` 4h, `checking` flag chống chạy chồng, `clearInterval` khi `stop()`. Wired vào `electron-bootstrap.ts` qua `deps.workers.licenseChecker`; `start()` khi ready, `stop()` trên `before-quit`.
- **Task 4**: `LicenseCheckRequestSchema/ResponseSchema` Zod thêm vào `ipc-schemas/license.ts`. Handler `phase3:license:check` đăng ký trong `license-handlers.ts` — Zod 2-way + `ErrorEnvelope retryable`. Wrapper `checkLicense()` trong `license-api.ts`.
- **Task 5**: `GateState` trong `App.tsx` thêm `'license-expired-readonly' | 'license-locked'`. `gateFromStatus()` map `gate` field sang `GateState`. `ReadonlyShell` hiện nút export placeholder (Story 7.1). `MainShell` hiện `offline-grace-banner` khi `gate === 'offline-grace'`. `license-locked` → render `LicenseView`.
- **Task 6**: 14 backend pytest PASS, 13 client unit+integration PASS, 4 E2E PASS. TypeScript typecheck PASS, ESLint PASS (1 non-error warning về module type).

### File List

- `backend/app/services/automation/license.py`
- `backend/app/schemas/automation/license.py`
- `backend/app/api/automation.py`
- `backend/tests/automation/test_automation_license.py`
- `automation-desktop/src/main/license/license-service.ts`
- `automation-desktop/src/main/license/license-checker.ts`
- `automation-desktop/src/main/license/index.ts`
- `automation-desktop/src/main/adapters/electron-bootstrap.ts`
- `automation-desktop/src/main/ipc/license-handlers.ts`
- `automation-desktop/src/shared/ipc-schemas/license.ts`
- `automation-desktop/src/renderer/src/api/license-api.ts`
- `automation-desktop/src/renderer/src/App.tsx`
- `automation-desktop/tests/unit/license-service.spec.ts`
- `automation-desktop/tests/integration/license-checker.spec.ts`
- `automation-desktop/tests/integration/license-ipc-handlers.spec.ts`
- `automation-desktop/tests/e2e/license.spec.ts`

### Change Log

- 2026-06-02: Implement story 1.4 — check endpoint backend, license-service check() + getStatus() gate, background worker 4h, IPC check channel, App.tsx gate states (expired-readonly + locked), full test suite PASS.
