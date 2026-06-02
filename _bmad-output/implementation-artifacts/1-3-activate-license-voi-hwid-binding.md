# Story 1.3: Activate license với HWID binding

Status: review

<!-- Phase 3 story. Sources: prd-phase3.md, architecture.md § Phase 3 Addendum, epics-phase3.md. Previous: 1.1, 1.2 (done) -->

## Story

As a user,
I want kích hoạt app bằng license key gắn với máy của tôi,
so that tôi có quyền sử dụng tool trong số ngày đã mua.

> ⚠️ **Story lớn — spans backend (FastAPI) + client (Electron).** Đây là story đầu tiên chạm Python backend. Cân nhắc split thành 1.3a (backend license API) + 1.3b (client activation) nếu muốn granular hơn. Tasks dưới đây tách rõ 2 phần.

## Acceptance Criteria

1. **Backend schema**: Alembic migration tạo schema `phase3` + bảng `phase3.licenses` (key, days_total, created_at, created_by_admin, revoked) + `phase3.license_activations` (id, license_id FK, hwid_hash, activated_at, expires_at, rebind_count).
2. **Backend activate endpoint**: `POST /api/v1/automation/license/activate` nhận `{key, hwid}` → verify key tồn tại + chưa revoked → bind HWID + compute `expires_at = now + days_total` → trả `{activation_id, expires_at, rebind_count}`.
3. **HWID mismatch**: Nếu key đã activate trên HWID khác → trả `LICENSE_HWID_MISMATCH` với hướng dẫn rebind.
4. **Client HWID gen**: Client tính `HWID = SHA-256(machine_uuid + "|" + mac + "|" + cpu_brand)` (64 hex) qua `node-machine-id` + os info.
5. **Client activation flow**: User nhập key vào `LicenseView` → client gửi HWID + key tới backend → lưu `activation_id` + `expires_at` an toàn → hiển thị "License active: còn N ngày".
6. **safeStorage thật**: Implement `ElectronSafeStorage` adapter thật (hiện stub return null) dùng Electron `safeStorage` API để lưu `activation_id` (license private).
7. **Error handling**: HWID mismatch, key invalid, key revoked, network error → hiển thị message tiếng Việt rõ ràng, có hướng dẫn.
8. **IPC channels**: `phase3:license:activate`, `phase3:license:status` wired end-to-end với Zod 2-way + ErrorEnvelope (có `retryable`).

## Tasks / Subtasks

### Backend (FastAPI — Python)

- [x] **Task 1: Alembic migration phase3 schema** (AC: #1)
  - [x] `backend/alembic/versions/<rev>_phase3_init.py`: `CREATE SCHEMA IF NOT EXISTS phase3`
  - [x] Bảng `phase3.licenses`: id (UUID PK), key (unique), days_total (int), created_at (timestamptz), created_by_admin (FK users.id nullable), revoked (bool default false)
  - [x] Bảng `phase3.license_activations`: id (UUID PK), license_id (FK phase3.licenses), hwid_hash (varchar 64), activated_at, expires_at, rebind_count (int default 0)
  - [x] Index: `idx_license_activations_hwid`, `uq_licenses_key`
  - [x] `search_path = phase3, public` trong migration
- [x] **Task 2: SQLAlchemy models** (AC: #1)
  - [x] `backend/app/models/automation/license.py`: `License`, `LicenseActivation` (schema='phase3')
  - [x] Absolute import `from app.x` (project-context rule), type hints bắt buộc
- [x] **Task 3: Pydantic schemas + service** (AC: #2, #3)
  - [x] `backend/app/schemas/automation/license.py`: `LicenseActivateRequest{key, hwid}`, `LicenseActivateResponse{activation_id, expires_at, rebind_count}`
  - [x] `backend/app/services/automation/license.py`: `activate(key, hwid)` business logic (logic CHỈ ở service layer)
  - [x] `backend/app/services/automation/hwid.py`: validate hwid format (64 hex)
- [x] **Task 4: FastAPI router** (AC: #2, #3)
  - [x] `backend/app/api/automation.py`: router `/api/v1/automation/*`
  - [x] `POST /license/activate` — parse request, gọi service, try-except bọc external (anti-pattern rule), trả response
  - [x] Include router vào `app/main.py`
  - [x] Error codes: `LICENSE_NOT_FOUND`, `LICENSE_REVOKED`, `LICENSE_HWID_MISMATCH` — message tiếng Việt

### Client (Electron — TypeScript)

- [x] **Task 5: HWID generator** (AC: #4)
  - [x] Install `node-machine-id` + verify electron-rebuild nếu cần native (`npx electron-rebuild -f -w` — story 1.1 rule)
  - [x] `src/main/license/hwid-generator.ts`: `generateHwid(): string` = SHA-256(machine_uuid + "|" + mac + "|" + cpu_brand)
  - [x] Deterministic — cùng máy luôn cùng HWID
- [x] **Task 6: safeStorage adapter thật** (AC: #6)
  - [x] Implement `src/main/adapters/electron-safe-storage.ts` (hiện stub) dùng Electron `safeStorage.encryptString`/`decryptString` + lưu encrypted blob (vào local_settings hoặc file riêng)
  - [x] `activation_id` lưu qua safeStorage (license private)
- [x] **Task 7: License IPC + service client** (AC: #5, #8)
  - [x] `src/shared/ipc-schemas/license.ts`: Zod `LicenseActivateRequest/Response`, `LicenseStatusRequest/Response`; đăng ký channelRegistry
  - [x] `src/main/license/license-service.ts`: gọi HWID gen + HTTP POST backend (qua `shared/api-client/http-client` — tạo nếu chưa có, cert pinning sẽ thêm Epic 8) + lưu activation_id safeStorage
  - [x] `src/main/ipc/license-handlers.ts`: `phase3:license:activate`, `phase3:license:status` — Zod 2-way, ErrorEnvelope + retryable
  - [x] `src/renderer/src/api/license-api.ts`: wrapper
- [x] **Task 8: LicenseView UI** (AC: #5, #7)
  - [x] `src/renderer/src/views/LicenseView.tsx`: input key + nút activate + hiển thị status "còn N ngày" + error messages tiếng Việt + hướng dẫn rebind khi HWID mismatch
  - [x] Integrate vào App.tsx gate flow (sau EULA accept → check license → nếu chưa activate hiện LicenseView)
- [x] **Task 9: Tests** (AC: tất cả)
  - [x] Backend pytest: `backend/tests/api/test_automation_license.py` — activate success, HWID mismatch, revoked, not found (DB rollback an toàn)
  - [x] Client integration: license-service HWID gen deterministic + safeStorage round-trip
  - [x] E2E `@playwright/test`: nhập key → activate → hiển thị status; mismatch flow
  - [x] lint + typecheck + test PASS cả backend lẫn client

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules) + `automation-desktop/project-context.md`
Tất cả rules từ review Story 1.1 & 1.2 đã được distill. Đặc biệt với story này:
- **Rule #5**: DB/external call wrap try/catch
- **Rule #6-9**: IPC channel `phase3:license:*`, Zod 2-way, ErrorEnvelope có `retryable`, message tiếng Việt
- **Rule #10**: `activation_id` là license private → safeStorage, KHÔNG qua IPC payload raw (trả về renderer chỉ status, không trả activation_id raw)
- **Rule #12**: parse số (days, expires) strict
- **Rule #23**: `node-machine-id` native → `npx electron-rebuild` + verify `.node`
- **Rule #24**: backend test job CI ở root

### Backend conventions (Phase 1+2 — root project-context.md)
- Absolute imports `from app.x import y` (KHÔNG relative)
- Logic nghiệp vụ CHỈ ở `services/`, router chỉ parse + validate + gọi service
- Alembic là source of truth migration (`alembic upgrade head`)
- Type hints bắt buộc; PEP8; snake_case
- **Anti-pattern CRITICAL**: mọi external call (DB, network) wrap try-except — rate-limit/IP-block có thể crash worker
- Test: `backend/tests/`, DB test auto-rollback

### Previous story intelligence (1.1, 1.2 done)
- `safeStorage` adapter HIỆN STUB (return null) — story này implement thật. [Source: automation-desktop/src/main/adapters/electron-safe-storage.ts]
- IPC pattern đã wire ở 1.2: `channelRegistry`, Zod 2-way, ErrorEnvelope `{ok, error:{code,message,retryable,details}}`. Theo đúng pattern license-handlers giống settings-handlers.
- `local_settings` table + settings-repo đã có — có thể lưu `expires_at` (non-secret) ở đây, `activation_id` ở safeStorage.
- DB key vẫn temp `phase3-story-1-1-temp-key` — story này CÓ THỂ wire safeStorage master key cho DB (architecture nói key thật từ safeStorage là story 1.3). Cân nhắc: nếu wire master key, phải migrate DB cũ. Đề xuất: story 1.3 chỉ dùng safeStorage cho activation_id, master key DB để story riêng nếu phức tạp.
- HTTP client (`shared/api-client/http-client.ts`) CHƯA tồn tại — story này tạo (axios hoặc fetch). Cert pinning thêm Epic 8.

### Architecture compliance
- HWID algorithm: `SHA-256(machine_uuid + "|" + mac + "|" + cpu_brand).slice(0,64)` [Source: architecture.md#G-4]
- Backend schema phase3 + 2 bảng [Source: architecture.md#ADR-P3-D7]
- License model: online activate + HWID bind [Source: architecture.md#ADR-P3-D2]
- Backend extend FastAPI, reuse auth/RBAC [Source: architecture.md#ADR-P3-D9]
- Per-action token (FR7) KHÔNG thuộc story này — đó là Story 4.5. Story 1.3 chỉ activate.

### Scope — KHÔNG làm
- KHÔNG implement periodic check/expire handling (Story 1.4)
- KHÔNG implement admin create license UI (Story 1.5) — nhưng cần seed 1 license key thủ công để test (qua SQL hoặc fixture)
- KHÔNG implement per-action token (Story 4.5)
- KHÔNG implement self-service rebind portal (Story 7.4) — chỉ hiển thị hướng dẫn khi mismatch

### Library versions
- `node-machine-id` — latest stable; lưu ý có thể cần electron-rebuild
- Backend: FastAPI 0.104.1, SQLAlchemy 2.0 (asyncpg), Alembic 1.16.4 (versions từ Phase 1+2)
- `zod@4`, `better-sqlite3-multiple-ciphers@12` (client)

### References

- [Source: epics-phase3.md#Epic-1 Story-1.3]
- [Source: architecture.md#ADR-P3-D2] — license model, HWID, per-action token
- [Source: architecture.md#ADR-P3-D7] — phase3 schema, license tables
- [Source: architecture.md#ADR-P3-D9] — backend extend FastAPI
- [Source: architecture.md#G-4] — HWID algorithm explicit
- [Source: prd-phase3.md#FR5] — activate license HWID bind
- [Source: _bmad-output/project-context.md] — backend Python conventions (absolute import, service layer, Alembic, try-except external)
- [Source: automation-desktop/CLAUDE.md] — 25 client rules
- [Source: automation-desktop/project-context.md] — Phase 3 client conventions
- [Source: automation-desktop/src/main/adapters/electron-safe-storage.ts] — safeStorage stub cần impl
- [Source: backend/app/api/deps.py] — RBAC pattern cho admin endpoint (Story 1.5)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-02: Backend targeted regression `cd backend && .venv/bin/pytest tests/test_storage_cleanup.py tests/test_automation_license.py -q` -> `19 passed`.
- 2026-06-02: Backend full regression `cd backend && .venv/bin/pytest -q` -> `303 passed`.
- 2026-06-02: Desktop `cd automation-desktop && npm run typecheck` -> pass.
- 2026-06-02: Desktop `cd automation-desktop && npm run lint` -> pass (Node module-type warning only).
- 2026-06-02: Desktop targeted Playwright `npx playwright test tests/unit/hwid-generator.spec.ts tests/integration/safe-storage.spec.ts tests/integration/license-ipc-handlers.spec.ts tests/e2e/license.spec.ts` -> `8 passed`.
- 2026-06-02: Desktop `cd automation-desktop && npm run postinstall` -> electron rebuild completed.
- 2026-06-02: Desktop `cd automation-desktop && npm run build` -> pass.
- 2026-06-02: Desktop `cd automation-desktop && npm run test:automation` -> `26 passed`.
- 2026-06-02: Desktop `cd automation-desktop && npm run test:e2e:p0` -> first exposed E2E safeStorage/userData state leak, fixed by isolating `PHASE3_USER_DATA_PATH`, rerun -> `5 passed`.

### Completion Notes List

- Implemented Phase 3 backend license schema with Alembic migration, SQLAlchemy models, Pydantic request/response schemas, HWID validation, and service-layer activation logic.
- Added `/api/v1/automation/license/activate` with Vietnamese domain errors for missing, revoked, invalid HWID, and HWID mismatch/rebind guidance.
- Implemented Electron HWID generation using `node-machine-id`, OS MAC, CPU brand, and SHA-256 deterministic hashing.
- Replaced safeStorage stub with real Electron `safeStorage` encryption/decryption persisted to a per-user encrypted blob file; `activation_id` stays private and is never returned raw to renderer.
- Added typed Zod IPC channels `phase3:license:activate` and `phase3:license:status`, plus renderer API wrapper and LicenseView activation UI.
- Integrated gate flow: EULA accepted -> license status check -> `LicenseView` if inactive -> `MainShell` with remaining days if active.
- Added backend, unit, integration, and E2E coverage for activation success, HWID mismatch, revoked/missing keys, HWID determinism, safeStorage round-trip, IPC envelopes, and P0 license/EULA flows.
- Fixed backend SQLite test infrastructure to attach the `phase3` schema for independent in-memory engines and clean up the phase3 sidecar test database.
- Moved HWID smoke override into Electron bootstrap with `app.isPackaged` guard and isolated E2E `userData` paths to prevent safeStorage state leakage between tests.

### File List

- `_bmad-output/implementation-artifacts/1-3-activate-license-voi-hwid-binding.md`
- `_bmad-output/implementation-artifacts/sprint-status-phase3.yaml`
- `automation-desktop/package-lock.json`
- `automation-desktop/package.json`
- `automation-desktop/src/main/adapters/electron-bootstrap.ts`
- `automation-desktop/src/main/adapters/electron-safe-storage.ts`
- `automation-desktop/src/main/ipc/index.ts`
- `automation-desktop/src/main/ipc/license-handlers.ts`
- `automation-desktop/src/main/license/hwid-generator.ts`
- `automation-desktop/src/main/license/license-service.ts`
- `automation-desktop/src/renderer/src/App.tsx`
- `automation-desktop/src/renderer/src/api/license-api.ts`
- `automation-desktop/src/renderer/src/assets/main.css`
- `automation-desktop/src/renderer/src/views/LicenseView.tsx`
- `automation-desktop/src/shared/ipc-schemas/index.ts`
- `automation-desktop/src/shared/ipc-schemas/license.ts`
- `automation-desktop/tests/e2e/eula.spec.ts`
- `automation-desktop/tests/e2e/license.spec.ts`
- `automation-desktop/tests/integration/license-ipc-handlers.spec.ts`
- `automation-desktop/tests/integration/safe-storage.spec.ts`
- `automation-desktop/tests/unit/adapter-stubs.spec.ts`
- `automation-desktop/tests/unit/hwid-generator.spec.ts`
- `backend/alembic/env.py`
- `backend/alembic/versions/20260602_01_phase3_license_init.py`
- `backend/app/api/automation.py`
- `backend/app/core/database.py`
- `backend/app/main.py`
- `backend/app/models/automation/__init__.py`
- `backend/app/models/automation/license.py`
- `backend/app/schemas/automation/__init__.py`
- `backend/app/schemas/automation/license.py`
- `backend/app/services/automation/__init__.py`
- `backend/app/services/automation/hwid.py`
- `backend/app/services/automation/license.py`
- `backend/tests/conftest.py`
- `backend/tests/test_automation_license.py`
- `backend/tests/test_storage_cleanup.py`

### Change Log

- 2026-06-02: Implemented Story 1.3 license activation with HWID binding across backend and Electron client; added migration, models, service/router, safeStorage, IPC, LicenseView, gate flow, and tests.
- 2026-06-02: Fixed validation blockers: backend SQLite `phase3` schema attach for independent tests, safeStorage encrypted blob storage lint issue, guarded HWID smoke override, and E2E userData isolation.
