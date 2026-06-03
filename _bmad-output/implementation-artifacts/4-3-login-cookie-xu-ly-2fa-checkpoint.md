# Story 4.3: Login cookie + xử lý 2FA/checkpoint

Status: done

Epic: 4 — Lõi Automation Facebook (Self-Comment MVP) · Story: 4.3 · ID: 4.3

> ⚠️ **STORY LỚN NHẤT EPIC 4 + NHẠY CẢM BẢO MẬT NHẤT.** Lần đầu launch Chromium thật (Playwright stealth) + xử lý cookie/2FA seed (R-D3). Đọc HẾT Dev Notes trước khi code. Nếu thấy quá lớn → xem mục "Tùy chọn tách story" cuối file.

## Story

As a user,
I want hệ thống login Facebook bằng cookie (và xử lý 2FA/checkpoint khi gặp),
So that automation truy cập được tài khoản mà không cần nhập mật khẩu thủ công.

## Acceptance Criteria

- **AC1 (Launch stealth)** — Given profile có cookie hợp lệ trong safeStorage + fingerprint (4.1) + proxy (3.3, optional), When state machine (4.2) vào `LOGGING_IN`, Then Playwright **stealth** (`playwright-extra` + `puppeteer-extra-plugin-stealth`) launch Chromium với proxy (nếu có) + fingerprint context options (userAgent, viewport, timezoneId), set cookie vào `.facebook.com`, navigate tới FB.
- **AC2 (Verify login qua DOM)** — Then xác định login state qua DOM marker: `LOGGED_IN` | `TWO_FA_REQUIRED` | `CHECKPOINT` | `LOGIN_FAILED` (cookie hết hạn/sai). Login success = verify DOM (vd có nav bar / không thấy form login).
- **AC3 (2FA handling)** — When DOM = `TWO_FA_REQUIRED` và profile có 2FA seed trong safeStorage, Then checkpoint-handler sinh mã TOTP (RFC 6238) từ seed, submit, re-verify DOM. Nếu pass → `LOGGED_IN`.
- **AC4 (Checkpoint blocked)** — When DOM = `CHECKPOINT` (hoặc 2FA fail/không có seed), Then transition state machine → `CHECKPOINT_BLOCKED` + gọi hook `onCheckpoint(profileId, kind)` (transport telemetry defer Epic 6). KHÔNG crash; cleanup browser.
- **AC5 (Secret hygiene — R-D3)** — Cookie + 2FA seed: lấy từ safeStorage tại exec time (`profile.<id>.<field>`), wrap `Secret<>`, reveal CHỈ tại boundary (addCookies / TOTP gen). TUYỆT ĐỐI KHÔNG log / KHÔNG qua IPC / KHÔNG ghi vào `automation_jobs.result` / KHÔNG vào error message / KHÔNG vào telemetry.
- **AC6 (Cleanup + timeout)** — Mọi nhánh (success/2FA/checkpoint/error) PHẢI đóng context + browser trong `finally` (KHÔNG leak Chromium process). Launch + navigation có timeout cứng; timeout → `LOGIN_FAILED`/error, không treo.
- **AC7 (Test coverage)** — Logic thuần (TOTP, cookie parse, detectLoginState, orchestration) có **unit test** (DI, KHÔNG launch browser thật); 1 **integration smoke** launch Chromium THẬT chống **local FB-mock fixture** (logged-in / 2FA / checkpoint variant), KHÔNG hit facebook.com thật. Lint + typecheck pass.

## Tasks / Subtasks

- [x] **T1** — `package.json`: add runtime deps `playwright` + `playwright-extra` + `puppeteer-extra-plugin-stealth` (khớp `@playwright/test ^1.60`). `npx playwright install chromium` (dev). KHÔNG cần `electron-rebuild` (Playwright Chromium là binary riêng, KHÔNG phải native node module). (AC1)
- [x] **T2** — `src/main/automation/totp.ts`: `generateTotp(base32Seed: string, atMs: number): string` — RFC 6238 (HMAC-SHA1 qua `node:crypto`, 30s step, 6 digit). Pure, inject `atMs` (KHÔNG `Date.now` trong logic). KHÔNG thêm dep TOTP ngoài. (AC3)
- [x] **T3** — `src/main/automation/cookie.ts`: `parseCookieHeader(raw: string): PlaywrightCookie[]` — split `'; '` → `{ name, value, domain: '.facebook.com', path: '/', secure: true, httpOnly: <c_user/xs=true> }`. Reject entry rỗng/sai format. (AC1)
- [x] **T4** — `src/main/automation/playwright-runner.ts`: `createPlaywrightRunner({ launchBrowser })` → `launchSession({ proxy?, fingerprint, cookies }): SessionHandle`. Apply stealth plugin TRƯỚC launch; context options từ fingerprint (userAgent/viewport/timezoneId); `addCookies`; `goto(FB_URL, { timeout })`. **`launchBrowser` injectable** (default = `playwright-extra` chromium.launch) để unit test mock. SessionHandle expose `page` + `close()`. (AC1, AC6)
- [x] **T5** — `src/main/automation/checkpoint-handler.ts`: `detectLoginState(page): Promise<LoginState>` (DOM marker) + `submitTwoFa(page, code): Promise<void>`. (AC2, AC3)
- [x] **T6** — `src/main/automation/login-service.ts`: `createLoginService({ secureStorage, runner, stateMachine, fingerprintService, now, onCheckpoint })` → `login(jobId, profileId)`: lấy cookie/2FA secret → ensureFingerprint → runner.launchSession → detectLoginState → branch (LOGGED_IN→transition WARMING_UP; TWO_FA→TOTP+submit+recheck; CHECKPOINT/fail→transition CHECKPOINT_BLOCKED + onCheckpoint) → `finally` close session. Deps dùng `Pick<>`. (AC2-AC6)
- [x] **T7** — `src/main/automation/index.ts`: APPEND export (giữ fingerprint 4.1 + state-machine 4.2). (rule #21)
- [x] **T8** — Tests:
  - `tests/unit/totp.spec.ts` — RFC 6238 test vectors (seed `GEZDGNBVGY3TQOJQ...` → mã biết trước tại timestamp cố định).
  - `tests/unit/cookie.spec.ts` — parse `c_user=...; xs=...` → cookie objects đúng domain/flags; reject rỗng.
  - `tests/unit/login-service.spec.ts` — DI mock runner/stateMachine/secureStorage: LOGGED_IN→transition WARMING_UP; CHECKPOINT→CHECKPOINT_BLOCKED+onCheckpoint; 2FA→submit→LOGGED_IN; cookie thiếu→LOGIN_FAILED; **assert KHÔNG leak secret** (mock page/log không chứa cookie/seed); **assert close() gọi ở mọi nhánh** (finally).
  - `tests/integration/login-smoke.spec.ts` + `tests/fixtures/fb-mock/{logged-in,two-fa,checkpoint}.html` — launch Chromium THẬT (local http server phục vụ mock) → detectLoginState đúng cho từng variant. (AC7)
- [x] **T9** — Verify: `npm run lint` + `npm run typecheck` + test mới PASS + full suite không giảm (baseline 153). Grep tự kiểm KHÔNG có `Date.now` trong totp logic + KHÔNG log secret.

> **D1 (defer):** KHÔNG implement self-comment action (4.6), CSRF token (4.4), per-action token (4.5), warmup behavior (state `WARMING_UP` chỉ là đích transition, logic warmup = Epic 5/4.x sau). KHÔNG IPC `automation:start`/UI (4.6). KHÔNG telemetry transport (Epic 6 — chỉ gọi `onCheckpoint` hook). 4.3 dừng ở: "đăng nhập thành công, verify DOM, sẵn sàng" HOẶC "CHECKPOINT_BLOCKED".

## Review Findings (2026-06-03 — bmad-code-review, 3-lens adversarial)

> Diff: commit `89dc7f0` (thuần 4.3). **Lint ✅ · Typecheck ✅ · 167 tests PASS** (153 + 14 mới, gồm integration smoke launch Chromium THẬT vs 3 fb-mock variant). totp PURE (no Date.now). Verdict: **APPROVE — 1 finding Medium nên fix trước done (leak browser), còn lại Low/info.**

**AC1–AC7 + guardrail trọng tâm — đạt:**
- ✅ **R-D3 (GUARDRAIL #1)** XUẤT SẮC: cookie/2FA lấy từ safeStorage tại exec, `brandSecret`, `revealSecret` CHỈ tại 2 boundary (`parseCookieHeader` + `generateTotp`). KHÔNG log statement nào trong 3 module. Unit assert `not.toContain('xs=secret')` + error msg không chứa `'proxy password secret'`. KHÔNG IPC/result/telemetry leak.
- ✅ **AC1** stealth (`chromium.use(StealthPlugin())` 1 lần) + proxy + context options (UA/viewport/timezoneId) + addCookies + goto timeout.
- ✅ **AC2/AC3** detectLoginState DOM (checkpoint→2FA→login-failed→logged-in→default) + submitTwoFa; TOTP RFC 6238 đúng (test vector + e2e code `287082`).
- ✅ **AC4** CHECKPOINT/2FA-no-seed/2FA-failed → CHECKPOINT_BLOCKED + onCheckpoint(kind); KHÔNG crash.
- ✅ **AC6** `finally session?.close()` mọi nhánh; launch-error path đóng context+browser (.catch); cookie thiếu → FAILED KHÔNG launch.
- ✅ **AC7** unit (totp RFC, cookie, login-service branch+no-leak+cleanup) + 1 integration smoke real-Chromium-vs-mock; **D1** không IPC/UI/bootstrap. Deps `Pick<>`, `nowMs` inject.

**Findings:**

- [x] [Review][Patch][Med] 🔴 **`SessionHandle.close()` leak browser nếu `context.close()` throw** (`playwright-runner.ts:77-80`). `await context?.close()` throw → `await browser.close()` KHÔNG chạy → **leak Chromium process**. login-service nuốt lỗi (`.catch(()=>undefined)`) nên leak âm thầm — đúng cái AC6 (GUARDRAIL #2) muốn chống. Fix: `try { await context?.close() } finally { await browser.close() }`. (Launch-error path đã guard đúng cả 2; chỉ success-path `close()` thiếu.)
- [x] [Review][Low] **login-service bỏ qua kết quả `transition()`** — mọi `stateMachine.transition(...)` (4.2 trả typed `{ok:false,code}` nếu invalid) bị discard. Job không ở LOGGING_IN → transition no-op âm thầm nhưng login vẫn return ok → state-machine ↔ login lệch. 4.3 OK vì caller đảm bảo LOGGING_IN, nhưng nên log (non-secret) hoặc surface khi `!ok`.
- [x] [Review][Low][stealth] **UA chưa reconcile với Chromium thật** — runner dùng `fingerprint.userAgent` (pool Chrome/120-127) làm context UA, nhưng Chromium Playwright bundle có thể version khác → UA major lệch = stealth red flag. 4.1 review + story 4.3 đều flag chỗ này. MVP chấp nhận (stealth plugin che phần lớn); fix: patch UA major theo `browser.version()` lúc launch.
- [ ] [Review][Info] webglNoise + fonts CHƯA apply vào context (chỉ UA/viewport/timezone) — story cho phép defer best-effort. Note Epic 5/follow-up cho stealth đầy đủ (addInitScript override WebGL/fonts).

**Dismissed:** module-global `stealthApplied` (idempotent, cần thiết cho `chromium.use` 1 lần); cookie `secure:true`+`sameSite:'None'` (đúng cho facebook.com HTTPS); fixture key/isPackaged (test tmpdir/tests-only); cookie injection (structured objects, không build string).

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules) + `automation-desktop/project-context.md`

### 🔴 GUARDRAIL #1 — Secret hygiene (R-D3) — QUAN TRỌNG NHẤT

Cookie + 2FA seed là secret tối mật. Sai = lộ tài khoản user.
- **Lấy tại exec time** từ safeStorage qua adapter: `secureStorage.get('profile.${id}.cookie')` + `secureStorage.get('profile.${id}.twofa')`. Convention `profile.<id>.<field>` (xem `profile-service.ts:60` — cân nhắc extract `secretKey()` ra shared helper để DRY, hoặc copy convention).
- **Wrap `Secret<string>`** (`brandSecret` từ `src/shared/types/secret.ts`), **reveal CHỈ** tại 2 boundary: (a) cookie → `context.addCookies(parse(revealSecret(cookie)))`, (b) 2FA → `generateTotp(revealSecret(seed), atMs)`.
- 🚫 TUYỆT ĐỐI KHÔNG: log cookie/seed (qua `redact()` nếu phải log gì đó — rule #11), đưa vào IPC payload (rule #10), ghi vào `automation_jobs.result` (R-D3 — 4.2 đã comment cấm), đưa vào `onCheckpoint`/telemetry, đưa vào error message.
- Cookie ở RAM ngắn nhất có thể; KHÔNG giữ reference sau khi `addCookies`.

### 🔴 GUARDRAIL #2 — Cleanup + timeout (AC6) — chống leak Chromium

```ts
const session = await runner.launchSession({ ... })
try {
  // detect / 2FA / branch
} finally {
  await session.close()   // đóng context + browser MỌI nhánh, kể cả throw
}
```
- Playwright launch + `goto` đặt `timeout` cứng (vd 30s). Timeout → coi như `LOGIN_FAILED`, KHÔNG treo job.
- Architecture: "Bundled Chromium hang → hard timeout + restart". Job treo = leak process = máy user đầy RAM.

### Stack & deps (T1)

- **Runtime**: `playwright` (core) + `playwright-extra` + `puppeteer-extra-plugin-stealth`. Khớp version với `@playwright/test ^1.60`.
  ```ts
  import { chromium } from 'playwright-extra'
  import StealthPlugin from 'puppeteer-extra-plugin-stealth'
  chromium.use(StealthPlugin())   // áp TRƯỚC launch
  ```
- ⚠️ KHÔNG dùng Playwright `electron` namespace (đó để test Electron app — architecture L1081/L1154). Runtime automation dùng `chromium` từ playwright-extra.
- ⚠️ `electron-rebuild` KHÔNG áp cho Playwright Chromium (binary riêng do Playwright quản lý, không phải `.node` native module). Chỉ `better-sqlite3*` cần rebuild (rule #23). Dev: `npx playwright install chromium`. Production bundle Chromium = Epic 8 (defer).
- TOTP: **KHÔNG thêm dep** (`otplib`/`speakeasy`) — implement RFC 6238 ~30 dòng bằng `node:crypto` (`createHmac('sha1', base32decode(seed))`). Test bằng RFC test vector.

### Apply fingerprint (4.1) vào context

- **Native context options** (set được trực tiếp): `userAgent`, `viewport: {width,height}`, `timezoneId` (= fingerprint.timezone). Set khi `browser.newContext(...)`.
- **webglNoise + fonts**: cần `page.addInitScript` (advanced override navigator/WebGL) — **best-effort, có thể defer** chi tiết noise injection sang follow-up; 4.3 tối thiểu apply UA/viewport/timezone (native). Ghi note nếu defer webgl/fonts.
- ⚠️ Cross-check 4.1 finding: UA `Chrome/<major>` phải khớp Chromium Playwright bundle. Nếu lệch → stealth detect. Có thể patch UA major theo version Chromium thật lúc launch (đây là chỗ reconcile mà 4.1 đã flag).

### Login orchestration (T6) — consume 4.1/4.2/3.3

```
login(jobId, profileId):
  cookie = Secret(secureStorage.get(profile.<id>.cookie))   // thiếu → LOGIN_FAILED (cookie bắt buộc)
  seed   = Secret(secureStorage.get(profile.<id>.twofa))    // optional
  fp = fingerprintService.ensureFingerprint(profileId)       // 4.1
  proxy = (optional) proxyPool.acquire/getProxyFor → toPlaywrightProxy   // 3.3 — nếu wire; 4.3 có thể chạy không proxy nếu chưa cấu hình
  session = runner.launchSession({ proxy, fingerprint: fp, cookies: parse(reveal(cookie)) })
  try:
    state = detectLoginState(session.page)
    if TWO_FA && seed: submitTwoFa(totp(reveal(seed), now())); state = detectLoginState(...)
    if LOGGED_IN: stateMachine.transition(jobId, 'WARMING_UP'); return {ok, state:'LOGGED_IN'}
    else: stateMachine.transition(jobId, 'CHECKPOINT_BLOCKED'); onCheckpoint(profileId, kind); return {ok, state}
  finally: session.close()
```
- State machine 4.2: trước khi login, job phải ở `LOGGING_IN` (caller transition PENDING→ACQUIRING_PROXY→LOGGING_IN). 4.3 từ LOGGING_IN → WARMING_UP (success) hoặc CHECKPOINT_BLOCKED. Dùng `transition()` 4.2 (typed result; nếu invalid → lỗi logic, log không-secret).
- `now` inject (timestamp cho TOTP + state). Deps `Pick<>`.
- proxy: nếu 3.3 proxy-pool chưa wire vào automation, 4.3 có thể launch KHÔNG proxy (note defer wiring proxy→login sang 4.6 hoặc làm optional). Đừng block 4.3 vì proxy.

### detectLoginState (T5) — DOM marker (sẽ tinh chỉnh ở Epic 5 selector-resolver)

- `LOGGED_IN`: có marker đã đăng nhập (vd `[role=navigation]`, hoặc absence của login form `input[name=email]`). 
- `TWO_FA_REQUIRED`: `input[name=approvals_code]` hoặc marker 2FA.
- `CHECKPOINT`: URL chứa `/checkpoint/` hoặc marker checkpoint.
- `LOGIN_FAILED`: thấy login form (cookie hết hạn).
- ⚠️ Selector FB dễ đổi → Epic 5 (4-tier selector-resolver) sẽ thay. 4.3 hardcode selector đơn giản + note "fragile, Epic 5 thay". Test bằng mock fixture (selector ổn định trong fixture).

### Testability (T8) — KHÔNG hit FB thật

- **Unit (đa số logic)**: DI `launchBrowser` → fake trả fake `page` (object có `goto`/`$`/`url`/`fill`/`click` stub). Test orchestration/branch/cleanup/secret-no-leak KHÔNG cần Chromium.
- **Integration smoke (1 test)**: launch Chromium THẬT chống `tests/fixtures/fb-mock/*.html` phục vụ qua local http server (pattern như proxy tests dùng local server). 3 fixture: `logged-in.html` (có nav marker), `two-fa.html` (`input[name=approvals_code]`), `checkpoint.html` (`/checkpoint/` path hoặc marker). Verify `detectLoginState` trả đúng. KHÔNG test 2FA-submit-to-real-FB (chỉ verify submitTwoFa fill+click trên mock).
- ⚠️ **CI**: launch Chromium nặng/chậm/dễ flaky. Integration smoke nên `[P1]` + timeout rộng + headless. Cân nhắc tag riêng để CI desktop chạy. Đa số coverage dồn vào unit (DI).

### Edge cases

- Cookie thiếu/rỗng trong safeStorage → `LOGIN_FAILED` (cookie bắt buộc), KHÔNG launch browser (tiết kiệm). transition CHECKPOINT_BLOCKED? Hay FAILED? → cookie thiếu = lỗi cấu hình → `FAILED` (không phải checkpoint). Phân biệt rõ: CHECKPOINT_BLOCKED = FB chặn; FAILED = lỗi hệ thống/cookie.
- 2FA required nhưng KHÔNG có seed → CHECKPOINT_BLOCKED + onCheckpoint(profileId, 'two_fa_no_seed').
- Browser launch throw (Chromium missing/proxy unreachable) → catch → transition FAILED (không phải checkpoint) + finally cleanup.
- Navigation timeout → LOGIN_FAILED hoặc FAILED + cleanup.
- TOTP: seed base32 sai format → throw có kiểm soát → CHECKPOINT_BLOCKED (không log seed).
- Multiple cookies cùng name → giữ cuối (hoặc reject); FB cookie thường unique name.

### Scope — KHÔNG làm

- KHÔNG self-comment / action execution (4.6); KHÔNG CSRF token (4.4); KHÔNG per-action token (4.5).
- KHÔNG warmup behavior logic (chỉ transition tới WARMING_UP); KHÔNG IPC/UI (4.6); KHÔNG telemetry transport (Epic 6 — chỉ `onCheckpoint` hook).
- KHÔNG selector hot-config 4-tier (Epic 5 — 4.3 hardcode selector + note fragile).
- KHÔNG wire proxy-pool bắt buộc (optional; có thể defer proxy→login wiring 4.6).
- KHÔNG production Chromium bundling (Epic 8).
- 🚫 KHÔNG lưu/log/transmit cookie/2FA seed ngoài boundary (R-D3).

### Files

| File | Action | Ghi chú |
|---|---|---|
| `package.json` | UPDATE | + playwright, playwright-extra, puppeteer-extra-plugin-stealth |
| `src/main/automation/totp.ts` | NEW | RFC 6238 qua node:crypto (no dep) |
| `src/main/automation/cookie.ts` | NEW | parseCookieHeader → Playwright cookies |
| `src/main/automation/playwright-runner.ts` | NEW | launchSession (stealth + DI launchBrowser + cleanup) |
| `src/main/automation/checkpoint-handler.ts` | NEW | detectLoginState + submitTwoFa |
| `src/main/automation/login-service.ts` | NEW | orchestrate (consume 4.1/4.2/3.3 + secret) |
| `src/main/automation/index.ts` | UPDATE | APPEND exports |
| `tests/unit/totp.spec.ts` | NEW | RFC vectors |
| `tests/unit/cookie.spec.ts` | NEW | parse |
| `tests/unit/login-service.spec.ts` | NEW | orchestration + secret-no-leak + cleanup |
| `tests/integration/login-smoke.spec.ts` | NEW | real Chromium vs local mock |
| `tests/fixtures/fb-mock/*.html` | NEW | logged-in / two-fa / checkpoint |
| ~~`automation-handlers` / UI / bootstrap wire~~ | — | DEFER 4.6 (D1) |

### Previous story intelligence (4.1 / 4.2 / 3.x)

- **4.1**: `ensureFingerprint(profileId)` → consume cho context options. Service deps dùng `Pick<>`. Clock inject. UA↔Chromium reconcile (flag 4.1) — chỗ giải quyết là ĐÂY (4.3 launch).
- **4.2**: `createStateMachine` + `transition(jobId, to)` typed result. 4.3 từ LOGGING_IN → WARMING_UP/CHECKPOINT_BLOCKED. `result` cấm secret.
- **3.3**: `proxyPool.acquire`/`toPlaywrightProxy` → proxy cho launch (optional).
- **secure-storage adapter**: `get/set/delete(key)` Promise. Secret key `profile.<id>.<field>`.
- **integration test pattern**: 4.1/4.2 dùng esbuild-fixture electron-entry; 3.x dùng `_electron.launch` + local http server. 4.3 integration cần **local http server phục vụ mock HTML** (như 3.x proxy) + launch Chromium → chọn pattern phù hợp, đừng tạo pattern thứ 4.
- **153 test đang PASS** — đừng phá.

### Testing chi tiết (AC7) — tóm tắt ở T8

Trọng tâm: **unit phủ logic** (TOTP RFC vectors, cookie parse, branch orchestration, secret-no-leak, finally-cleanup) + **1 integration smoke** real-Chromium-vs-mock cho detectLoginState. KHÔNG hit facebook.com.

## References

- [Source: epics-phase3.md#Story-4.3 (L386-401)] — AC gốc
- [Source: epics-phase3.md#FR-P3-05] — Cookie-based login + 2FA bypass qua Playwright stealth
- [Source: architecture.md (L946-947,1080-1081,1153-1154,1189-1193)] — Playwright + playwright-extra + stealth; KHÔNG dùng electron namespace
- [Source: architecture.md#R-D3 (L978-979)] — Cookie & 2FA seed CHỈ safeStorage, Secret marker, redaction
- [Source: architecture.md (L924,1303-1313)] — safeStorage at rest, defense in depth
- [Source: architecture.md (L1814)] — playwright-runner.ts, checkpoint-handler.ts
- [Source: architecture.md (L1024-1025)] — Playwright/Chromium hang → hard timeout + restart
- [Source: src/main/profile/profile-service.ts:60] — secret key convention `profile.<id>.<field>`
- [Source: src/shared/types/secret.ts] — Secret<T> / brandSecret / revealSecret
- [Source: src/adapters/secure-storage.ts] — get/set/delete
- [Source: src/main/automation/fingerprint-service.ts (4.1) + state-machine.ts (4.2) + proxy/proxy-pool.ts (3.3)] — consume
- [Source: automation-desktop/CLAUDE.md + project-context.md] — 25 rules

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `python3 _bmad/scripts/resolve_customization.py --skill .agents/skills/bmad-dev-story --key workflow`
- `npm install playwright@^1.60.0 playwright-extra puppeteer-extra-plugin-stealth`
- `npx playwright install chromium`
- Red phase: `npx playwright test tests/unit/totp.spec.ts tests/unit/cookie.spec.ts tests/unit/login-service.spec.ts tests/integration/login-smoke.spec.ts --reporter=line` — failed before exports/implementation existed
- Green phase: same new-test command — `12 passed (1.6s)`
- `npm run lint` — pass, 0 errors (existing MODULE_TYPELESS_PACKAGE_JSON warning only)
- `npm run typecheck` — pass
- `rg -n "Date\.now|console\.|logger\.|cookie|twofa|seed" src/main/automation tests/unit/login-service.spec.ts` — verified no `Date.now` in TOTP and no automation logging; hits are boundary/test references only
- `npx playwright test tests/unit tests/integration --reporter=line` — `165 passed (15.6s)`
- `npx playwright test --reporter=line` — `186 passed (25.7s)`
- Review patch validation: `npx playwright test tests/unit/login-service.spec.ts --reporter=line` — `6 passed (838ms)`
- Review patch validation: `rg -n "try \{|finally \{|browser.close|reconcileUserAgentWithBrowser|onTransitionError|transitionJob" automation-desktop/src/main/automation/playwright-runner.ts automation-desktop/src/main/automation/login-service.ts` — confirmed F1 try/finally, F2 transition hook, F3 UA reconcile points
- Review patch validation: `npm run lint` — pass, 0 errors (existing MODULE_TYPELESS_PACKAGE_JSON warning only)
- Review patch validation: `npm run typecheck` — pass
- Review patch validation: `npx playwright test tests/unit tests/integration --reporter=line` — `167 passed (5.7s)`

### Completion Notes List

- Added runtime Playwright stealth dependencies and installed Chromium for local/dev smoke execution; no native rebuild required.
- Implemented pure RFC 6238 TOTP generation with injected timestamp and no external TOTP dependency.
- Implemented Facebook cookie header parser to Playwright cookie objects with domain/path/secure/httpOnly flags and malformed-entry rejection.
- Implemented Playwright runner with stealth plugin, injectable launch function, fingerprint context options, cookie injection, navigation timeout, and guaranteed browser/context cleanup on launch errors.
- Implemented DOM login detection and 2FA submission helpers using stable mockable selectors.
- Implemented login service orchestration: safeStorage exec-time secret fetch, Secret<> wrapping/reveal only at addCookies/TOTP boundaries, fingerprint ensure, branch handling for LOGGED_IN/TWO_FA_REQUIRED/CHECKPOINT/LOGIN_FAILED, state-machine transitions, onCheckpoint hook, and finally cleanup.
- Added unit tests for TOTP, cookie parsing, login orchestration/cleanup/secret hygiene, plus real Chromium integration smoke against local FB mock fixtures.
- Scope respected: no self-comment, CSRF/per-action token, warmup behavior, IPC/UI, telemetry transport, or mandatory proxy-pool wiring.
- Applied review F1: hardened `SessionHandle.close()` with `try/finally` so `browser.close()` still runs when `context.close()` rejects.
- Applied review F2: added non-secret `onTransitionError` hook and routed login-service state transitions through a wrapper that surfaces invalid transition results without changing behavior or throwing.
- Applied review F3: reconciled fingerprint UA Chrome major with real launched Chromium `browser.version()` before creating the context.
- Updated login-service unit coverage in the existing missing-cookie test to verify invalid transition surfacing without adding test count.

### File List

- `_bmad-output/implementation-artifacts/4-3-login-cookie-xu-ly-2fa-checkpoint.md`
- `_bmad-output/implementation-artifacts/sprint-status-phase3.yaml`
- `automation-desktop/package.json`
- `automation-desktop/package-lock.json`
- `automation-desktop/src/main/automation/totp.ts`
- `automation-desktop/src/main/automation/cookie.ts`
- `automation-desktop/src/main/automation/playwright-runner.ts`
- `automation-desktop/src/main/automation/checkpoint-handler.ts`
- `automation-desktop/src/main/automation/login-service.ts`
- `automation-desktop/src/main/automation/index.ts`
- `automation-desktop/tests/unit/totp.spec.ts`
- `automation-desktop/tests/unit/cookie.spec.ts`
- `automation-desktop/tests/unit/login-service.spec.ts`
- `automation-desktop/tests/integration/login-smoke.spec.ts`
- `automation-desktop/tests/fixtures/fb-mock/logged-in.html`
- `automation-desktop/tests/fixtures/fb-mock/two-fa.html`
- `automation-desktop/tests/fixtures/fb-mock/checkpoint.html`

### Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-06-03 | 0.1 | Story created (bmad-create-story) — playwright stealth login cookie + 2FA/checkpoint | Luisphan |
| 2026-06-03 | 1.0 | Implemented Playwright stealth login skeleton, TOTP/cookie/checkpoint handling, secret-safe orchestration, and test coverage | GPT-5 Codex |
| 2026-06-03 | 1.1 | Applied review findings F1/F2/F3: close try/finally, transition result observability, UA major reconciliation | GPT-5 Codex |
