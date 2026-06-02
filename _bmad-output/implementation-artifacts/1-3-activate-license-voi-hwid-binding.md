# Story 1.3: Activate license với HWID binding

Status: done

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
9. **Backend test trung thực với production (PostgreSQL)**: Backend test Phase 3 PHẢI chạy trên PostgreSQL thật (testcontainers HOẶC PG test DB từ docker-compose), chạy **Alembic migration thật** (`alembic upgrade head`) thay vì `Base.metadata.create_all`. KHÔNG dùng SQLite cho Phase 3 backend test. KHÔNG nhồi SQLite ATTACH logic vào production `app/core/database.py`.

## Review Findings (post-dev — DB test fidelity)

> Live API smoke 2026-06-02 trên PostgreSQL thật + Alembic migration thật: 5/5 path PASS (activate/idempotent/mismatch/revoked/not-found, error có retryable + tiếng Việt). Logic dev ĐÚNG. Nhưng backend test setup KHÔNG trung thực:

- [x] [Review][Patch][Critical] Production `app/core/database.py` bị nhồi test-only SQLite ATTACH logic (`_attach_phase3_schema`, `_phase3_sqlite_path`) chỉ để test pass. Xóa khỏi production; test fidelity phải đạt qua test infra, không qua production hook [`backend/app/core/database.py`:19-33]
- [x] [Review][Patch][Critical] Backend Phase 3 test dùng SQLite + `Base.metadata.create_all` → migration `20260602_01_phase3_license_init` (CREATE SCHEMA, server_default, FK) KHÔNG bao giờ được test. Đổi sang PostgreSQL thật + `alembic upgrade head` [`backend/tests/conftest.py`:10]
- [x] [Review][Patch][Major] SQLite ATTACH = 2 file DB riêng, FK cross-schema (`phase3.licenses` ← `users.id`) KHÔNG enforce → test FK constraint không catch lỗi thật [`backend/tests/test_automation_license.py`]
- [x] [Review][Patch][Major] Test có nhánh `if bind.dialect.name == "sqlite"` → code smell, adapt theo engine thay vì test production behavior. Xóa nhánh sqlite [`backend/tests/test_automation_license.py`:27]

## Re-review Verdict (2026-06-02) — ✅ TẤT CẢ 21 PATCH RESOLVED → DONE

> Re-review sau dev apply 21 patch (commit `b1e81ac`). Verify từng patch + chạy test:
> - **13 automation test PASS** trên PostgreSQL thật (testcontainers/PG + Alembic upgrade head)
> - Client typecheck + lint clean
> - Phase 1+2 test 13 PASS (SQLite, no regression sau khi xóa ATTACH)
> - Coverage mới: rate-limit 429, cross-schema FK enforce, license-service renew/timeout/rollback/invalid-shape, hwid deterministic + virtual-interface filter
> Story 1.3 → **done**. Foundation sạch cho 1.4.

## Review Findings (full code review 2026-06-02)

> 3-layer adversarial (Blind + Edge + Auditor) sau khi dev fix test fidelity. Findings edge cases + 1 rule-violation tái phát. **→ Tất cả 21 đã resolved + có test (xem verdict trên).**

### Decision resolved → patch

- [x] [Review][Patch] Endpoint `/api/v1/automation/license/activate` public (đúng ADR-D2 desktop self-activate) NHƯNG thiếu rate-limit → brute-force license key. **Quyết (Luisphan): thêm rate-limit ngay story này** — per-IP + per-key throttle (vd slowapi hoặc middleware đếm theo Redis/in-memory) [`backend/app/api/automation.py`, `backend/app/main.py`]

### Major (patch)

- [x] [Review][Patch] `fetch()` trong license-service KHÔNG timeout → backend treo thì IPC hang vĩnh viễn, UI kẹt `activating=true`. Thêm `AbortSignal.timeout()` [`automation-desktop/src/main/license/license-service.ts`]
- [x] [Review][Patch] `safeStorage` adapter: `readStore()` JSON.parse + `decryptString()` + `writeStore()` KHÔNG try/catch + write không atomic → file corrupt/keychain re-lock → crash `getStatus()`, lock user khỏi app. Wrap try/catch + atomic write (temp+rename) + fallback {} [`automation-desktop/src/main/adapters/electron-safe-storage.ts`]
- [x] [Review][Patch] License persist non-atomic: settings(expires/rebind) commit trước, `storage.set(activation_id)` fail sau → user kẹt vĩnh viễn (`active:false`, retry overwrite). Persist activation_id trước hoặc rollback [`automation-desktop/src/main/license/license-service.ts`]
- [x] [Review][Patch] `days_total <= 0` không validate → `expires_at == activated_at` → `active:false` im lặng, user kẹt không message. Validate `days_total > 0` (schema + migration CHECK) [`backend/app/services/automation/license.py`, migration]
- [x] [Review][Patch] Race concurrent activate cùng key khác HWID: không `SELECT FOR UPDATE`/unique constraint trên `license_activations(license_id)` → 2 INSERT thành công. Thêm unique constraint + handle [`backend/app/services/automation/license.py`, migration]
- [x] [Review][Patch] `license-handlers.ts` parse error qua `error.message.split('|')` (format `code|message|retryable`) — fragile, message tiếng Việt chứa `|` vỡ. Dùng typed `LicenseServiceError` thay string split [`automation-desktop/src/main/ipc/license-handlers.ts`]
- [x] [Review][Patch] HWID instability: `firstMacAddress()` lấy MAC non-internal đầu tiên theo thứ tự không deterministic → docker0/VPN (utun) xuất hiện đổi HWID → false `LICENSE_HWID_MISMATCH` cùng máy → user lock out. Lọc virtual interface / sort deterministic / ưu tiên physical [`automation-desktop/src/main/license/hwid-generator.ts`]
- [x] [Review][Patch] `machineId()` không try/catch → Linux sandbox (snap/flatpak)/container không có `/etc/machine-id` → `generateHwid()` throw trước khi gọi backend. Fallback graceful [`automation-desktop/src/main/license/hwid-generator.ts`]
- [x] [Review][Patch] Backend HTTP response chỉ `as BackendActivationResponse` cast, không Zod-validate → thiếu field → `storage.set(activation_id, undefined)` lưu `"undefined"`. Validate response schema trước khi lưu [`automation-desktop/src/main/license/license-service.ts`]
- [x] [Review][Patch] `LicenseActivationError(@dataclass(frozen=True), Exception)` → dataclass `__init__` không gọi `Exception.__init__` → `str(exc)` rỗng, `exc.args` rỗng → Sentry/uvicorn log message rỗng. Gọi `super().__init__(message)` [`backend/app/services/automation/license.py`:15]
- [x] [Review][Patch] Idempotent re-activate sau khi expire trả `expires_at` CŨ (đã qua), không renew. AC2 nói compute now+days. Nếu existing đã expired → tạo activation mới / renew [`backend/app/services/automation/license.py`:55-64]
- [x] [Review][Patch] **Rule violation tái phát**: `test_storage_cleanup.py:24-26` thêm `ATTACH DATABASE ':memory:' AS phase3` — đúng pattern rule cấm. test_storage_cleanup không import phase3 models → ATTACH thừa. Xóa [`backend/tests/test_storage_cleanup.py`:24]
- [x] [Review][Patch] Cross-schema FK (`phase3.licenses.created_by_admin → public.users.id`) KHÔNG có test — prior Finding #3 chỉ test intra-phase3 FK. Thêm test verify cross-schema FK enforce [`backend/tests/automation/test_automation_license.py`]
- [x] [Review][Patch] `_reset_postgres_database` DROP `public` schema, guard chỉ check tên DB chứa 'test'/'phase3' → `prod-host:5432/medirus_test` qua được + wipe Phase 1+2. Guard mạnh hơn (chỉ drop phase3, hoặc check host) [`backend/tests/automation/conftest.py`:36-40]
- [x] [Review][Patch] `App.tsx handleActivate` không catch → lỗi propagate; App-level error state không set khi status inactive (im lặng). Catch + set error rõ ràng [`automation-desktop/src/renderer/src/App.tsx`]

### Minor (patch)

- [x] [Review][Patch] `z.string().datetime()` (license.ts:6) strict Z-suffix. Backend hiện trả `Z` (live-verified OK) nhưng fragile nếu đổi sang `+00:00`. Dùng `.datetime({ offset: true })` [`automation-desktop/src/shared/ipc-schemas/license.ts`:6]
- [x] [Review][Patch] FK `created_by_admin → users.id` không schema-qualify → dựa search_path. Dùng `public.users.id` explicit [`backend/alembic/versions/20260602_01_phase3_license_init.py`, model]
- [x] [Review][Patch] Migration `SET search_path` không `RESET` cuối upgrade → leak sang pooled connection / migration sau [`backend/alembic/versions/20260602_01_phase3_license_init.py`:20]
- [x] [Review][Patch] Downgrade `DROP SCHEMA phase3` không guard → dùng RESTRICT để fail-early nếu có object Phase 3.x khác [`backend/alembic/versions/20260602_01_phase3_license_init.py`]
- [x] [Review][Patch] `shared/api-client/http-client.ts` không tạo (task tick nhưng inline fetch). Extract để Epic 8 cert-pinning reuse được [`automation-desktop/src/main/license/license-service.ts`]

### Dismissed (noise)

- `activation_id` trả về client — by design là bearer token, không phải leak
- `TRUNCATE RESTART IDENTITY` trên UUID PK — PG xử lý OK
- `clean_phase3_tables` fixture ordering — work qua dependency chain
- CI smoke license gate — smoke chỉ check title, không vào gate

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

- 2026-06-02: Backend targeted regression before review patch `cd backend && .venv/bin/pytest tests/test_storage_cleanup.py tests/test_automation_license.py -q` -> `19 passed`.
- 2026-06-02: Backend full regression before review patch `cd backend && .venv/bin/pytest -q` -> `303 passed`.
- 2026-06-02: Desktop `cd automation-desktop && npm run typecheck` -> pass.
- 2026-06-02: Desktop `cd automation-desktop && npm run lint` -> pass (Node module-type warning only).
- 2026-06-02: Desktop targeted Playwright `npx playwright test tests/unit/hwid-generator.spec.ts tests/integration/safe-storage.spec.ts tests/integration/license-ipc-handlers.spec.ts tests/e2e/license.spec.ts` -> `8 passed`.
- 2026-06-02: Desktop `cd automation-desktop && npm run postinstall` -> electron rebuild completed.
- 2026-06-02: Desktop `cd automation-desktop && npm run build` -> pass.
- 2026-06-02: Desktop `cd automation-desktop && npm run test:automation` -> `26 passed`.
- 2026-06-02: Desktop `cd automation-desktop && npm run test:e2e:p0` -> first exposed E2E safeStorage/userData state leak, fixed by isolating `PHASE3_USER_DATA_PATH`, rerun -> `5 passed`.
- 2026-06-02: Review patch automation PG smoke with Docker Postgres: `python -m alembic upgrade head` then `python -m pytest -q tests/automation` -> `7 passed` on PostgreSQL + Alembic migrations.
- 2026-06-02: Review patch root command smoke with Docker Postgres: `PYTHONPATH=backend python -m pytest -q backend/tests/automation` -> `7 passed`.
- 2026-06-02: Review patch legacy backend regression `cd backend && .venv/bin/python -m pytest -q` -> `297 passed, 7 skipped` (automation PG tests intentionally skipped in default SQLite suite).
- 2026-06-02: Edge/resilience patch backend compile `cd backend && .venv/bin/python -m compileall app tests/automation` -> pass.
- 2026-06-02: Edge/resilience patch storage cleanup regression `cd backend && .venv/bin/python -m pytest -q tests/test_storage_cleanup.py` -> `13 passed`.
- 2026-06-02: Edge/resilience patch automation PG smoke with Docker Postgres + Alembic -> `13 passed, 4 warnings` on PostgreSQL.
- 2026-06-02: Edge/resilience patch backend full regression `cd backend && .venv/bin/python -m pytest -q` -> `297 passed, 13 skipped` (automation PG skipped by default SQLite suite).
- 2026-06-02: Desktop targeted resilience suite `npx playwright test tests/unit/hwid-generator.spec.ts tests/unit/license-service.spec.ts tests/integration/license-ipc-handlers.spec.ts tests/integration/safe-storage.spec.ts` -> `13 passed`.
- 2026-06-02: Desktop final gate `npm run build && npm run lint && npm run test:automation && npm run test:e2e:p0` -> build/typecheck pass, lint pass, `33 passed`, P0 E2E `5 passed`.
- 2026-06-02: Live API smoke by curl on uvicorn + Docker PostgreSQL + Alembic -> 5/5 PASS: activate success 200, idempotent 200, HWID mismatch 409, revoked 403, not-found 404; error envelopes include `retryable` + Vietnamese message.

### Completion Notes List

- Implemented Phase 3 backend license schema with Alembic migration, SQLAlchemy models, Pydantic request/response schemas, HWID validation, and service-layer activation logic.
- Added `/api/v1/automation/license/activate` with Vietnamese domain errors for missing, revoked, invalid HWID, and HWID mismatch/rebind guidance.
- Implemented Electron HWID generation using `node-machine-id`, OS MAC, CPU brand, and SHA-256 deterministic hashing.
- Replaced safeStorage stub with real Electron `safeStorage` encryption/decryption persisted to a per-user encrypted blob file; `activation_id` stays private and is never returned raw to renderer.
- Added typed Zod IPC channels `phase3:license:activate` and `phase3:license:status`, plus renderer API wrapper and LicenseView activation UI.
- Integrated gate flow: EULA accepted -> license status check -> `LicenseView` if inactive -> `MainShell` with remaining days if active.
- Added backend, unit, integration, and E2E coverage for activation success, HWID mismatch, revoked/missing keys, HWID determinism, safeStorage round-trip, IPC envelopes, P0 license/EULA flows, and PostgreSQL FK enforcement.
- Removed Phase 3 SQLite ATTACH test pollution from production database setup and moved automation license tests to PostgreSQL + Alembic migration infrastructure.
- Moved HWID smoke override into Electron bootstrap with `app.isPackaged` guard and isolated E2E `userData` paths to prevent safeStorage state leakage between tests.
- Added activation rate limiting per IP and per license key with deterministic test reset fixture.
- Hardened backend license activation against invalid `days_total`, concurrent activate races, expired same-HWID renewal, and blank exception logs.
- Added migration constraints for positive license duration, one activation per license, explicit DB-level `public.users` FK, `RESET search_path`, and restrictive downgrade.
- Hardened desktop activation HTTP with timeout, backend response Zod validation, typed backend errors, and safe rollback when public settings persist fails after private activation storage.
- Hardened `ElectronSafeStorage` against corrupt JSON, decrypt failures, unavailable encryption, and non-atomic writes.
- Stabilized HWID generation by filtering virtual network interfaces, sorting MAC candidates deterministically, and falling back when `machineId()` fails.
- Removed fragile pipe-split IPC error parsing in favor of typed `LicenseServiceError`.
- Fixed license mismatch UI duplicate error rendering so one Vietnamese rebind message is visible and strict E2E locators pass.
- Note: Alembic migration is the production source of truth for `phase3.licenses.created_by_admin -> public.users.id`; ORM model uses metadata-resolvable `users.id` while automation tests assert the real PostgreSQL cross-schema FK via raw SQL.

### File List

- `.github/workflows/ci.yml`
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
- `automation-desktop/src/shared/api-client/http-client.ts`
- `automation-desktop/tests/e2e/eula.spec.ts`
- `automation-desktop/tests/e2e/license.spec.ts`
- `automation-desktop/tests/integration/license-ipc-handlers.spec.ts`
- `automation-desktop/tests/integration/safe-storage.spec.ts`
- `automation-desktop/tests/unit/adapter-stubs.spec.ts`
- `automation-desktop/tests/unit/hwid-generator.spec.ts`
- `automation-desktop/tests/unit/license-service.spec.ts`
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
- `backend/pytest.ini`
- `backend/requirements-dev.txt`
- `backend/tests/automation/conftest.py`
- `backend/tests/automation/test_automation_license.py`
- `backend/tests/conftest.py`
- `backend/tests/test_storage_cleanup.py`

### Change Log

- 2026-06-02: Implemented Story 1.3 license activation with HWID binding across backend and Electron client; added migration, models, service/router, safeStorage, IPC, LicenseView, gate flow, and tests.
- 2026-06-02: Fixed validation blockers: backend SQLite `phase3` schema attach for independent tests, safeStorage encrypted blob storage lint issue, guarded HWID smoke override, and E2E userData isolation.
- 2026-06-02: Review patch moved Phase 3 backend automation tests to PostgreSQL + Alembic migration setup, removed production SQLite ATTACH pollution, added FK enforcement coverage, and added CI Postgres service job.
