# Story 3.1: Tích hợp proxy provider proxyfb

Status: ready-for-dev

<!-- Phase 3 story (Epic 3 — Proxy Management, story 1/3). Sources: epics-phase3.md#Story-3.1 (L314-326), prd-phase3.md#FR24 (L376), architecture.md (folder proxy/ L1826-1827, FR-P3-08 L912). ⚠️ automation-desktop/ (Electron client) — 25 rules CLAUDE.md ÁP DỤNG. Previous: Epic 2 done (2.1+2.2+2.3). C# source: automation-facebook/SST_TOOL_FB/Tech_Meta/proxyfb.cs. -->

## Story

As a user (affiliate marketer như Minh),
I want cấu hình API key proxyfb và nhận proxy luân phiên,
so that mỗi profile automation session dùng được IP riêng từ provider proxyfb.com.

> ⚠️ **PHẠM VI**: Story này ở **`automation-desktop/`** (Electron client). `automation-desktop/CLAUDE.md` (25 rules) ÁP DỤNG. Story 3.1 = **tích hợp provider proxyfb** — gọi API lấy/xoay proxy, lưu API key an toàn, expose qua IPC. Health-check + circuit-breaker = 3.2; bind per session = 3.3 — KHÔNG làm ở đây.

## Acceptance Criteria

1. **Lưu API key proxyfb an toàn (R-D3)**: API key lưu vào safeStorage key `proxy.proxyfb.api_key` (KHÔNG lưu vào SQLite plaintext). IPC `phase3:proxy:config-get` / `phase3:proxy:config-set` để renderer đọc/ghi config (key có, không có). Zod 2-way + registry + ErrorEnvelope VN (rule #7-9). **Display**: renderer chỉ hiện "Đã cấu hình" / "Chưa cấu hình" (KHÔNG trả raw key về renderer — rule #10,#11).
2. **Provider `proxyfb.ts`**: pure TypeScript class/function trong `src/main/proxy/providers/proxyfb.ts`. Interface `ProxyProvider { getProxy(key: string): Promise<ProxyInfo> }` — `ProxyInfo = { host: string; port: number; username: string; password: string }`. Logic (port từ C# proxyfb.cs): (a) gọi `changeProxy.php?key=…` trước — nếu `success==="True"` → parse + return; (b) nếu fail → fallback gọi `getProxy.php?key=…`; nếu cả hai fail → throw `ProxyServiceError('PROXY_UNAVAILABLE','...',true)`. Parse format `host:port:user:pass` (split `:`, validate 4 parts, port số nguyên). KHÔNG retry vô hạn trong provider (retry = Story 3.2).
3. **`ProxyService` + IPC `phase3:proxy:rotate`**: IPC nhận `{ profileId?: string }` (optional — story 3.3 sẽ dùng), gọi `proxyfbProvider.getProxy(key)` với key từ safeStorage, trả `{ ok:true, proxy: ProxyInfo }`. Key chưa cấu hình → ErrorEnvelope `PROXY_NOT_CONFIGURED` retryable:false. API fail → ErrorEnvelope `PROXY_UNAVAILABLE` retryable:true. Response `ProxyInfo` KHÔNG chứa raw API key.
4. **Proxy config UI (ProxyView)**: View mới trong `MainShell` (dưới ProfilesView). Gồm: field "API key proxyfb" (input password-type để ẩn) + nút "Lưu" → call config-set; indicator "Đã cấu hình/Chưa" từ config-get khi mount; nút "Test proxy" → call rotate → hiển thị `host:port` (KHÔNG username:password). Hardcode tiếng Việt. Loading state rule #16, button disable rule #17.
5. **DB schema `proxy_configs`** (optional metadata, KHÔNG lưu key): bảng `proxy_configs(provider TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1, last_rotated_at TEXT)` trong `client.ts`. Cho phép 3.2 circuit-breaker ghi trạng thái sau. API key TUYỆT ĐỐI KHÔNG ở đây.
6. **Tests**: Unit `provider.spec.ts` (mock `fetch`): happy path changeProxy.php → parse ProxyInfo; fallback getProxy.php khi changeProxy fail; cả hai fail → throw; parse lỗi format → throw. Unit `proxy-service.spec.ts`: config-get/set; rotate happy; key missing → PROXY_NOT_CONFIGURED; provider fail → PROXY_UNAVAILABLE. Integration (FakeIpcMain): 3 channel Zod 2-way + no-secret response. `typecheck` PASS, `lint` 0 errors.

## Tasks / Subtasks

### Main process (Electron — TypeScript)

- [ ] **Task 1: ProxyInfo type + ProxyServiceError** (AC: #2,#3)
  - [ ] `src/shared/types/proxy.ts`: `ProxyInfo = { host:string; port:number; username:string; password:string }` + export. `ProxyProvider` interface.
  - [ ] `src/main/proxy/proxy-service.ts`: `ProxyServiceError extends Error { code; retryable }` (mirror ProfileServiceError pattern).
- [ ] **Task 2: proxyfb provider** (AC: #2)
  - [ ] `src/main/proxy/providers/proxyfb.ts`: `ProxyfbProvider implements ProxyProvider`. Dùng `fetch` (native, Electron supports). `getProxy(key)`: try changeProxy.php → fallback getProxy.php → throw. `parseProxyString(raw: string): ProxyInfo` pure helper (export separately để unit test). KHÔNG import electron.
- [ ] **Task 3: ProxyService** (AC: #1,#3)
  - [ ] `src/main/proxy/proxy-service.ts`: `createProxyService({ storage, providers })` — `configGet()`: `storage.get('proxy.proxyfb.api_key')` → `boolean` (có key không, KHÔNG trả raw); `configSet(key)`: `storage.set(...)` validate `key.trim().length > 0`; `rotate(profileId?)`: `storage.get → getProxy → return ProxyInfo`.
  - [ ] `src/main/proxy/index.ts`: barrel export.
- [ ] **Task 4: IPC schemas + 3 channel** (AC: #1,#3)
  - [ ] `src/shared/ipc-schemas/proxy.ts`: Zod schemas cho 3 channel: `phase3:proxy:config-get` (req `{}`, res `{ok:true,configured:boolean}`); `phase3:proxy:config-set` (req `{apiKey:z.string().trim().min(1).max(500)}`, res `{ok:true}`); `phase3:proxy:rotate` (req `{profileId?:z.string()}`, res `{ok:true,proxy:{host,port}}`). **Lưu ý**: `proxy:rotate` response KHÔNG có `username`/`password` (rule #10 — treat proxy credential như secret). Export types.
  - [ ] `src/shared/ipc-schemas/index.ts`: thêm 3 entry vào `channelRegistry` + import.
- [ ] **Task 5: IPC handlers** (AC: #1,#3)
  - [ ] `src/main/ipc/proxy-handlers.ts`: `registerProxyHandlers(ipcMain, service)` — 3 handler, mỗi cái Zod safeParse + try/catch → normalizeError. Reuse `toErrorResponse`/`normalizeError` pattern từ profile-handlers.ts (KHÔNG copy-paste — import shared helper nếu có, nếu không thì viết tương tự).
- [ ] **Task 6: DB schema `proxy_configs`** (AC: #5)
  - [ ] `src/main/db/client.ts`: thêm `CREATE TABLE IF NOT EXISTS proxy_configs(provider TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, last_rotated_at TEXT)` sau bảng `profile_metadata`.
- [ ] **Task 7: Bootstrap wiring** (AC: #1,#3)
  - [ ] `src/main/adapters/electron-bootstrap.ts`: tạo `proxyService = createProxyService({ storage: adapters.storage, providers: { proxyfb: new ProxyfbProvider() } })`; `registerProxyHandlers(ipcMain, proxyService)`.
- [ ] **Task 8: Renderer API + ProxyView + App.tsx** (AC: #4)
  - [ ] `src/renderer/src/api/proxy-api.ts`: `getProxyConfig()`, `setProxyConfig(apiKey)`, `rotateProxy()`.
  - [ ] `src/renderer/src/views/ProxyView.tsx`: input password (ẩn key), nút Lưu, indicator, nút Test → show `host:port`. Loading rule #16, disable rule #17, tiếng Việt.
  - [ ] `src/renderer/src/App.tsx`: thêm `<ProxyView />` vào `MainShell` (sau `ProfilesView`).
- [ ] **Task 9: Tests** (AC: #6)
  - [ ] `tests/unit/proxyfb-provider.spec.ts`: mock `fetch` (global), test 5 case (happy/fallback/both-fail/parse-ok/parse-error).
  - [ ] `tests/unit/proxy-service.spec.ts`: configGet/Set, rotate happy/missing-key/provider-fail.
  - [ ] `tests/integration/proxy-ipc-handlers.spec.ts` (FakeIpcMain): 3 channel Zod 2-way + no-secret.

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules)
- **R-D3 / Rule #10,#11**: API key proxyfb là credential → safeStorage only; KHÔNG vào SQLite; KHÔNG return về renderer; KHÔNG log. Response `rotate` chỉ trả `{host,port}` (không `username`/`password` — treat như secret).
- **Rule #7,#8,#9**: IPC Zod 2-way + ErrorEnvelope `retryable` + KHÔNG throw raw Error.
- **Rule #15**: ErrorEnvelope message tiếng Việt. `code` English.
- **Rule #14**: `apiKey: z.string().trim().min(1).max(500)`.
- **Rule #16,#17**: ProxyView loading testid riêng + disable button async.
- **Rule #1 (Adapter)**: `proxyfb.ts` KHÔNG import `electron`. Chỉ `fetch` + pure TypeScript.

### API proxyfb — port từ C# (proxyfb.cs)
Logic C# gốc (đã port, không đổi):
```
1. Try: GET http://api.proxyfb.com/api/changeProxy.php?key={key}
   → JSON: { "success": "True"|"False", "proxy": "host:port:user:pass" }
   → Nếu success = "True" → parse proxy → return
2. Fallback: GET http://api.proxyfb.com/api/getProxy.php?key={key}
   → Cùng format JSON
   → Nếu success = "True" → parse proxy → return
3. Nếu cả 2 fail → throw ProxyServiceError('PROXY_UNAVAILABLE', '...', retryable:true)
```
[Source: automation-facebook/SST_TOOL_FB/Tech_Meta/proxyfb.cs]

**Parse format**: `"host:port:user:pass"` → split(`:`) → expect 4 parts; `port = Number(parts[1])` (strict parse); validate `Number.isInteger(port) && port > 0 && port < 65536` (rule #12 strict parse). Nếu format lỗi → throw.

**Lưu ý**: C# code cũ dùng `HttpRequest` từ xNet, không có timeout. Port TypeScript nên thêm `AbortController` + `signal: AbortSignal.timeout(10_000)` (10s) để tránh hang.

### IPC design — tại sao `rotate` không return username/password
Proxy credential (`user:pass`) là bí mật — nếu renderer có thể đọc raw thì có thể leak qua logs/DevTools. Renderer chỉ cần `host:port` để hiển thị "đang dùng proxy nào". Main process (Epic 3.3) sẽ dùng full `ProxyInfo` (kể cả user/pass) để inject vào Playwright BrowserContext — không qua renderer.

### Folder structure (architecture.md L1826-1827)
```
automation-desktop/src/main/
├── proxy/
│   ├── proxy-service.ts         ← NEW
│   ├── index.ts                 ← NEW (barrel)
│   └── providers/
│       └── proxyfb.ts           ← NEW (3.0); tmproxy.ts (9.3); shoplike.ts (10.3)
```

### Files cần UPDATE
| File | Thay đổi |
|---|---|
| `src/main/db/client.ts` | Thêm bảng `proxy_configs` |
| `src/shared/ipc-schemas/index.ts` | Thêm 3 entry registry |
| `src/main/adapters/electron-bootstrap.ts` | Wire proxyService + registerProxyHandlers |
| `src/renderer/src/App.tsx` | Thêm `<ProxyView />` vào MainShell |

### Patterns từ Epic 2 (giữ nhất quán)
- `createProxyService(deps)` → factory function (như `createProfileService`)
- `ProxyServiceError` → mirror `ProfileServiceError` (code, message, retryable)
- `normalizeError` trong handler → nếu `ProxyServiceError` → propagate; khác → `PROXY_ERROR` retryable:false
- `registerProxyHandlers(ipcMain, service)` — KHÔNG đổi param sau này
- Barrel `proxy/index.ts` export service + error + types (rule #21)
- Smoke: thêm `PHASE3_PROXY_SMOKE` env nếu muốn test thủ công (optional)
- Renderer API: `assertOk` pattern (từ `profile-api.ts`)

### Edge cases cần xử lý
- API key rỗng/whitespace → Zod `.trim().min(1)` chặn ở IPC; `configSet` cũng validate trước `storage.set`.
- `getProxy` trả response không phải JSON → parse throw → catch → fallback/throw.
- `proxy` field format thiếu `:` → split < 4 parts → throw format error.
- Port không phải số nguyên hợp lệ (> 0, < 65536) → throw.
- Mạng timeout (API proxyfb down) → `AbortController` 10s → catch → throw `PROXY_UNAVAILABLE` retryable:true.
- Key đã lưu, gọi `configGet` → chỉ trả `{ configured: true }` (không trả key).
- Gọi `rotate` khi không có key → `PROXY_NOT_CONFIGURED` retryable:false.

### Scope — KHÔNG làm
- KHÔNG làm health-check / circuit-breaker (Story 3.2).
- KHÔNG làm bind proxy per session (Story 3.3 — ProxyInfo sẽ được dùng ở đó).
- KHÔNG thêm provider tmproxy/shoplike (Epic 9.3/10.3).
- KHÔNG implement proxy pool / assignment (3.3).
- KHÔNG dùng proxy cho automation run (cần Epic 4 trước).
- KHÔNG lưu username/password proxy vào SQLite hay trả về renderer.

### References
- [Source: epics-phase3.md#Story-3.1 (L314-326)] — AC gốc
- [Source: prd-phase3.md#FR24 (L376)] — proxy multi-provider
- [Source: architecture.md#L1826-1827] — proxy folder structure
- [Source: architecture.md#L912, FR-P3-08] — proxy rotation provider
- [Source: automation-facebook/SST_TOOL_FB/Tech_Meta/proxyfb.cs] — C# API logic gốc
- [Source: src/main/profile/profile-service.ts] — factory pattern + ServiceError
- [Source: src/main/ipc/profile-handlers.ts] — handler + normalizeError pattern
- [Source: src/shared/ipc-schemas/index.ts] — channelRegistry pattern
- [Source: src/main/db/client.ts] — DB schema append
- [Source: automation-desktop/CLAUDE.md (25 rules)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
