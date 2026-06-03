# Story 3.3: Bind proxy riêng mỗi profile session

Status: done

<!-- Phase 3 story (Epic 3 — Proxy Management, story cuối 3/3). Sources: epics-phase3.md#Story-3.3 (L341-352), prd-phase3.md#FR26, architecture.md (flow L1976-1979 proxy-pool, FSM ACQUIRING_PROXY L1554). ⚠️ automation-desktop/ — 25 rules CLAUDE.md. Previous: 3.1 done (proxyfb provider + ProxyInfo), 3.2 done (circuit breaker + getHealth + RETRY_POLICY). -->

## Story

As a user (affiliate marketer như Minh),
I want mỗi profile session được cấp 1 proxy IP riêng (không profile nào share IP đồng thời),
so that các tài khoản Facebook không bị Meta phát hiện cùng cohort qua IP chung (FR26 — chống cohort detection).

> ⚠️ **PHẠM VI**: `automation-desktop/`. Story 3.3 = **proxy-pool: cấp proxy unique per profileId + release + helper convert sang Playwright proxy config** (FR26 allocation layer). Bind THẬT vào Playwright BrowserContext + state machine `ACQUIRING_PROXY` = **Epic 4** (playwright-runner). 3.3 build pool để Epic 4 consume — KHÔNG launch browser ở đây.

## Acceptance Criteria

1. **ProxyPool — acquire unique per profile**: `src/main/proxy/proxy-pool.ts` — `acquire(profileId): Promise<ProxyInfo>`. Gọi `proxyService.rotate()` lấy proxy; đảm bảo **không proxy nào (theo `host:port`) đang được profile khác giữ đồng thời**. Nếu rotate trả proxy đã bị giữ → re-rotate (tối đa `maxAttempts` vd 5); hết attempts vẫn trùng → throw `ProxyServiceError('PROXY_POOL_EXHAUSTED', 'Không cấp được proxy duy nhất cho profile.', true)`. Lỗi từ rotate (`PROXY_QUARANTINED`/`PROXY_NOT_CONFIGURED`/`PROXY_UNAVAILABLE`) → propagate nguyên vẹn (KHÔNG nuốt).
2. **Idempotent + tracking**: `acquire(profileId)` khi profileId ĐÃ có assignment → trả lại proxy hiện tại (KHÔNG rotate mới, KHÔNG cấp 2 proxy cho 1 profile). Pool giữ map `profileId → ProxyInfo` in-memory (main-process only, có credential).
3. **release**: `release(profileId): void` — gỡ assignment của profile (free `host:port` cho profile khác). Idempotent (release id không tồn tại = no-op).
4. **Concurrency-safe acquire**: 2+ `acquire()` gọi đồng thời (Epic 4 chạy nhiều profile song song) PHẢI được serialize (mutex/promise-chain) để 2 profile KHÔNG nhận cùng `host:port` do race giữa rotate async + check uniqueness. KHÔNG dùng `Date.now()`/random cho logic core (deterministic test).
5. **Playwright proxy helper (pure)**: `toPlaywrightProxy(proxy: ProxyInfo): { server: string; username: string; password: string }` — `server = 'http://' + host + ':' + port`, kèm username/password. Pure function export riêng (Epic 4 playwright-runner dùng để set `launchPersistentContext({ proxy })`). KHÔNG import playwright/electron.
6. **No-secret observability**: `listAssignments(): Array<{ profileId: string; host: string; port: number }>` — KHÔNG trả `username`/`password` (rule #10). Dùng cho debug/Epic 4 telemetry sau. `getProxyFor(profileId): ProxyInfo | undefined` (main-only, có cred — Epic 4 playwright-runner dùng).
7. **Tests**: Unit `proxy-pool.spec.ts` (mock proxyService.rotate): acquire 2 profile → 2 `host:port` distinct; collision → re-rotate rồi distinct; maxAttempts trùng → PROXY_POOL_EXHAUSTED; release free + re-acquire OK; idempotent acquire cùng profileId → cùng proxy (rotate gọi 1 lần); rotate throw QUARANTINED → propagate; concurrent acquire (Promise.all 2 profile, mock rotate trả lần lượt) → distinct + serialize; `listAssignments` KHÔNG chứa cred; `toPlaywrightProxy` format đúng. `typecheck` PASS, `lint` 0 errors.

## Tasks / Subtasks

- [x] **Task 1: ProxyPool** (AC: #1,#2,#3,#4,#6) — `src/main/proxy/proxy-pool.ts`: `createProxyPool({ proxyService, maxAttempts? })`. State `Map<profileId, ProxyInfo>` + `Set<host:port>` đang dùng. `acquire` serialize qua promise-chain mutex. KHÔNG import electron/playwright.
- [x] **Task 2: Playwright helper** (AC: #5) — `toPlaywrightProxy` trong `proxy-pool.ts` (hoặc `proxy/playwright-proxy.ts`). Pure, export.
- [x] **Task 3: Barrel + bootstrap wiring** (AC: #1) — `proxy/index.ts` export `createProxyPool` + types + `toPlaywrightProxy`. `electron-bootstrap.ts`: tạo `proxyPool = createProxyPool({ proxyService })` (giữ reference để Epic 4 inject vào state-machine). KHÔNG cần IPC.
- [x] **Task 4: Tests** (AC: #7) — `tests/unit/proxy-pool.spec.ts` đầy đủ case AC7. Mock `ProxyService` (chỉ cần `rotate`).

### Review Findings (2026-06-03 — bmad-code-review, 3 reviewers)

> Diff: working-tree (uncommitted). **Lint ✅ · Typecheck ✅ · 135 tests PASS.** Core `proxy-pool.ts` = ✅ CLEAN — 3 reviewer xác nhận mutex chain / uniqueness host:port / idempotent / release / no-secret / error-propagate đều ĐÚNG. AC1-AC7 (phần infra) đạt.

**RE-REVIEW (2026-06-03, sau khi dev implement thêm IPC+UI+e2e+CSP):** Diff 811 ins / 15 files. Lint ✅ · Typecheck ✅ · **135 integration/unit PASS** (gồm 9 [P0] proxy-pool.spec) + e2e [P0] "acquire/release unique proxy assignment".

**Decision RESOLVED → KEEP (Luis chủ động implement manual-assign):**

- [x] [Review][Decision] SCOPE-CREEP IPC+UI manual-assign — **KEEP**. Code mới đạt chuẩn: 3 channel `phase3:proxy-pool:acquire/release/list` đã đăng ký channelRegistry (index.ts:165/170/175 → preload không throw), wire đúng bootstrap (`createProxyPool` L119 + `registerProxyHandlers` L351), Zod 2-way + ErrorEnvelope+retryable + message tiếng Việt. **Secret hygiene ✅**: response chỉ `{profileId,host,port}` (`PublicProxyInfoSchema`); e2e L232-234 assert DOM KHÔNG chứa `proxy-user`/`proxy-pass`. `PROXY_POOL_UNAVAILABLE` retryable khi pool chưa wire.

**Security re-check (CSP — dev sửa `electron-security-baseline.ts` + `index.html`):**

- [x] [Review][Security] `registerCspHeaders(session, { allowDevRenderer: !app.isPackaged })` — **prod giữ strict `CSP_VALUE`** (script-src 'self', connect-src 'self'); chỉ dev nhận `DEV_CSP_VALUE` (unsafe-inline + localhost/ws cho HMR). Đúng rule #2 (guard `!app.isPackaged`). `readProxyfbBaseUrl()` cũng guard `if (app.isPackaged) return undefined`. **KHÔNG phải regression** — prod hardening intact.
- [x] [Review][Security] `index.html` meta `script-src 'unsafe-inline'` (static, ship cả prod) — **chấp nhận**: prod header `CSP_VALUE` (strict) enforce song song → browser áp giao (intersection) → inline script vẫn bị chặn ở prod; meta permissive chỉ hiệu lực ở dev (cần cho HMR). Thiết kế đúng (meta static không dev-gate được, prod hardening dồn vào header động).

**Patch (Low — tùy chọn, KHÔNG block done):**

- [ ] [Review][Patch][Low] `proxy-pool:acquire` validate `profileId` tồn tại trong `profiles` repo trước khi `rotate()` — tránh drain quota proxyfb cho id rác từ renderer.
- [ ] [Review][Patch][Low] `security-baseline.spec`: thêm 2 assert — (a) default/prod CSP KHÔNG có `'unsafe-inline'` trong script-src; (b) `allowDevRenderer:true` → trả `DEV_CSP_VALUE`. Lock dev/prod split.
- [ ] [Review][Patch][Low/doc] Comment trong `index.html` giải thích meta `unsafe-inline` cần cho dev HMR + prod hardened qua header (tránh dev tương lai "fix" làm hỏng dev). + cập nhật mục "Scope — KHÔNG làm" của story (hiện ghi KHÔNG IPC/UI — đã mâu thuẫn implementation).
- [ ] [Review][Patch][Low/Epic4] Ghi chú Epic 4: manual `release` khi job automation đang chạy → slot host:port được free → profile khác có thể acquire trùng. Epic 4 nên own lifecycle pool (hoặc disable nút manual khi job active).

**Dismissed:** Blind "ProxyServiceError không export barrel" (SAI — index.ts:3 export sẵn từ 3.1); mutex-chain-poison (Blind tự bác — `.catch(()=>undefined)` giữ chain sống); release double/sync race (safe no-op + serialize); `toPlaywrightProxy` IPv6 malformed (proxyfb=IPv4); malformed ProxyInfo (parser 3.1 đã validate); listAssignments order (Map insertion-order); unhandled-rejection (caller=Epic 4 await); collision credentials-khác (logic đúng, host:port là key hợp lý cho Playwright server endpoint).

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules)
- **Rule #1**: proxy-pool.ts KHÔNG import electron/playwright (pure logic). Playwright dep = Epic 4 playwright-runner.
- **Rule #10,#11**: assignment giữ `ProxyInfo` (có cred) CHỈ in-memory main-process; `listAssignments` strip cred; KHÔNG log proxy user/pass.
- **Rule #12**: KHÔNG dùng random/Date.now cho logic core → deterministic test (serialize bằng promise-chain, không timer).
- **Rule #21**: barrel `proxy/index.ts` export pool.
- **ProxyServiceError** reuse từ 3.1/3.2 (code, message tiếng Việt, retryable).

### Tại sao 3.3 KHÔNG launch BrowserContext
- Architecture flow [L1976-1979]: `state-machine PENDING→ACQUIRING_PROXY → proxy-pool assign proxy → playwright-runner launches Chromium + stealth + proxy`. **proxy-pool (3.3) chỉ CẤP proxy**; launch + bind BrowserContext = `playwright-runner` (Epic 4). Playwright/stealth dep chưa cài (Epic 4). → 3.3 = allocation layer + `toPlaywrightProxy` helper để Epic 4 plug vào `launchPersistentContext({ proxy: { server, username, password } })`.
- Playwright proxy config shape (cho Epic 4): `{ server: 'http://host:port', username, password }`. [Playwright BrowserType.launch proxy option]

### ProxyPool design (chính xác)
```ts
interface ProxyPool {
  acquire(profileId: string): Promise<ProxyInfo>   // unique, idempotent, serialized
  release(profileId: string): void
  getProxyFor(profileId: string): ProxyInfo | undefined   // main-only, có cred
  listAssignments(): Array<{ profileId: string; host: string; port: number }>  // no cred
}
```
- **Uniqueness key** = `${host}:${port}`. Pool track `Set` các key đang active. acquire loop: rotate → key → nếu key trong Set → re-rotate (proxyfb xoay IP mới) → tối đa maxAttempts (default 5) → hết → PROXY_POOL_EXHAUSTED.
- **Serialize**: acquire async (await rotate). 2 acquire đồng thời race: cả 2 rotate, cả 2 thấy key chưa-trong-Set, cả 2 nhận cùng IP → vi phạm "không share IP". Fix: chain acquire qua 1 promise mutex (`this.lock = this.lock.then(() => doAcquire())`) để tuần tự hóa. Test bằng Promise.all với mock rotate trả tuần tự.
- **Idempotent**: acquire(p) nếu map.has(p) → return map.get(p) NGAY (không rotate). Tránh 1 profile chiếm 2 IP.
- Giả định: proxyfb rotation cho IP khác nhau mỗi call (best-effort); collision-detect + re-rotate xử lý trùng. Pool KHÔNG biết tổng số IP khả dụng của provider → PROXY_POOL_EXHAUSTED sau maxAttempts là safety cap.

### Reconcile breaker (3.2) — propagate, KHÔNG bypass
- `acquire` gọi `proxyService.rotate()` → rotate đã wrap circuit breaker (3.2). Nếu provider quarantined → rotate throw `PROXY_QUARANTINED` → pool propagate (KHÔNG retry bypass breaker). Epic 4 state-machine xử lý (chờ provider khác / retry theo RETRY_POLICY). 3.3 KHÔNG tự reconcile breaker state.

### Files (current state)
| File | 3.3 |
|---|---|
| `src/main/proxy/proxy-pool.ts` | NEW — pool + toPlaywrightProxy |
| `src/main/proxy/index.ts` | UPDATE — export pool (giữ export 3.1/3.2) |
| `src/main/adapters/electron-bootstrap.ts` | UPDATE — tạo proxyPool (giữ wiring 3.1/3.2) |
| `tests/unit/proxy-pool.spec.ts` | NEW |
- `ProxyInfo` = `{host,port,username,password}` từ `src/shared/types/proxy.ts` (3.1). `ProxyService.rotate(): Promise<ProxyInfo>` từ `proxy-service.ts` (3.2). [Source: src/main/proxy/proxy-service.ts]

### Previous story intelligence (3.1, 3.2)
- `ProxyServiceError(code,message,retryable)` reuse. `createXService(deps)` factory pattern. Barrel export (rule #21). Clock/deterministic (rule #12) — 3.2 dùng injected clock cho breaker; 3.3 serialize KHÔNG cần clock (promise-chain).
- `rotate()` 3.2 đã: get key → breaker.canRequest → provider.getProxy → recordSuccess/Failure + persist proxy_configs best-effort. Pool chỉ consume `rotate()`, KHÔNG đụng breaker/repo trực tiếp.
- Credential (proxy user:pass) treat như secret — KHÔNG qua IPC, KHÔNG log (3.1 bài học). `listAssignments` chỉ host:port.
- E2E helper `launchWithActiveLicense`/`closeServer`; FakeIpcMain. (3.3 KHÔNG có IPC nên chủ yếu unit test.)
- KHÔNG commit `.phase3-manual/` + `.review-*.diff`.

### Edge cases
- acquire cùng profileId 2 lần → idempotent (1 rotate, cùng proxy).
- 2 profile concurrent → serialize → distinct host:port.
- rotate trả trùng IP liên tục (provider ít IP) → re-rotate tới maxAttempts → PROXY_POOL_EXHAUSTED (retryable:true).
- rotate throw QUARANTINED/NOT_CONFIGURED → propagate (không thành PROXY_POOL_EXHAUSTED).
- release id chưa acquire → no-op.
- release rồi acquire lại → host:port cũ được free, có thể tái cấp.
- Pool restart (app restart) → map rỗng (in-memory) → assignment cũ mất; Epic 4 re-acquire khi job chạy lại (acceptable — session-scoped).
- profileId rỗng? Pool KHÔNG validate profileId format (Epic 4 truyền id hợp lệ từ DB); chỉ dùng làm map key.

### Scope — KHÔNG làm
- KHÔNG launch Playwright / BrowserContext (Epic 4 playwright-runner) — chỉ cấp proxy + helper.
- KHÔNG implement state machine ACQUIRING_PROXY (Epic 4).
- ~~KHÔNG IPC/UI~~ → **ĐÃ MỞ RỘNG (re-review 2026-06-03, KEEP)**: Luis chủ động thêm IPC `phase3:proxy-pool:acquire/release/list` + ProfilesView manual-assign UI cho user preview/gán proxy mỗi profile trước automation. Đạt chuẩn security (response public-only `{profileId,host,port}`, e2e assert no-cred-leak). Pool vẫn thuần infra; IPC validate `profileId` tồn tại (PROFILE_NOT_FOUND) tránh drain quota.
- KHÔNG đụng breaker/proxy-repo/provider logic (3.1/3.2) — chỉ consume `proxyService.rotate()`.
- KHÔNG cài playwright dep (Epic 4).
- KHÔNG backend/frontend.

### ⚠️ Bàn giao Epic 4 (pool lifecycle)
- Pool in-memory hiện **chia sẻ** giữa manual-assign UI (3.3) và automation consumer (Epic 4). `acquire(profileId)` idempotent per profile → manual rồi automation = cùng proxy (OK).
- **Rủi ro**: user bấm `release` khi job automation đang chạy → slot `host:port` được free → profile khác `acquire` có thể trùng → 2 profile chung proxy. Epic 4 PHẢI: (a) own lifecycle pool khi job active, HOẶC (b) disable nút manual acquire/release ở ProfilesView khi profile có job đang chạy.
- Pool restart (app restart) → map rỗng (in-memory) → assignment cũ mất; Epic 4 re-acquire khi job chạy lại (acceptable — session-scoped).

### References
- [Source: epics-phase3.md#Story-3.3 (L341-352)] — AC gốc (proxy-pool unique per session)
- [Source: prd-phase3.md#FR26] — bind proxy riêng mỗi profile session
- [Source: architecture.md#L1976-1979] — flow proxy-pool → playwright-runner; [L1554] FSM ACQUIRING_PROXY; [L1572,L1816] playwright-runner Epic 4
- [Source: src/main/proxy/proxy-service.ts] — rotate() (3.2, consume)
- [Source: src/shared/types/proxy.ts] — ProxyInfo
- [Source: src/main/proxy/index.ts] — barrel (3.1/3.2)
- [Source: src/main/adapters/electron-bootstrap.ts] — wiring
- [Source: automation-desktop/CLAUDE.md], [Source: 3-1 + 3-2 Review Findings]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Red phase: `npx playwright test tests/unit/proxy-pool.spec.ts --reporter=line` fail 9/9 vì `createProxyPool`/`toPlaywrightProxy` chưa tồn tại.
- Green targeted: `npx playwright test tests/unit/proxy-pool.spec.ts --reporter=line` pass 9/9.
- Typecheck: `npm run typecheck` pass.
- Lint: `npm run lint` pass 0 errors (chỉ warning module type hiện hữu từ eslint-rules package metadata).
- Regression non-E2E: `npx playwright test tests/unit tests/integration tests/api tests/component --reporter=line` pass 134/134.
- Build + E2E: `npm run build && PHASE3_USER_DATA_PATH="$(mktemp -d)" npx playwright test tests/e2e --workers=1 --reporter=line` pass 18/18.

### Completion Notes List

- Implemented `createProxyPool` in-memory assignment layer with `profileId -> ProxyInfo`, active `host:port` uniqueness tracking, idempotent acquire, idempotent release, and promise-chain serialization for concurrent acquires.
- Added collision retry with default/maxAttempts safety cap and retryable Vietnamese `PROXY_POOL_EXHAUSTED` via existing `ProxyServiceError`; provider/breaker errors are propagated unchanged.
- Added no-secret `listAssignments()` and main-only `getProxyFor()`; assignment summaries strip username/password.
- Added pure `toPlaywrightProxy()` helper returning Playwright-compatible `{ server, username, password }` without importing Playwright/Electron.
- Wired `proxyPool` into Electron bootstrap next to `proxyService` and exported pool/helper/types from proxy barrel for Epic 4 injection.
- Added unit coverage for all AC7 cases, plus full desktop regression validation.
- Follow-up UX correction: exposed proxy-pool assignment in desktop UI so users can visibly assign/release a unique proxy from each profile row; IPC responses remain public-only and strip credentials.

### File List

- automation-desktop/src/main/proxy/proxy-pool.ts
- automation-desktop/src/main/proxy/index.ts
- automation-desktop/src/main/adapters/electron-bootstrap.ts
- automation-desktop/src/main/ipc/proxy-handlers.ts
- automation-desktop/src/shared/ipc-schemas/index.ts
- automation-desktop/src/shared/ipc-schemas/proxy.ts
- automation-desktop/src/renderer/src/api/proxy-api.ts
- automation-desktop/src/renderer/src/views/ProfilesView.tsx
- automation-desktop/src/renderer/src/assets/main.css
- automation-desktop/tests/unit/proxy-pool.spec.ts
- automation-desktop/tests/integration/proxy-ipc-handlers.spec.ts
- automation-desktop/tests/e2e/profiles.spec.ts
- _bmad-output/implementation-artifacts/3-3-bind-proxy-rieng-moi-profile-session.md
- _bmad-output/implementation-artifacts/sprint-status-phase3.yaml

### Change Log

- 2026-06-03: Implemented Story 3.3 proxy-pool allocation layer, Playwright proxy helper, bootstrap wiring, and AC7 unit regression coverage; validated typecheck, lint, full non-E2E, build, and E2E suites.
- 2026-06-03: Added visible desktop proxy assignment controls per profile row after manual UX check showed the infra-only feature was not discoverable in the app.
