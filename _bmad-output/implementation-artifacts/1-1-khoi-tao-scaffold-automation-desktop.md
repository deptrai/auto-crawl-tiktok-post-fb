# Story 1.1: Khởi tạo scaffold automation-desktop

Status: done

<!-- Phase 3 story. Sources: prd-phase3.md, architecture.md § Phase 3 Addendum, epics-phase3.md -->

## Story

As a developer,
I want một Electron desktop app shell chạy được ở dev mode với security baseline và adapter layer,
so that mọi feature Phase 3 sau (license, profile, automation) có nền tảng nhất quán, an toàn, và AI-agent-friendly để build.

## Acceptance Criteria

1. **Scaffold khởi tạo**: Chạy `npm create @quick-start/electron@latest automation-desktop -- --template react-ts` tạo thư mục `automation-desktop/` ở root mono-repo, app khởi động dev mode với Vite HMR hoạt động trên cả 3 layer (main/preload/renderer).
2. **Folder restructure**: Cấu trúc thư mục theo layout: `src/adapters/` + `src/main/` + `src/preload/` + `src/renderer/` + `src/shared/` (đúng architecture § Folder Structure).
3. **Security baseline**: Mọi `BrowserWindow` áp dụng `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, CSP headers strict (NFR11).
4. **Adapter interfaces (R-D16)**: 4 interface (`ipc`, `secure-storage`, `updater`, `window`) trong `src/adapters/` + Electron stub impl trong `src/main/adapters/`. Business logic KHÔNG import `electron` trực tiếp.
5. **ESLint custom rules**: Wire Flat Config v9 với rules: `no-restricted-imports` (cấm `electron` ngoài `adapters/`+`preload/`), `no-secret-in-ipc-payload`, `no-secret-tostring`, `no-direct-logger`. Lint chạy pass trên scaffold.
6. **SQLCipher init**: `src/main/db/client.ts` khởi tạo được DB mã hóa qua `better-sqlite3-multiple-ciphers`, native module rebuild thành công (electron-rebuild postinstall).
7. **IPC contract foundation**: `src/shared/ipc-schemas/` + `src/shared/types/` có `Secret<T>` brand type, `ErrorEnvelope`, channel registry skeleton; `src/adapters/ipc.ts` define `IpcBridge` interface.
8. **CI skeleton**: `.github/workflows/ci.yml` chạy lint + typecheck + smoke test pass.
9. **Smoke test**: `tests/e2e/` có 1 smoke test `@playwright/test` verify app launch thành công.

## Tasks / Subtasks

- [x] **Task 1: Khởi tạo scaffold electron-vite** (AC: #1)
  - [x] Chạy `npm create @quick-start/electron@latest automation-desktop -- --template react-ts` tại root mono-repo
  - [x] `npm install` + verify `npm run dev` mở app với HMR hoạt động
  - [x] Verify React 19 + TypeScript strict default (nếu scaffold ra React 18, upgrade lên 19)
- [x] **Task 2: Restructure folder layout** (AC: #2)
  - [x] Tạo `src/adapters/`, `src/main/`, `src/preload/`, `src/renderer/`, `src/shared/`
  - [x] Tạo sub-folder `main/{license,profile,automation,proxy,selector,canary,telemetry,hot-config,updater,db,logging,ipc,boot,adapters}` (rỗng, có `index.ts` barrel placeholder cho các module sẽ build sau)
  - [x] Cấu hình `electron.vite.config.ts` cho 3-target build với alias `@/` → `src/`
- [x] **Task 3: Security baseline** (AC: #3)
  - [x] `src/main/boot/security-baseline.ts`: hàm áp `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` cho BrowserWindow
  - [x] CSP headers strict cho renderer (session.defaultSession.webRequest)
  - [x] `src/main/boot/bootstrap.ts`: init order db → adapters → services → ipc → window
- [x] **Task 4: Adapter layer (R-D16)** (AC: #4)
  - [x] `src/adapters/ipc.ts`: interface `IpcBridge { call<C>(channel, request): Promise<response> }`
  - [x] `src/adapters/secure-storage.ts`: interface `SecureStorage { get/set/delete }`
  - [x] `src/adapters/updater.ts`: interface `AutoUpdater`
  - [x] `src/adapters/window.ts`: interface `WindowManager`
  - [x] `src/main/adapters/electron-{ipc-bridge,safe-storage,auto-updater,window}.ts`: Electron stub impl
- [x] **Task 5: ESLint custom rules** (AC: #5)
  - [x] `eslint.config.js` Flat Config v9
  - [x] `no-restricted-imports`: cấm `electron` import ngoài `src/adapters/` + `src/preload/`
  - [x] Custom rules: `no-secret-in-ipc-payload`, `no-secret-tostring`, `no-direct-logger` (có thể dùng `no-restricted-syntax` hoặc plugin nội bộ)
  - [x] `npm run lint` pass
- [x] **Task 6: SQLCipher DB init** (AC: #6)
  - [x] Install `better-sqlite3` + `better-sqlite3-multiple-ciphers`
  - [x] `scripts/postinstall.ts`: electron-rebuild native module
  - [x] `src/main/db/client.ts`: mở DB mã hóa với key (key tạm thời ở story này — Epic 1.3 sẽ wire key từ safeStorage master)
  - [x] Verify đọc/ghi DB mã hóa hoạt động
- [x] **Task 7: IPC contract + shared types** (AC: #7)
  - [x] `src/shared/types/secret.ts`: `Secret<T>` brand type + `brandSecret()` + custom toString throw
  - [x] `src/shared/types/error-envelope.ts`: `ErrorEnvelope` interface
  - [x] `src/shared/ipc-schemas/index.ts`: channel registry skeleton + template literal type `phase3:${string}:${string}`
  - [x] `src/preload/index.ts`: contextBridge expose `window.api` typed
- [x] **Task 8: CI + smoke test** (AC: #8, #9)
  - [x] `.github/workflows/ci.yml`: lint + typecheck + smoke test (copy pattern từ electron-react-boilerplate MIT reference)
  - [x] `tests/e2e/smoke.spec.ts`: `@playwright/test` verify app launch (dùng Playwright electron namespace — đây là usecase đúng của namespace)
  - [x] Verify CI pass local

### Review Findings

- [x] [Review][Patch] `postinstall` dùng sai cú pháp `electron-rebuild`, làm native rebuild fail [`automation-desktop/scripts/postinstall.ts`:3]
- [x] [Review][Patch] `npm run lint` đang fail trên test files mới, nên AC#5/CI lint gate chưa đạt [`automation-desktop/tests/integration/security-baseline.spec.ts`:16]
- [x] [Review][Patch] Desktop CI workflow đang nằm trong `automation-desktop/.github`, GitHub Actions sẽ không chạy workflow này ở repo root [`automation-desktop/.github/workflows/ci.yml`:1]
- [x] [Review][Patch] Root CI không có desktop job, nên AC#8 chưa thật sự được enforce trong repo workflow [`.github/workflows/ci.yml`:7]
- [x] [Review][Patch] ESLint `no-restricted-imports` không enforce lệnh cấm import `electron` ngoài adapter/preload như story yêu cầu [`automation-desktop/eslint.config.mjs`:35]
- [x] [Review][Patch] SQLCipher read/write verification bị đánh dấu `test.fixme`, nhưng story đã tick task verify DB mã hóa [`automation-desktop/tests/integration/db-client.spec.ts`:3]
- [x] [Review][Patch] Script `test:e2e:p0` dùng regex `[P0]` nên sẽ match ký tự `P` hoặc `0`, không phải tag literal `[P0]` [`automation-desktop/package.json`:26]

## Dev Notes

### Bối cảnh story
Đây là **story đầu tiên của Phase 3** — foundational scaffold. KHÔNG implement license/EULA/automation (đó là Story 1.2+). Mục tiêu: app shell chạy được + nền tảng kiến trúc (adapter, security, IPC contract, encrypted DB) cho mọi story sau.

### Starter Template (architecture mandate)
- Tool: **electron-vite** scaffold (KHÔNG phải electron-react-boilerplate — đã loại sau Thesis Defense vì no-bytecode + sandbox:false default + AI-hostile `.erb/` config). [Source: architecture.md § Phase 3 Starter Template Evaluation]
- Command: `npm create @quick-start/electron@latest automation-desktop -- --template react-ts`

### Security baseline (CRITICAL — chống CVE)
- `sandbox: true` là MANDATORY (Priya's finding trong Thesis Defense — renderer compromise → cookie leak qua IPC). [Source: architecture.md § Security Baseline]
- contextIsolation + nodeIntegration:false + CSP strict.
- Cert pinning cho update endpoint sẽ wire ở Epic 8 (KHÔNG ở story này).

### Adapter pattern (R-D16) — quan trọng nhất
- Business logic CHỈ import từ `src/adapters/*`, KHÔNG bao giờ `import { ... } from 'electron'`.
- Lý do: framework decoupling escape hatch (Tauri swap 4-6 tuần nếu cần) + AI-agent boundary rõ + test dễ.
- ESLint `no-restricted-imports` enforce điều này. [Source: architecture.md § R-D16 + ADR-P3-D8]

### Minimal dep list (anti-creep — Occam's Razor)
Core deps story này cần: `electron`, `electron-vite`, `electron-builder`, `react@19`, `react-dom@19`, `typescript`, `vite`, `tailwindcss@4`, `better-sqlite3`, `better-sqlite3-multiple-ciphers`, `@playwright/test`, `zod`.
- KHÔNG thêm: React Router, state mgmt lib, React Hook Form, Vitest (deferred Phase 3.1+ — chỉ thêm khi pass trigger condition). [Source: architecture.md § Phase 3.0 Minimal Dep List]
- electron-updater, playwright-extra, stealth, node-machine-id: install ở story sau (Epic 8/4/1.3), KHÔNG ở story này.

### IPC contract (ADR-P3-D8)
- Channel naming: `phase3:<domain>:<verb>` (kebab verb).
- Mỗi channel = 1 Zod schema pair. Story này chỉ tạo skeleton + registry, chưa có channel thật.
- `Secret<T>` brand type: data từ user/safeStorage wrap `Secret<T>`, KHÔNG bao giờ qua IPC payload (dùng secret_ref handle). Custom toString throw. [Source: architecture.md § R-D3, Implementation Patterns]

### SQLCipher
- `better-sqlite3-multiple-ciphers` (fork hỗ trợ SQLCipher). Native module → cần electron-rebuild postinstall.
- Story này chỉ init DB connection mã hóa; schema tables tạo theo nhu cầu story sau (1.3 `phase3.licenses` ở backend, 2.1 `profiles` client). [Source: architecture.md § ADR-P3-D3, ADR-P3-D7]

### Project Structure Notes
- Mono-repo: `automation-desktop/` ngang hàng `backend/`, `frontend/`, `database/`. [Source: architecture.md § Repo Strategy]
- Backend Phase 3 endpoints (`backend/app/api/automation.py`) KHÔNG thuộc story này — story 1.3+ sẽ build.
- Folder layout phải khớp chính xác architecture § Complete Directory Tree.

### Testing standards
- `@playwright/test` cho cả unit + E2E (Vitest deferred). [Source: prd-phase3.md NFR, architecture.md § testing]
- Story này chỉ cần 1 smoke test (app launch). Test coverage ≥70% (NFR26) áp dụng cho story có business logic — story scaffold chưa cần.
- Backend Python test theo Phase 1+2 convention (`backend/tests/`) — không liên quan story này.

### References

- [Source: architecture.md#Phase-3-Starter-Template-Evaluation] — electron-vite scaffold, init command, folder structure, security baseline, minimal dep list
- [Source: architecture.md#ADR-P3-D1] — Electron platform decision
- [Source: architecture.md#ADR-P3-D3] — SQLCipher + safeStorage
- [Source: architecture.md#ADR-P3-D8] — IPC contract typed + Zod
- [Source: architecture.md#Phase-3-Implementation-Patterns] — naming, adapter discipline, secret marker, lint rules
- [Source: architecture.md#R-D16] — Framework Decoupling Layer (adapter)
- [Source: epics-phase3.md#Epic-1-Story-1.1]
- [Source: prd-phase3.md#NFR] — NFR11 sandbox, NFR24 adapter, NFR25 Zod, NFR27 lint rules
- [Source: _bmad-output/project-context.md] — Python imports absolute, ESLint Flat Config v9, Tailwind v4 @theme, Docker compose workflow

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `npm create @quick-start/electron@latest automation-desktop -- --template react-ts`
- `npm install`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test:smoke`
- `npx electron-rebuild -f -w better-sqlite3,better-sqlite3-multiple-ciphers`

### Completion Notes List

- Đã tạo app Electron-Vite React+TS tại `automation-desktop/` và verify dependency nền React 19 + TypeScript strict.
- Đã chuẩn hóa folder architecture `src/adapters|main|preload|renderer|shared` và tạo các module placeholder trong `src/main/*` theo spec.
- Đã triển khai security baseline (`sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`) + CSP headers strict trong boot layer.
- Đã thêm adapter interfaces (`ipc`, `secure-storage`, `updater`, `window`) và stub implementation ở `src/main/adapters`.
- Đã cấu hình ESLint Flat Config v9 với restricted-import + 3 custom rules (`no-secret-in-ipc-payload`, `no-secret-tostring`, `no-direct-logger`).
- Đã thêm SQLCipher client (`better-sqlite3-multiple-ciphers`) + postinstall rebuild script cho native modules theo ABI Electron.
- Đã thêm IPC contract foundation (`Secret<T>`, `ErrorEnvelope`, channel registry skeleton) và preload expose `window.api` typed.
- Đã tạo CI workflow chạy `lint + typecheck + build + smoke` cho `automation-desktop`.
- Đã thêm Playwright Electron smoke test và xử lý môi trường `ELECTRON_RUN_AS_NODE` để app launch thành công.
- Đã xử lý toàn bộ code review findings: sửa native rebuild, lint gate, root CI desktop job, ESLint boundary, SQLCipher runtime verification và tag grep script.

### File List

- automation-desktop/package.json
- automation-desktop/package-lock.json
- automation-desktop/electron.vite.config.ts
- automation-desktop/eslint.config.mjs
- automation-desktop/eslint-rules/no-direct-logger.js
- automation-desktop/eslint-rules/no-secret-in-ipc-payload.js
- automation-desktop/eslint-rules/no-secret-tostring.js
- automation-desktop/scripts/postinstall.ts
- automation-desktop/src/adapters/ipc.ts
- automation-desktop/src/adapters/secure-storage.ts
- automation-desktop/src/adapters/updater.ts
- automation-desktop/src/adapters/window.ts
- automation-desktop/src/shared/types/secret.ts
- automation-desktop/src/shared/types/error-envelope.ts
- automation-desktop/src/shared/ipc-schemas/index.ts
- automation-desktop/src/main/index.ts
- automation-desktop/src/main/boot/bootstrap.ts
- automation-desktop/src/main/boot/security-baseline.ts
- automation-desktop/src/main/db/client.ts
- automation-desktop/src/main/adapters/electron-ipc-bridge.ts
- automation-desktop/src/main/adapters/electron-safe-storage.ts
- automation-desktop/src/main/adapters/electron-auto-updater.ts
- automation-desktop/src/main/adapters/electron-window.ts
- automation-desktop/src/main/adapters/electron-bootstrap.ts
- automation-desktop/src/main/adapters/electron-runtime.ts
- automation-desktop/src/main/adapters/electron-security-baseline.ts
- automation-desktop/src/main/license/index.ts
- automation-desktop/src/main/profile/index.ts
- automation-desktop/src/main/automation/index.ts
- automation-desktop/src/main/proxy/index.ts
- automation-desktop/src/main/selector/index.ts
- automation-desktop/src/main/canary/index.ts
- automation-desktop/src/main/telemetry/index.ts
- automation-desktop/src/main/hot-config/index.ts
- automation-desktop/src/main/updater/index.ts
- automation-desktop/src/main/db/index.ts
- automation-desktop/src/main/logging/index.ts
- automation-desktop/src/main/ipc/index.ts
- automation-desktop/src/main/boot/index.ts
- automation-desktop/src/main/adapters/index.ts
- automation-desktop/src/preload/index.ts
- automation-desktop/src/preload/index.d.ts
- automation-desktop/tests/e2e/smoke.spec.ts
- automation-desktop/tests/integration/security-baseline.spec.ts
- automation-desktop/tests/api/contracts.spec.ts
- automation-desktop/tests/component/renderer-shell.spec.ts
- automation-desktop/tests/README.md
- automation-desktop/tests/support/factories/user-factory.ts
- automation-desktop/tests/support/fixtures/base.fixture.ts
- automation-desktop/tests/support/helpers/assertions.ts
- automation-desktop/tests/support/helpers/retry.ts
- automation-desktop/tests/support/helpers/wait-for.ts
- automation-desktop/playwright.config.ts
- automation-desktop/.prettierignore
- .github/workflows/ci.yml

### Change Log

- 2026-06-02: Hoàn tất scaffold `automation-desktop` cho Story 1.1, implement security baseline, adapter layer, SQLCipher init, IPC contracts, ESLint guardrails, CI skeleton và Playwright smoke test.
- 2026-06-02: Addressed code review findings; story marked done after all patch findings were resolved and validation gates passed.
