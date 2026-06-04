# CLAUDE.md — automation-desktop (Phase 3 Electron App)

> Rules này được load tự động vào mọi session Claude Code trong folder `automation-desktop/`.
> Derived từ: architecture.md § Phase 3, Implementation Patterns + bài học từ code review Story 1.1 & 1.2.

## Tech Stack

- **Electron + electron-vite** (KHÔNG phải electron-react-boilerplate)
- **TypeScript strict**, React 19, Vite, custom plain CSS design tokens
- **zod v4** cho schema validation (`z.object`, `z.infer`)
- **better-sqlite3-multiple-ciphers** cho SQLCipher DB
- **@playwright/test** cho cả unit/integration/E2E (KHÔNG Vitest cho đến khi trigger condition met)

## Critical Rules — Security & Architecture

### 1. Adapter Layer (R-D16) — KHÔNG ĐƯỢC vi phạm

```ts
// ❌ SAI — business logic import electron trực tiếp
import { safeStorage, ipcMain } from 'electron'

// ✅ ĐÚNG — chỉ import qua adapter
import { secureStorage } from '@/adapters/secure-storage'
```

ESLint `no-restricted-imports` đã enforce điều này. CI sẽ fail nếu vi phạm.
**Ngoại lệ duy nhất**: `src/adapters/` và `src/preload/` được phép import Electron.

### 2. Smoke / Debug Code — Guard bằng `!app.isPackaged`

```ts
// ❌ SAI — smoke code chạy trong production, attacker có thể exploit qua env vars
function runSettingsSmoke(settings) {
  const key = process.env['PHASE3_SETTINGS_SMOKE_KEY']
  // ...
}

// ✅ ĐÚNG — luôn guard trước khi đọc env vars test/smoke
function runSettingsSmoke(settings) {
  if (app.isPackaged) return  // guard đầu tiên
  const key = process.env['PHASE3_SETTINGS_SMOKE_KEY']
  // ...
}
```

**Lý do**: Nếu thiếu guard, attacker set env var `PHASE3_SETTINGS_SMOKE_KEY=eula_accepted_version VALUE=99` → bypass EULA gate vĩnh viễn. Bài học từ review Story 1.2.

### 3. `shell.openExternal` — Validate URL protocol

```ts
// ❌ SAI — mở bất kỳ URL nào, kể cả javascript:// hay file://
mainWindow.webContents.setWindowOpenHandler((details) => {
  shell.openExternal(details.url)  // NGUY HIỂM
  return { action: 'deny' }
})

// ✅ ĐÚNG — chỉ http/https
mainWindow.webContents.setWindowOpenHandler((details) => {
  const url = details.url
  if (url.startsWith('https://') || url.startsWith('http://')) {
    void shell.openExternal(url)
  }
  return { action: 'deny' }
})
```

**Lý do**: Renderer sandbox:true vẫn có thể trigger `window.open`. Bài học từ review Story 1.2.

### 4. contextIsolation — KHÔNG có fallback

```ts
// ❌ SAI — ghi vào globalThis khi !contextIsolated bypass toàn bộ Zod validation
if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  ;(globalThis as any).api = api  // renderer có thể gọi ipcRenderer trực tiếp
}

// ✅ ĐÚNG — throw hard nếu security config sai
if (!process.contextIsolated) {
  throw new Error('[Phase3] contextIsolation is required.')
}
contextBridge.exposeInMainWorld('api', api)
```

### 5. DB Init — Wrap trong try/catch

```ts
// ❌ SAI — DB locked khi có instance thứ 2 → crash uncaught, không message
const db = openEncryptedDatabase({ path: dbPath, key })

// ✅ ĐÚNG
let db: ReturnType<typeof openEncryptedDatabase>
try {
  db = openEncryptedDatabase({ path: dbPath, key })
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  throw new Error(`[Phase3] Không thể mở database: ${msg}\nCó thể một phiên bản đang chạy rồi.`)
}
```

## IPC Contract Rules (ADR-P3-D8)

### 6. Channel naming

```ts
// ✅ Format bắt buộc: phase3:<domain>:<verb> (lowercase kebab)
'phase3:settings:get'
'phase3:settings:set'
'phase3:automation:start'
'phase3:profile:import-bulk'
```

### 7. Zod validate CẢ 2 chiều — request VÀ response

```ts
// ❌ SAI — chỉ validate request
ipcMain.handle('phase3:settings:get', (_, request) => {
  const { key } = request  // không validate!
  return { ok: true, value: repo.get(key) }
})

// ✅ ĐÚNG — validate cả 2 chiều
ipcMain.handle('phase3:settings:get', (_, request): SettingsGetResponse => {
  const parsed = SettingsGetRequestSchema.safeParse(request)
  if (!parsed.success) return toErrorResponse('VALIDATION_ERROR', 'Dữ liệu không hợp lệ', parsed.error.flatten())
  return SettingsGetResponseSchema.parse({ ok: true, value: repo.getSetting(parsed.data.key) })
})
```

### 8. Error LUÔN là ErrorEnvelope — không throw raw Error

```ts
// ❌ SAI — throw raw Error qua IPC boundary
if (!parsedResponse.success) throw new Error(`Invalid response`)

// ✅ ĐÚNG — trả về ErrorEnvelope shape (ok: false)
if (!parsedResponse.success) {
  return { ok: false, error: { code: 'IPC_RESPONSE_INVALID', message: 'Phản hồi không hợp lệ', retryable: false } }
}
```

### 9. ErrorEnvelope phải có field `retryable`

```ts
// ❌ SAI — thiếu retryable, renderer không implement được retry logic
{ ok: false, error: { code: 'X', message: 'Y' } }

// ✅ ĐÚNG — retryable bắt buộc
{ ok: false, error: { code: 'X', message: 'Y', retryable: false } }
```

## Secret Marker Rules (R-D3)

### 10. Cookie/2FA/password → `Secret<T>`, KHÔNG đi qua IPC payload

```ts
import type { Secret } from '@/shared/types/secret'

// ❌ SAI — cookie raw trong IPC payload
await ipcBridge.call('phase3:profile:create', { uid, cookie: rawCookie })

// ✅ ĐÚNG — truyền reference handle, main lookup từ safeStorage tại exec time
await ipcBridge.call('phase3:profile:create', { uid, cookie_ref: profileId })
```

### 11. Không bao giờ log cookie/password/2FA/CSRF token

```ts
// ❌ SAI
logger.info('Login', { uid, cookie, fb_dtsg })

// ✅ ĐÚNG — luôn qua redact()
logger.info('Login', redact({ uid, cookie, fb_dtsg }))
```

ESLint `no-direct-logger` enforce điều này.

## Data & State Rules

### 12. Số nguyên parse — strict, không trailing garbage

```ts
// ❌ SAI — parseInt("1abc") = 1, bypass version check
const ver = Number.parseInt(storedVersion, 10)

// ✅ ĐÚNG — strict parse
const trimmed = storedVersion.trim()
const ver = Number(trimmed)
if (!Number.isInteger(ver) || String(ver) !== trimmed) return false // invalid
```

### 13. Multi-step persist — set critical last (hoặc dùng transaction)

```ts
// ❌ SAI — nếu set thứ 2 crash, set thứ 1 đã commit → state không nhất quán
await setSetting('eula_accepted_version', version)
await setSetting('telemetry_enabled', 'true')  // crash ở đây → telemetry không bao giờ set

// ✅ ĐÚNG — set side-effect trước, set gating key cuối cùng
await setSetting('telemetry_enabled', 'true')      // non-gating → set trước
await setSetting('eula_accepted_version', version) // gating → set sau cùng
```

### 14. Schema luôn có min length cho non-optional string

```ts
// ❌ SAI — empty string tạo state mơ hồ
export const SettingValueSchema = z.string().max(4096)

// ✅ ĐÚNG
export const SettingValueSchema = z.string().min(1).max(4096)
```

## Localization Rules (NFR-P3-Localization-VN-Lock)

### 15. ErrorEnvelope `message` field — tiếng Việt

```ts
// ❌ SAI
toErrorResponse('SETTINGS_GET_FAILED', 'Unable to read local setting')

// ✅ ĐÚNG
toErrorResponse('SETTINGS_GET_FAILED', 'Không thể đọc cài đặt cục bộ', error, true)
```

**Quy tắc**: `message` = user-facing tiếng Việt; `code` = SCREAMING_SNAKE_CASE English (programmatic).
**Scope**: Phase 3.0 → 3.4. i18n defer Phase 3.5+.

## UI Rules

### Desktop styling source of truth

`automation-desktop` dùng **plain CSS design tokens + component classes** trong renderer, KHÔNG dùng Tailwind cho Electron desktop UI. Tailwind v4 chỉ còn là reference cho web/admin frontend hiện hữu ngoài desktop app.

```tsx
// ❌ SAI — thêm Tailwind utility mới trong desktop renderer
<button className="rounded-lg bg-blue-600 px-4 py-2 text-white">

// ✅ ĐÚNG — dùng class/token CSS của desktop app
<button className="primary-button">
```

### 16. Loading state — KHÔNG dùng cùng class/testid với main shell

```tsx
// ❌ SAI — E2E test không phân biệt được loading vs ready
<main className="main-shell">Đang tải...</main>

// ✅ ĐÚNG — class/testid riêng
<main className="loading-shell" data-testid="loading-shell">Đang tải...</main>
```

### 17. Async button — disable ngay khi click (trước React flush)

```tsx
// ❌ SAI — double-click race: 2 lần submit trước khi accepting state flush
<button disabled={!agreed || accepting} onClick={handleAccept}>

// ✅ ĐÚNG — disable DOM trực tiếp tại onClick, sau đó async xử lý
<button disabled={!agreed || accepting}
  onClick={(e) => {
    ;(e.currentTarget as HTMLButtonElement).disabled = true
    void handleAccept()
  }}
>
```

## Testing Rules

### 18. Tất cả AC phải có test tương ứng — không tick nếu chỉ có unit test cho pure function

| AC type | Test required |
|---|---|
| UI behavior (hiện/ẩn view, button state) | E2E `@playwright/test` Electron |
| IPC round-trip | Integration test (main process real) |
| DB read/write | Integration test (SQLCipher real) |
| Pure function logic | Unit test đủ |
| **Version bump re-show** (AC6-style) | **E2E bắt buộc** — unit test pure function KHÔNG đủ |

### 19. KHÔNG dùng `test.fixme` nếu đã tick task "verify hoạt động"

Nếu story tick `[x] Verify X hoạt động` → phải có test thực sự pass, không phải `test.fixme('TODO')`.

### 20. `npm run lint` phải pass trên file test mới

Lint fail trên test file = AC lint pass KHÔNG được tick. ESLint config áp dụng cho toàn bộ `tests/`.

## File Structure Rules

## High-Blast Safety Rules — Story 12.0

Story 12.0 là safety gate bắt buộc trước mọi workflow high-blast Epic 12-19: Messenger, group join/post/comment, Page, Marketplace, livestream, mobile script, hoặc mixed browser/mobile execution.

### 21. High-blast action PHẢI gọi safety primitive trước khi chạy

Trước khi start job hoặc execute action tier 2+, scheduler/orchestrator phải validate tối thiểu:

- warmup eligibility
- per-profile daily cap
- per-action cooldown
- per-target duplicate guard
- one high-blast action active per profile
- checkpoint/rate-limit/risk pause state
- global kill switch

Safety failure phải block trước khi consume action token nếu có thể.

```ts
// ❌ SAI — request token / navigate Facebook trước khi check safety
const token = await actionTokenClient.requestActionToken({ actionType: 'message' })
await navigate(page, targetUrl)

// ✅ ĐÚNG — safety gate trước token + navigation
const decision = await safety.validateHighBlastAction({ profileId, actionType: 'message', target, executorKind: 'browser' })
if (!decision.ok) return stopWithSafetyReason(decision.reason)
const token = await actionTokenClient.requestActionToken({ actionType: 'message' })
```

### 22. Safety state dùng shared repository, không tạo policy riêng theo feature

Các flow Epic 12-19 phải reuse repository/schema chung như `safety_policies`, `profile_action_counters`, `global_kill_switch_state` hoặc equivalent đã được Story 12.0 implement. Không tạo kill switch/cap/cooldown riêng cho Messenger, Group, Page, Marketplace, Live hoặc Mobile.

### 23. Executor kind phải rõ ràng

Browser/mobile/mixed counters phải phân tách bằng `executor_kind='browser'|'mobile'|'mixed'` khi safety policy cần tách quota. Một profile không được chạy đồng thời browser + mobile high-blast action.

### 24. Mobile farm boundary — Epic 19 optional, không thay browser automation

Epic 19 là channel mobile riêng. App desktop chỉ làm control plane qua `MobileFarmProvider` adapter (`listDevices`, `runScript`, `stop`, `getLogs`) khi phần mềm farm phone có API/CLI/script runner. Appium/ADB chỉ là fallback, không hardcode vào domain module.

Browser automation Epic 1-18 phải giữ nguyên behavior; mobile không được mutate browser execution path ngoài shared safety/profile/risk/control-plane primitives.

### 25. Mỗi service = 1 folder + `index.ts` barrel

```
src/main/license/
├── license-service.ts
├── hwid-generator.ts
└── index.ts          ← barrel export
```

### 26. Dev Notes trong story hứa tạo file → file PHẢI tồn tại trong commit

Nếu Dev Notes nói "dùng placeholder content rõ ràng đánh dấu DRAFT", file placeholder PHẢI có trong commit (không chỉ trong text). Bài học: `LICENSE-EULA.md` thiếu trong review Story 1.2.

### 27. Native module rebuild — dùng đúng cú pháp `electron-rebuild`

```ts
// ❌ SAI — sai cú pháp, rebuild fail silently, native module không hoạt động
exec('electron-rebuild -f -w better-sqlite3')

// ✅ ĐÚNG — dùng npx + flag đúng
exec('npx electron-rebuild -f -w better-sqlite3,better-sqlite3-multiple-ciphers')
```

Sau khi thêm native module mới (`better-sqlite3`, node-machine-id, ...) phải chạy rebuild và verify `.node` file tồn tại trong `node_modules/*/build/Release/`. Bài học từ review Story 1.1.

### 28. CI workflow — PHẢI nằm ở root `.github/workflows/`, KHÔNG trong subfolder

```
❌ SAI: automation-desktop/.github/workflows/ci.yml  ← GitHub Actions KHÔNG chạy
✅ ĐÚNG: .github/workflows/ci.yml (root repo)         ← GitHub Actions chạy
```

Root CI phải có explicit job cho `automation-desktop` (lint + typecheck + test). Bài học từ review Story 1.1.

### 29. Test script regex `[P0]` — escape brackets khi grep tag literal

```json
// ❌ SAI — regex [P0] match ký tự P hoặc 0, không phải tag literal "[P0]"
"test:e2e:p0": "playwright test --grep [P0]"

// ✅ ĐÚNG — escape brackets cho grep literal
"test:e2e:p0": "playwright test --grep '\\[P0\\]'"
```

Áp dụng cho mọi test tag `[P0]`, `[P1]`, `[smoke]`, ... Bài học từ review Story 1.1.

## Checklist tự review trước khi commit

Trước khi submit story cho review, agent PHẢI tự check:

- [ ] Lint pass: `npm run lint` (0 errors, kể cả test files)
- [ ] Typecheck pass: `npm run typecheck` (0 errors)
- [ ] Mọi smoke/debug function có guard `if (app.isPackaged) return`
- [ ] Mọi `shell.openExternal` validate http/https protocol
- [ ] preload không có `globalThis` fallback
- [ ] Tất cả IPC handler Zod parse request + response
- [ ] Tất cả error response có `retryable` field + message tiếng Việt
- [ ] Desktop renderer dùng plain CSS tokens/classes, không thêm Tailwind utility mới
- [ ] High-blast Epic 12-19 gọi Story 12.0 safety gate trước token/navigation/action
- [ ] Kill switch/cap/cooldown dùng shared safety repository, không tạo policy riêng theo feature
- [ ] Browser/mobile/mixed execution ghi đúng `executor_kind`; không cho một profile chạy đồng thời high-blast browser + mobile
- [ ] Mọi AC trong story có test tương ứng (E2E cho UI behavior)
- [ ] Mọi file được hứa trong Dev Notes đã có trong commit
- [ ] KHÔNG `test.fixme` trên task đã tick verify
- [ ] Native module có sau `electron-rebuild` — verify `.node` file tồn tại
- [ ] CI job cho desktop nằm ở root `.github/workflows/ci.yml`
- [ ] Test script tag `[P0]`, `[smoke]` dùng escaped regex `\\[P0\\]`
