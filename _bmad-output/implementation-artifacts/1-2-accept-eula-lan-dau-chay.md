# Story 1.2: Accept EULA lần đầu chạy

Status: review

<!-- Phase 3 story. Sources: prd-phase3.md, architecture.md § Phase 3 Addendum, epics-phase3.md. Previous: 1.1 (done) -->

## Story

As a user,
I want được hiển thị EULA và phải accept trước khi dùng app,
so that tôi hiểu rủi ro FB ToS và trách nhiệm của mình (tool vendor model), và app chỉ kích hoạt telemetry sau khi tôi đồng ý.

## Acceptance Criteria

1. **First-run gate**: Khi app khởi động và `local_settings.eula_accepted_version` < EULA version hiện tại (hoặc chưa tồn tại) → hiển thị `EulaAcceptanceView`, user KHÔNG thể sang view khác cho đến khi accept.
2. **Nội dung EULA**: `EulaAcceptanceView` hiển thị nội dung EULA tiếng Việt (acknowledge rủi ro FB ToS, tool vendor model, user là operator) + link privacy policy (mở external qua `shell.openExternal`).
3. **Accept persistence**: Khi user accept → lưu `eula_accepted_version` = version hiện tại vào bảng `local_settings` (SQLCipher), thông qua kênh IPC typed.
4. **Telemetry feature-gate**: Sau khi accept, set flag `telemetry_enabled = true` trong `local_settings` (NFR21). KHÔNG implement beacon emitter (đó là Epic 6 Story 6.1) — chỉ set feature-gate flag để 6.1 đọc về sau.
5. **Không hiện lại**: Lần khởi động sau, nếu `eula_accepted_version` >= EULA version hiện tại → KHÔNG hiện EULA, vào thẳng main shell.
6. **EULA version bump**: Nếu EULA version tăng (constant trong code) > version đã accept → hiện lại EULA yêu cầu re-accept.
7. **IPC channel thật đầu tiên**: Wire kênh IPC end-to-end `phase3:settings:get` + `phase3:settings:set` (thay stub `throw 'not implemented in Story 1.1'`) với Zod schema validation 2 chiều, channel đăng ký vào `channelRegistry`.

## Tasks / Subtasks

- [x] **Task 1: Bảng local_settings + repository** (AC: #3, #4)
  - [x] Tạo client SQLite migration/init: bảng `local_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)` trong DB mã hóa (dùng `openEncryptedDatabase` đã có ở `src/main/db/client.ts`)
  - [x] `src/main/db/repositories/settings-repo.ts`: `getSetting(key)`, `setSetting(key, value)` (kebab file, không churn `__smoke`)
  - [x] Lưu ý: DB key vẫn dùng temp key (`phase3-story-1-1-temp-key`) — key thật từ safeStorage là Story 1.3, KHÔNG wire ở story này
- [x] **Task 2: IPC channel settings (kênh thật đầu tiên)** (AC: #7)
  - [x] `src/shared/ipc-schemas/settings.ts`: Zod `SettingsGetRequestSchema/ResponseSchema`, `SettingsSetRequestSchema/ResponseSchema` (zod@4 đã install)
  - [x] Đăng ký 2 channel vào `channelRegistry` (`src/shared/ipc-schemas/index.ts` hiện rỗng `[]`)
  - [x] `src/main/ipc/settings-handlers.ts`: `ipcMain.handle('phase3:settings:get'|'set', ...)` — Zod parse request + response, wrap lỗi `ErrorEnvelope`
  - [x] Wire handler vào bootstrap (init order: db → adapters → **services → ipc** → window)
  - [x] Thay stub trong `src/preload/index.ts`: `window.api.ipc.call` gọi `ipcRenderer.invoke` thật + validate
  - [x] `src/renderer/src/api/settings-api.ts`: wrapper gọi `window.api.ipc.call('phase3:settings:get'|'set', ...)`
- [x] **Task 3: EULA gate trong bootstrap** (AC: #1, #5, #6)
  - [x] Constant `EULA_VERSION` (số nguyên tăng dần) trong `src/shared/` hoặc `src/main/`
  - [x] Trong `electron-bootstrap.ts`: sau init db, đọc `eula_accepted_version` từ settings-repo; truyền trạng thái cần-accept xuống renderer (qua initial IPC hoặc query khi renderer mount)
  - [x] Renderer: khi mount, gọi `settings-api.get('eula_accepted_version')`; nếu `< EULA_VERSION` → render `EulaAcceptanceView`, chặn main shell
- [x] **Task 4: EulaAcceptanceView (renderer)** (AC: #2, #3)
  - [x] `src/renderer/src/views/EulaAcceptanceView.tsx`: nội dung EULA tiếng Việt + checkbox "Tôi đồng ý" + nút Accept (disabled đến khi tick) + link privacy policy
  - [x] Link privacy policy mở external (qua IPC channel hoặc `window.electron` shell) — KHÔNG mở trong renderer (CSP + security)
  - [x] On Accept → `settings-api.set('eula_accepted_version', EULA_VERSION)` + `settings-api.set('telemetry_enabled', 'true')`
  - [x] Thay App.tsx boilerplate: gate EulaAcceptanceView vs main shell placeholder
- [x] **Task 5: Tests** (AC: tất cả)
  - [x] Integration test: settings-repo get/set trên DB mã hóa (KHÔNG `test.fixme` — bài học review 1.1)
  - [x] Integration test: IPC settings round-trip với Zod validation (reject payload sai schema)
  - [x] E2E `@playwright/test`: first-run hiện EULA → accept → restart không hiện lại; verify telemetry_enabled flag set
  - [x] `npm run lint` + `typecheck` + test PASS (lint gate phải xanh trên file test mới — bài học review 1.1)

## Dev Notes

### Bối cảnh & previous story intelligence (Story 1.1 — done)
Story 1.1 đã scaffold `automation-desktop/` với security baseline, adapter layer, SQLCipher init, IPC contract skeleton. **Story 1.2 là story đầu tiên wire IPC THẬT** + UI thật. Học từ 1.1:
- ⚠️ **IPC bridge hiện là STUB**: `src/preload/index.ts` có `window.api.ipc.call` → `throw new Error('IPC bridge not implemented in Story 1.1')`. Story 1.2 PHẢI thay bằng impl thật (ipcRenderer.invoke). Đây là implicit requirement để app hoạt động end-to-end.
- ⚠️ `channelRegistry` ở `src/shared/ipc-schemas/index.ts` hiện rỗng `[]` — đăng ký channel mới vào đây.
- ⚠️ `src/main/ipc/index.ts` hiện `export {}` — wire handler thật.
- ⚠️ DB client `openEncryptedDatabase` (`src/main/db/client.ts`) dùng key TEMP hardcode `'phase3-story-1-1-temp-key'` trong `electron-bootstrap.ts`. Story 1.2 GIỮ NGUYÊN temp key (key thật từ safeStorage là Story 1.3). KHÔNG đổi.
- ⚠️ Renderer hiện là boilerplate `App.tsx` dùng `window.electron.ipcRenderer.send('ping')`. Chuyển sang typed `window.api`.

### Bài học từ code review Story 1.1 (TRÁNH lặp lại)
- Lint phải PASS cả trên file test mới (review 1.1 từng fail lint trên test files → AC#5 không đạt).
- KHÔNG `test.fixme` cho task đã tick "verify" (review 1.1 từng tick verify DB nhưng test fixme).
- CI desktop job phải nằm ở **root** `.github/workflows/ci.yml` (Story 1.1 đã thêm desktop job ở root — extend job đó, KHÔNG tạo workflow trong `automation-desktop/.github`).
- ESLint `no-restricted-imports` đã enforce cấm `electron` ngoài adapter/preload — code mới phải tuân thủ.

### Scope rõ ràng — KHÔNG làm
- KHÔNG implement telemetry beacon emitter (Epic 6 Story 6.1) — chỉ set flag `telemetry_enabled`.
- KHÔNG wire safeStorage master key cho DB (Story 1.3).
- KHÔNG implement license activation (Story 1.3).
- KHÔNG build các view khác (Profiles/License/Settings) — chỉ EULA gate + main shell placeholder.

### Architecture compliance
- **IPC pattern (ADR-P3-D8)**: channel `phase3:<domain>:<verb>` kebab; Zod parse 2 chiều; error luôn `ErrorEnvelope` (`src/shared/types/error-envelope.ts` đã có). [Source: architecture.md#ADR-P3-D8, #Phase-3-Implementation-Patterns]
- **Secret marker**: `eula_accepted_version` + `telemetry_enabled` KHÔNG phải secret → lưu `local_settings` SQLite, KHÔNG dùng `Secret<T>`/safeStorage. [Source: architecture.md#R-D3]
- **Client SQLite naming**: bảng state-only client prefix `local_` (đúng convention `local_settings`). [Source: architecture.md#Implementation-Patterns Naming]
- **EULA gate (G-2 gap resolution)**: bootstrap check `local_settings.eula_accepted_version`; mandatory beacon CHỈ kích hoạt sau accept. [Source: architecture.md#G-2 EULA Acceptance Flow]
- **Renderer security**: sandbox:true + contextIsolation đã set ở 1.1 → renderer chỉ giao tiếp qua `window.api` (preload bridge), KHÔNG Node API trực tiếp. Link external qua shell, không `<a href>` thường trong CSP strict.

### Library versions (đã install ở 1.1)
- `zod@^4.4.3` — dùng cho schema. Lưu ý zod v4 API (z.object, z.infer).
- `better-sqlite3-multiple-ciphers@^12.10.0` — DB mã hóa.
- React 19 + TypeScript strict + electron-vite.

### File structure (story này touch)
- NEW: `src/shared/ipc-schemas/settings.ts`, `src/main/db/repositories/settings-repo.ts`, `src/main/ipc/settings-handlers.ts`, `src/renderer/src/views/EulaAcceptanceView.tsx`, `src/renderer/src/api/settings-api.ts`, `src/shared/eula-version.ts` (hoặc tương đương)
- UPDATE: `src/shared/ipc-schemas/index.ts` (đăng ký channel), `src/main/ipc/index.ts` (wire handler), `src/main/adapters/electron-bootstrap.ts` (EULA check + ipc wiring vào init order), `src/preload/index.ts` (impl IPC bridge thật), `src/renderer/src/App.tsx` (gate)
- Privacy policy: EULA + privacy policy content là tiếng Việt (NFR28). Nội dung legal chính thức là pending business action — story này dùng placeholder content rõ ràng đánh dấu "DRAFT — cần legal review", KHÔNG block dev.

### Testing standards
- `@playwright/test` cho E2E (electron namespace) + integration. Coverage business logic ≥70% (NFR26) — settings-repo + IPC handler cần test.
- Pattern test đã có ở `tests/` từ 1.1 (support/fixtures/helpers) — reuse.

### References

- [Source: epics-phase3.md#Epic-1 Story-1.2]
- [Source: architecture.md#G-2-EULA-Acceptance-Flow] — first-run flow, local_settings, beacon gate sau accept
- [Source: architecture.md#ADR-P3-D8] — IPC typed + Zod
- [Source: architecture.md#ADR-P3-D3, #ADR-P3-D7] — SQLCipher, local SQLite schema
- [Source: architecture.md#R-D3] — secret marker (EULA flag KHÔNG phải secret)
- [Source: prd-phase3.md#FR36, #FR37] — EULA accept, privacy policy
- [Source: prd-phase3.md#NFR21, #NFR28] — beacon gate sau EULA, VN lock
- [Source: 1-1-khoi-tao-scaffold-automation-desktop.md#File-List] — established patterns + IPC stub cần thay
- [Source: automation-desktop/src/preload/index.ts] — IPC bridge stub hiện tại
- [Source: automation-desktop/src/main/adapters/electron-bootstrap.ts] — bootstrap hook point + temp DB key
- [Source: automation-desktop/src/main/db/client.ts] — openEncryptedDatabase pattern

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Implementation Plan

- RED: added repository, IPC/schema, EULA version, and first-run E2E tests before implementation.
- GREEN: implemented SQLCipher `local_settings`, typed settings IPC, secure shell external IPC, preload bridge, and renderer EULA gate.
- REFACTOR: bundled preload dependencies for sandbox compatibility and formatted targeted files.

### Debug Log References

- `npx playwright test tests/integration/settings-repo.spec.ts tests/integration/settings-ipc-handlers.spec.ts` — PASS (5 tests)
- `npx playwright test tests/unit/ipc-contracts.spec.ts tests/unit/eula-version.spec.ts` — PASS (6 tests)
- `npx playwright test tests/e2e/eula.spec.ts` — PASS (1 test)
- `npm run lint` — PASS (existing module-type warning only)
- `npm run build` — PASS (includes `npm run typecheck`)
- `npm run test:automation` — PASS (21 tests)
- `npm run postinstall` — PASS (native rebuild complete)
- `npm run test:e2e:p0` — PASS after postinstall (2 tests)

### Completion Notes List

- Added encrypted `local_settings` table initialization and a kebab-file settings repository with upsert get/set behavior, preserving the Story 1.1 `__smoke` path and temp DB key.
- Replaced renderer IPC stub with real `ipcRenderer.invoke` bridge and Zod request/response validation against `channelRegistry`; registered `phase3:settings:get`, `phase3:settings:set`, and supporting `phase3:shell:open-external` for privacy policy external opening.
- Added Vietnamese draft EULA gate with mandatory checkbox, disabled accept button until consent, `eula_accepted_version` persistence, and `telemetry_enabled=true` feature-gate flag only after accept.
- Added EULA version comparison helper and tests for missing/lower/equal/higher versions, including version-bump behavior.
- Fixed sandbox preload compatibility by removing runtime dependency on `@electron-toolkit/preload` and bundling preload dependencies via `externalizeDeps: false` so Zod validation works in sandbox.
- Synced Phase 3 sprint status for Story 1.2 to `review`.

### File List

- `_bmad-output/implementation-artifacts/1-2-accept-eula-lan-dau-chay.md`
- `_bmad-output/implementation-artifacts/sprint-status-phase3.yaml`
- `automation-desktop/electron.vite.config.ts`
- `automation-desktop/src/main/adapters/electron-bootstrap.ts`
- `automation-desktop/src/main/db/client.ts`
- `automation-desktop/src/main/db/repositories/settings-repo.ts`
- `automation-desktop/src/main/ipc/index.ts`
- `automation-desktop/src/main/ipc/settings-handlers.ts`
- `automation-desktop/src/main/ipc/shell-handlers.ts`
- `automation-desktop/src/preload/index.ts`
- `automation-desktop/src/preload/index.d.ts`
- `automation-desktop/src/renderer/src/App.tsx`
- `automation-desktop/src/renderer/src/assets/main.css`
- `automation-desktop/src/renderer/src/api/settings-api.ts`
- `automation-desktop/src/renderer/src/views/EulaAcceptanceView.tsx`
- `automation-desktop/src/shared/eula-version.ts`
- `automation-desktop/src/shared/ipc-schemas/common.ts`
- `automation-desktop/src/shared/ipc-schemas/index.ts`
- `automation-desktop/src/shared/ipc-schemas/settings.ts`
- `automation-desktop/src/shared/ipc-schemas/shell.ts`
- `automation-desktop/tests/e2e/eula.spec.ts`
- `automation-desktop/tests/integration/settings-ipc-handlers.spec.ts`
- `automation-desktop/tests/integration/settings-repo.spec.ts`
- `automation-desktop/tests/unit/eula-version.spec.ts`
- `automation-desktop/tests/unit/ipc-contracts.spec.ts`

### Change Log

- 2026-06-02: Implemented Story 1.2 first-run EULA acceptance gate, typed settings IPC, encrypted local settings persistence, telemetry consent flag, privacy external IPC, and test coverage.
