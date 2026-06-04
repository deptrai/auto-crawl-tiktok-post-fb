---
project_name: 'automation-desktop'
phase: 'phase-3'
date: '2026-06-02'
status: 'active'
rule_count: 25
optimized_for_llm: true
---

# Project Context — automation-desktop (Phase 3 Electron)

> Rules cho AI agent implement code trong `automation-desktop/`. Supplement cho `CLAUDE.md` trong cùng folder.
> Xem chi tiết với ví dụ code tại `automation-desktop/CLAUDE.md`.

## Technology Stack

- **Runtime**: Electron (electron-vite scaffold, NOT electron-react-boilerplate)
- **Language**: TypeScript strict mode
- **UI**: React 19, Vite HMR, custom plain CSS design tokens (no Tailwind in `automation-desktop`)
- **Database**: better-sqlite3-multiple-ciphers (SQLCipher AES-256)
- **Validation**: zod v4 (`z.object`, `z.infer`, `z.union`)
- **Testing**: `@playwright/test` only (Vitest deferred)
- **Linting**: ESLint Flat Config v9 (`eslint.config.mjs`)

## Critical Implementation Rules

### Security Rules (Electron-specific)

- **Adapter discipline**: Business logic KHÔNG import `electron` trực tiếp. Chỉ `src/adapters/` và `src/preload/` được phép. ESLint `no-restricted-imports` enforce.
- **Smoke/debug guard**: Mọi function đọc smoke env vars (`PHASE3_*`) PHẢI bắt đầu bằng `if (app.isPackaged) return`. Không có guard = EULA bypass vulnerability.
- **`shell.openExternal`**: LUÔN validate `url.startsWith('https://') || url.startsWith('http://')` trước khi gọi — kể cả trong `setWindowOpenHandler`.
- **preload contextIsolation**: Không có fallback `globalThis`. Nếu `!process.contextIsolated` → throw hard.
- **DB init**: Wrap `openEncryptedDatabase` trong try/catch với message thân thiện. DB locked = crash nếu không catch.

### IPC Rules (ADR-P3-D8)

- **Channel format**: `phase3:<domain>:<verb>` (lowercase kebab verb). Ví dụ: `phase3:settings:get`, `phase3:automation:start`.
- **Zod 2-way**: Mọi `ipcMain.handle` PHẢI safeParse request VÀ `.parse()` response.
- **Error shape**: LUÔN trả `{ ok: false, error: { code, message, retryable, details? } }` — KHÔNG throw raw Error. `retryable: boolean` là bắt buộc.
- **Error message language**: `message` field = tiếng Việt user-facing. `code` = SCREAMING_SNAKE_CASE English.

### Data Rules

- **Secret<T>**: Cookie, 2FA seed, password wrap `Secret<T>` brand type. KHÔNG qua IPC payload raw — dùng reference handle.
- **Log redaction**: Tất cả log qua `redact()` middleware. ESLint `no-direct-logger` enforce.
- **Version parse**: Dùng `Number(trimmed)` + check `String(ver) === trimmed` thay vì `Number.parseInt` (parseInt chấp nhận trailing garbage).
- **Multi-step persist**: Set side-effect trước, set gating key sau cùng để tránh state không nhất quán khi crash giữa chừng.
- **Schema min length**: String schemas luôn có `.min(1)` trừ khi empty string có ý nghĩa cụ thể.

### Localization (NFR-P3-Localization-VN-Lock)

- Phase 3.0 → 3.4: UI, error message, EULA, privacy policy lock **tiếng Việt**.
- ErrorEnvelope `message` = tiếng Việt. `code` = English identifier.

### Testing Rules

- **AC coverage**: AC liên quan UI behavior = E2E test (`@playwright/test` Electron). Pure function = unit test. IPC/DB = integration test.
- **Version bump re-show** (AC6-style): E2E bắt buộc. Unit test pure function KHÔNG đủ.
- **No `test.fixme`**: Nếu task tick "verify", test PHẢI pass thực sự — không placeholder `test.fixme`.
- **Lint trên test files**: `npm run lint` phải pass trên toàn bộ `tests/` folder.

### Code Quality Rules

- **Loading state**: class/testid riêng (`loading-shell`), không share với main shell (`main-shell`).
- **Async button**: Disable DOM trực tiếp tại `onClick` trước khi async — tránh double-click race.
- **File promises**: Nếu Dev Notes nói "tạo file placeholder DRAFT", file PHẢI có trong commit.
- **Native rebuild**: Sau khi thêm native module mới: `npx electron-rebuild -f -w <module>`. Verify `.node` file tồn tại trong `node_modules/*/build/Release/`. Sai cú pháp → fail silently.
- **CI placement**: Workflow PHẢI ở root `.github/workflows/ci.yml`. Workflow trong `automation-desktop/.github/` sẽ KHÔNG chạy bởi GitHub Actions.
- **Test script tag regex**: `[P0]`, `[smoke]` trong `--grep` phải escape brackets: `--grep '\\[P0\\]'`. Không escape → match ký tự P hoặc 0.
- **Checklist trước commit**: lint 0 errors (kể cả test files) → typecheck 0 errors → smoke guard → AC có test → file được hứa đã tạo → native rebuild verify → CI ở root → test regex escaped.

## Folder Structure

```
automation-desktop/
├── src/
│   ├── adapters/       ← interface ONLY (ipc, secure-storage, updater, window)
│   ├── main/
│   │   ├── adapters/   ← Electron impl của adapter interfaces
│   │   ├── db/         ← client.ts + repositories/
│   │   ├── ipc/        ← handlers + shell-handlers
│   │   ├── boot/       ← bootstrap.ts + security-baseline.ts
│   │   └── <domain>/   ← 1 folder per domain, index.ts barrel
│   ├── preload/        ← contextBridge expose window.api
│   ├── renderer/       ← React 19 UI (không import electron trực tiếp)
│   └── shared/         ← ipc-schemas + types + retry.ts (cross-process)
└── tests/
    ├── e2e/            ← @playwright/test Electron app
    ├── integration/    ← real DB + real IPC
    └── unit/           ← pure function tests
```

## Key Files

| File | Purpose | Notes |
|---|---|---|
| `src/shared/ipc-schemas/common.ts` | `ErrorEnvelope` schema | `retryable: boolean` bắt buộc |
| `src/shared/types/secret.ts` | `Secret<T>` brand type | KHÔNG bao giờ serialize |
| `src/shared/ipc-schemas/index.ts` | `channelRegistry` | Đăng ký channel mới ở đây |
| `src/main/db/client.ts` | SQLCipher open | DB key tạm thời đến Story 1.3 |
| `src/main/adapters/electron-bootstrap.ts` | App init + smoke guard | `app.isPackaged` guard PHẢI có |
| `src/preload/index.ts` | IPC bridge | Throw nếu `!contextIsolated` |

## Anti-Patterns Tuyệt Đối Cấm

- `import { ... } from 'electron'` trong `src/main/<domain>/` (dùng adapter)
- `shell.openExternal(url)` không validate protocol
- `globalThis.api = ...` khi contextIsolation tắt
- Smoke function không có `if (app.isPackaged) return`
- `Number.parseInt` để parse version/integer từ string DB
- `test.fixme` trên task đã tick verify
- Error message tiếng Anh trong `ErrorEnvelope.message`
- ⚠️ proxyfb provider dùng HTTP (api.proxyfb.com KHÔNG hỗ trợ HTTPS — verified). API key + proxy credential đi plaintext qua mạng → rủi ro MITM inject proxy. Đây là ràng buộc provider (accepted Story 3.1). Mitigation: parseProxyString reject control chars. KHI thêm provider mới → ưu tiên HTTPS.
