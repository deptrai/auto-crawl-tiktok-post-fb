# Story 5.5: Tự giải checkpoint CAPTCHA (FunCaptcha/reCAPTCHA)

Status: review

Epic: 5 — Khả năng Tự phục hồi (Adaptive Resilience) · Story: 5.5 · ID: 5.5

> ⚠️ **STORY NHẠY CẢM: external API + chi phí thật + secret (proxy credential) ra bên thứ 3.** Đọc HẾT Dev Notes + GUARDRAILS trước khi code. Companion kiến trúc: `architecture.md` § "Phase 3 Addendum — Checkpoint Auto-Solver" (ADR-P3-D12 → D16).
> 🔗 **Phụ thuộc Story 5.6** (cấu hình API key) cho path production thật, nhưng 5.5 KHÔNG block bởi 5.6: solver nhận API key + flag qua dependency injection; nếu thiếu key/flag OFF → fallback hành vi cũ (CHECKPOINT_BLOCKED). Implement 5.5 độc lập với DI, 5.6 wire UI sau.

## Story

As a user,
I want hệ thống tự giải checkpoint CAPTCHA giải được (FunCaptcha/reCAPTCHA v2) thay vì đánh dấu account chết ngay,
So that account dính checkpoint vẫn có cơ hội login tiếp thay vì mất trắng.

## Acceptance Criteria

- **AC1 (Phân loại checkpoint)** — Given login (Story 4.3) phát hiện DOM state `CHECKPOINT`, When `detectCheckpointType(page)` chạy, Then phân loại thành `FUNCAPTCHA` | `RECAPTCHA_V2` | `OTP` | `IDENTITY` | `UNKNOWN` dựa trên DOM marker. CHỈ `FUNCAPTCHA` + `RECAPTCHA_V2` coi là giải được (ADR-P3-D12); `OTP`/`IDENTITY`/`UNKNOWN` → fallback `CHECKPOINT_BLOCKED` ngay (giữ nguyên hành vi Story 4.3).
- **AC2 (Gate: flag + key)** — Given checkpoint loại giải được, When feature flag `captcha.solver.enabled` ≠ `'true'` HOẶC không có API key provider nào trong safeStorage, Then KHÔNG gọi solver, fallback `CHECKPOINT_BLOCKED` (mặc định OFF — ADR-P3-D15). Solver chỉ chạy khi flag ON **và** có ít nhất 1 API key.
- **AC3 (Extract params)** — Given checkpoint giải được + gate pass, When extract params từ DOM, Then lấy được `publicKey` (FunCaptcha, pattern `pk_...`) hoặc `siteKey` (reCAPTCHA, `data-sitekey`), kèm `websiteUrl` + `blob`/`subdomain` (nếu có). Nếu KHÔNG tìm thấy key bắt buộc → trả `PARAMS_NOT_FOUND` → fallback `CHECKPOINT_BLOCKED` (KHÔNG gọi API vô ích).
- **AC4 (Solve + provider fallback)** — Given có params, When gọi solver, Then thử CapSolver trước (primary); nếu lỗi/timeout/hết credit → thử 2captcha (fallback) (ADR-P3-D13). Mỗi provider: createTask → poll tới khi có token hoặc timeout. Cả 2 fail → tính 1 lần fail (AC6).
- **AC5 (Proxy binding)** — Given profile có proxy (Story 3.3), When tạo solver task, Then truyền proxy của profile vào task để token khớp IP session (ADR-P3-D14). Profile không proxy → ProxyLess (best-effort). Proxy credential CHỈ truyền tại thời điểm solve, KHÔNG log.
- **AC6 (State machine + inject + re-verify)** — Given solver trả token, When inject token vào page + re-verify bằng `detectLoginState()`, Then: state machine vào `SOLVING_CHECKPOINT` trước khi solve; `LOGGED_IN` sau re-verify → transition `WARMING_UP` (hoặc `LOGGED_IN` ok cho path adapter); còn checkpoint → đếm fail. **Circuit breaker: cùng 1 profile fail 2 lần → `CHECKPOINT_BLOCKED`, ngừng thử** (ADR-P3-D15).
- **AC7 (Budget cap)** — Given 1 phiên bulk run, When tổng số lần solve đã thực hiện ≥ 10, Then các checkpoint còn lại fallback `CHECKPOINT_BLOCKED` ngay KHÔNG gọi API (ADR-P3-D15). Budget đếm per-phiên (không persist).
- **AC8 (Secret hygiene + telemetry)** — Given mọi nhánh, Then TUYỆT ĐỐI KHÔNG log/transmit token CAPTCHA, API key, proxy credential (R-D3). Telemetry ghi `{ provider, checkpointType, outcome, durationMs }` với `outcome` khớp enum `action_outcome_category` (ADR-P3-D6: `success | checkpoint | ...`). KHÔNG ghi secret vào `automation_jobs.result`.
- **AC9 (Test coverage)** — Logic thuần (type-detector, client request/response mapping, orchestration: provider fallback + breaker + budget + gate) có **unit test** (DI mock HTTP + mock page, KHÔNG gọi mạng/browser thật). HTML fixtures cho từng checkpoint type. Lint + typecheck pass. Phần inject-token-vào-FB-thật = **manual protocol** (ghi rõ là manual, KHÔNG `test.fixme` giả).

## Tasks / Subtasks

- [x] **T1** — `src/main/automation/checkpoint/types.ts` (NEW): `CheckpointType`, `CaptchaParams` (`FunCaptchaParams`/`RecaptchaV2Params`), `SolveResult`, `SolveErrorCode`, `CaptchaSolverClient` interface (`{ name; solve(params): Promise<string> }`), `CheckpointPageLike` (subset Playwright Page: `url()`, `content()`, `waitForTimeout?`, `evaluate?`). `SOLVABLE_CHECKPOINT_TYPES` set + `isSolvableCheckpoint()`. (AC1, AC4)
- [x] **T2** — `src/main/automation/checkpoint/checkpoint-type-detector.ts` (NEW): `detectCheckpointType(page): Promise<CheckpointType>` (regex DOM marker, order: FUNCAPTCHA → RECAPTCHA → OTP → IDENTITY → UNKNOWN) + `extractCaptchaParams(page, type): Promise<CaptchaParams | null>` (regex publicKey `pk_...` / siteKey / blob / surl→subdomain). (AC1, AC3)
- [x] **T3** — `src/main/automation/checkpoint/capsolver-client.ts` (NEW): CapSolver REST client (primary). `createTask` (FunCaptchaTaskProxyLess/FunCaptchaTask + ReCaptchaV2) → poll `getTaskResult` tới khi ready/timeout. Inject `postJson` deps (default `fetch`) để test mock. Proxy → task fields. Error → `SolveErrorCode`. KHÔNG hardcode message "license". (AC4, AC5)
- [x] **T4** — `src/main/automation/checkpoint/two-captcha-client.ts` (NEW): 2captcha REST client (fallback). `in.php` createTask + `res.php` poll. Cùng interface `CaptchaSolverClient`. Inject `postJson`. (AC4, AC5)
- [x] **T5** — `src/main/automation/checkpoint/checkpoint-solver.ts` (NEW): `createCheckpointSolver(deps)` → `solveCheckpoint(page, ctx): Promise<SolveResult>`. Orchestrate: gate (flag+key) → detect type → isSolvable? → extract params → params? → solve (CapSolver→2captcha fallback) → inject token (`injectCaptchaToken` helper) → re-verify `detectLoginState`. Quản lý **circuit breaker** (Map<profileId, failCount>, cap 2) + **budget** (counter per solver instance, cap 10). Telemetry callback `onSolveOutcome`. Deps `Pick<>` + inject `now`/`getApiKey`/`isEnabled`. (AC2, AC4, AC6, AC7, AC8)
- [x] **T6** — `src/main/automation/checkpoint/index.ts` (NEW): barrel export. (rule #21)
- [x] **T7** — Wiring `src/main/automation/login-service.ts` (UPDATE): thêm optional dep `solveCheckpoint?`. Tại nhánh `state === 'CHECKPOINT'` (L102-110): nếu có `solveCheckpoint` → transition `SOLVING_CHECKPOINT`, gọi solver; `ok` → transition `WARMING_UP` return `LOGGED_IN`; fail → `CHECKPOINT_BLOCKED` (hành vi cũ). KHÔNG có dep → hành vi cũ y nguyên (backward-compatible). (AC6)
- [x] **T8** — Wiring `src/main/adapters/electron-bootstrap.ts` (UPDATE): tại `createSelfCommentLoginAdapter` nhánh `state === 'CHECKPOINT'` (~L236): nếu flag ON + có key → transition `SOLVING_CHECKPOINT` (qua stateMachine, cần thêm vào adapter deps) → gọi solver (kèm proxy của profile + jobId làm breaker key) → `ok` → re-detect → return `LOGGED_IN`; fail → return `CHECKPOINT` (orchestrator transition CHECKPOINT_BLOCKED như cũ). Construct solver instance tại bootstrap (1 instance/phiên cho budget). (AC2, AC5, AC6, AC7)
- [x] **T9** — `src/main/automation/index.ts` (UPDATE): APPEND export checkpoint barrel. (rule #21)
- [x] **T10** — Tests:
  - `tests/unit/checkpoint-type-detector.spec.ts` — feed HTML fixtures → assert type đúng + extracted params (publicKey/siteKey); UNKNOWN khi không marker; PARAMS_NOT_FOUND khi thiếu key.
  - `tests/unit/capsolver-client.spec.ts` + `tests/unit/two-captcha-client.spec.ts` — mock `postJson`: assert request shape (task type, proxy fields), parse token, error→SolveErrorCode, timeout.
  - `tests/unit/checkpoint-solver.spec.ts` — DI mock detector/clients/page: gate OFF→fallback; OTP→fallback không gọi API; CapSolver fail→2captcha; breaker 2 lần→CHECKPOINT_BLOCKED; budget 10→fallback; **assert KHÔNG leak token/key/proxy** trong telemetry/result; transition sequence đúng.
  - `tests/fixtures/fb-mock/checkpoint-funcaptcha.html` + `checkpoint-recaptcha.html` (NEW) — markup chứa pk_/data-sitekey.
  - Update `tests/unit/login-service.spec.ts` — thêm case: CHECKPOINT + solveCheckpoint ok → WARMING_UP; CHECKPOINT + solveCheckpoint fail → CHECKPOINT_BLOCKED; không có dep → hành vi cũ.
- [x] **T11** — Verify: `npm run lint` + `npm run typecheck` + test mới PASS + full suite không giảm. Grep tự kiểm KHÔNG log token/apiKey/proxy password. Viết **manual test protocol** vào Dev Notes (đã có sẵn bên dưới — chỉ cần thực thi khi có API key thật).

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules) + `project-context.md` + `architecture.md` § Phase 3 Addendum — Checkpoint Auto-Solver (ADR-P3-D12→D16)

### 🔴 GUARDRAIL #1 — Secret hygiene (R-D3) — QUAN TRỌNG NHẤT

3 loại secret trong story này, TUYỆT ĐỐI không lộ:
- **API key** CapSolver/2captcha: lấy từ safeStorage tại exec time (`captcha.capsolver.api_key`, `captcha.2captcha.api_key`). Truyền vào solver qua DI. KHÔNG log, KHÔNG vào IPC response, KHÔNG vào telemetry/result.
- **Proxy credential** (user/pass): lấy từ proxy service tại exec time, truyền vào solver task. CapSolver/2captcha cần nó để giải đúng IP (AC5) — đây là đường lộ ra bên thứ 3 ĐÃ được accept (ADR-P3-D14), nhưng vẫn KHÔNG được log phía client.
- **Token CAPTCHA** trả về: inject vào page rồi quên. KHÔNG log, KHÔNG ghi result.
- Tuân thủ rule #11 (no secret in log) + ESLint `no-direct-logger`. Nếu phải log gì → qua `redact()`.

### 🔴 GUARDRAIL #2 — Fail SẠCH, mặc định AN TOÀN (ADR-P3-D15)

- Solver là **best-effort**. Mọi đường fail PHẢI về `CHECKPOINT_BLOCKED` (hành vi Story 4.3 cũ) — KHÔNG bao giờ làm xấu hơn trạng thái hiện tại, KHÔNG crash.
- **Gate mặc định OFF**: flag `captcha.solver.enabled` ≠ `'true'` → coi như không có solver. Không có API key → cũng vậy. Không bao giờ tự bật.
- **Circuit breaker** (cap 2/profile) + **budget** (cap 10/phiên) chống đốt tiền + đốt account trong vòng lặp. Đây là lý do tồn tại của story, không phải optional.

### 🔴 GUARDRAIL #3 — Token CAPTCHA hết hạn nhanh

Token Arkose/reCAPTCHA gắn session + thời điểm. Solve xong **inject NGAY** + re-verify — KHÔNG cache, KHÔNG trì hoãn, KHÔNG batch. Mỗi giây trễ giảm tỉ lệ pass.

### Module structure (T1-T6) — theo architecture § Module Structure

```
src/main/automation/checkpoint/
├── types.ts                      # NEW — domain types + CaptchaSolverClient interface
├── checkpoint-type-detector.ts   # NEW — detectCheckpointType + extractCaptchaParams
├── capsolver-client.ts           # NEW — primary, createTask+poll, inject postJson
├── two-captcha-client.ts         # NEW — fallback, in.php/res.php, inject postJson
├── checkpoint-solver.ts          # NEW — orchestrator + breaker + budget + telemetry
└── index.ts                      # NEW — barrel
```

**Adapter discipline (R-D16):** module trong `main/automation/` → KHÔNG `import { ... } from 'electron'`. HTTP qua `fetch` (Node global) hợp lệ. API key + proxy nhận qua DI từ bootstrap (bootstrap đọc safeStorage + proxy service), KHÔNG tự đọc adapter trong module.

### Provider API tóm tắt (T3, T4) — research note

> ⚠️ Xác nhận lại endpoint/field mới nhất khi implement (provider đổi API). Đây là pattern, không phải spec đóng băng.

- **CapSolver** (primary, AI-driven, 1-9s): `POST https://api.capsolver.com/createTask` body `{ clientKey, task: { type: 'FunCaptchaTask'|'FunCaptchaTaskProxyLess', websiteURL, websitePublicKey, data?(blob), proxy? } }` → `taskId`. Poll `POST /getTaskResult` `{ clientKey, taskId }` → `status: 'ready'` + `solution.token`. reCAPTCHA: `ReCaptchaV2Task`/`...ProxyLess` + `websiteKey`.
- **2captcha** (fallback, human, 10-30s): `POST https://2captcha.com/in.php` (`method=funcaptcha`, `publickey`, `surl`, `pageurl`, `proxy`, `proxytype`) → `request` id. Poll `GET /res.php?action=get&id=...` → `OK|<token>`. Hoặc dùng JSON API mới `createTask`/`getTaskResult` tương tự CapSolver.
- **Proxy fields** (AC5): truyền `proxy` (host:port:user:pass hoặc object tùy provider). Profile proxy lấy từ proxy service (Story 3.3 `toPlaywrightProxy` / proxy metadata). Không có proxy → dùng task ProxyLess variant.
- **postJson injectable**: viết helper riêng trong module (KHÔNG tái dùng `src/shared/api-client/http-client.ts::postJson` — error message hardcode "license", sai ngữ cảnh). Inject để test mock không gọi mạng.

### Integration points (T7, T8) — ĐỌC FILE TRƯỚC KHI SỬA

**2 login path, sửa CẢ HAI (đồng bộ):**

1. **`src/main/automation/login-service.ts` L102-110** (path test/future, có hook `onCheckpoint`):
   - Hiện tại: `if (state === 'CHECKPOINT' || state === 'TWO_FA_REQUIRED') { transitionToCheckpointBlocked(...) }`.
   - Thêm optional dep `solveCheckpoint?: (page, ctx) => Promise<SolveResult>` vào `LoginServiceDeps`.
   - Sửa nhánh `CHECKPOINT` (KHÔNG đụng `TWO_FA_REQUIRED` — 2FA không phải captcha): nếu có `solveCheckpoint` → `transitionJob(SOLVING_CHECKPOINT)` → gọi solver → `ok` → `transitionJob(WARMING_UP)` return `{ok:true, state:'LOGGED_IN'}`; fail → `transitionToCheckpointBlocked(...,'checkpoint')` (hành vi cũ).
   - KHÔNG có dep → y nguyên hành vi cũ (backward-compatible — test 4.3 hiện tại vẫn pass).

2. **`src/main/adapters/electron-bootstrap.ts::createSelfCommentLoginAdapter` ~L236** (path PRODUCTION THẬT):
   - Hiện tại: `if (state === 'CHECKPOINT') return { ok: true, state, session, reason: 'CHECKPOINT_BLOCKED' }`.
   - Thêm vào adapter deps: `stateMachine` (cho transition SOLVING_CHECKPOINT), `solver` instance, proxy lookup, settings (đọc flag).
   - Sửa: nếu flag ON + có key → `stateMachine.transition(jobId, 'SOLVING_CHECKPOINT')` → `solver.solveCheckpoint(page, { profileId, jobId, proxy })` → `ok` → re-`detectLoginState` → `LOGGED_IN` return `{ok:true, state:'LOGGED_IN', session}`; fail → return `{ok:true, state:'CHECKPOINT', session, reason:'CHECKPOINT_BLOCKED'}` (orchestrator sẽ transition CHECKPOINT_BLOCKED như cũ — xem `self-comment-orchestrator.ts:140-147`).
   - ⚠️ Solver instance phải **construct 1 lần tại bootstrap** (không phải mỗi login) để budget counter (cap 10/phiên) đếm xuyên các profile trong cùng phiên bulk. Breaker key = profileId.
   - ⚠️ `createSelfCommentLoginAdapter` hiện KHÔNG nhận `stateMachine` — phải thêm vào deps (đọc L160-167 hiện tại). `state==='CHECKPOINT'` xảy ra TRƯỚC khi orchestrator vào WARMING_UP, nên adapter cần tự transition SOLVING_CHECKPOINT.

> **Lưu ý regression:** `self-comment-orchestrator.ts:140` xử lý `loginResult.state === 'CHECKPOINT'` → CHECKPOINT_BLOCKED. Khi solver thành công, adapter trả `LOGGED_IN` nên orchestrator đi tiếp WARMING_UP bình thường — KHÔNG cần sửa orchestrator. Khi solver fail, adapter vẫn trả `CHECKPOINT` → orchestrator giữ nguyên. State machine: `SOLVING_CHECKPOINT` chỉ transition được TỪ `LOGGING_IN` (xem TRANSITIONS) — adapter đang ở LOGGING_IN khi detect checkpoint nên hợp lệ; sau solve ok cần `SOLVING_CHECKPOINT → WARMING_UP` (đã có trong map).

### Manual Test Protocol (AC9) — BẮT BUỘC trước khi bật production

> Phần inject-token-vào-FB-thật KHÔNG test tự động được. Đây là protocol thủ công, KHÔNG dùng `test.fixme` giả.

1. Cấu hình API key CapSolver (tài khoản có credit) qua Settings (Story 5.6) hoặc set safeStorage trực tiếp (dev smoke).
2. Bật flag `captcha.solver.enabled = 'true'`.
3. Dùng profile thật có proxy bind + cookie đang dính FunCaptcha checkpoint.
4. Trigger login. Quan sát log (non-secret): detect `FUNCAPTCHA` → extract publicKey → SOLVING_CHECKPOINT → solve trả token (durationMs) → inject → re-verify → `LOGGED_IN` → WARMING_UP.
5. Ghi nhận tỉ lệ pass qua telemetry. Nếu `PARAMS_NOT_FOUND` lặp lại → tinh chỉnh regex extract trong `checkpoint-type-detector.ts` theo DOM thật.
6. Test breaker: cố tình để solve fail 2 lần → xác nhận CHECKPOINT_BLOCKED, không thử lần 3.

### Edge cases

- Checkpoint loại `UNKNOWN` (DOM lạ, FB đổi) → fallback CHECKPOINT_BLOCKED (an toàn). Không đoán bừa.
- Cả CapSolver + 2captcha fail (hết credit/down) → tính 1 fail vào breaker, fallback CHECKPOINT_BLOCKED.
- Proxy chết khi solve → solver task fail → tính fail. Không retry vô hạn.
- Token inject xong nhưng re-verify vẫn CHECKPOINT (FB reject token do binding) → tính fail; lần 2 fail → CHECKPOINT_BLOCKED.
- Budget cap chạm giữa phiên → checkpoint còn lại fallback ngay, KHÔNG gọi API (tiết kiệm tiền).
- `evaluate`/`content` của page throw → catch → fallback, KHÔNG crash login.
- Flag ON nhưng cả 2 key trống → coi như OFF (AC2).

### Scope — KHÔNG làm

- KHÔNG giải OTP/SMS, identity verification (upload CMND), unusual-activity lock — fallback CHECKPOINT_BLOCKED (ADR-P3-D12).
- KHÔNG UI nhập API key (Story 5.6) — 5.5 nhận key qua DI; có thể set safeStorage thủ công để test.
- KHÔNG persist budget/breaker qua phiên (in-memory per solver instance).
- KHÔNG telemetry transport backend (Epic 6 — chỉ callback `onSolveOutcome` + ghi job result outcome).
- KHÔNG đụng nhánh `TWO_FA_REQUIRED` (đã xử lý ở 4.3 bằng TOTP seed, không phải captcha).
- 🚫 KHÔNG log/transmit token/apiKey/proxy credential (R-D3).

### Files

| File | Action | Ghi chú |
|---|---|---|
| `src/main/automation/checkpoint/types.ts` | NEW | domain types + CaptchaSolverClient interface |
| `src/main/automation/checkpoint/checkpoint-type-detector.ts` | NEW | detect + extract params |
| `src/main/automation/checkpoint/capsolver-client.ts` | NEW | primary, inject postJson |
| `src/main/automation/checkpoint/two-captcha-client.ts` | NEW | fallback, inject postJson |
| `src/main/automation/checkpoint/checkpoint-solver.ts` | NEW | orchestrator + breaker + budget |
| `src/main/automation/checkpoint/index.ts` | NEW | barrel |
| `src/main/automation/login-service.ts` | UPDATE | optional solveCheckpoint dep + nhánh CHECKPOINT |
| `src/main/automation/index.ts` | UPDATE | APPEND export checkpoint |
| `src/main/adapters/electron-bootstrap.ts` | UPDATE | wire solver vào createSelfCommentLoginAdapter + construct 1 instance |
| `tests/unit/checkpoint-type-detector.spec.ts` | NEW | type + params |
| `tests/unit/capsolver-client.spec.ts` | NEW | mock postJson |
| `tests/unit/two-captcha-client.spec.ts` | NEW | mock postJson |
| `tests/unit/checkpoint-solver.spec.ts` | NEW | gate/fallback/breaker/budget/no-leak |
| `tests/unit/login-service.spec.ts` | UPDATE | + case solveCheckpoint ok/fail/absent |
| `tests/fixtures/fb-mock/checkpoint-funcaptcha.html` | NEW | pk_ markup |
| `tests/fixtures/fb-mock/checkpoint-recaptcha.html` | NEW | data-sitekey markup |
| ⚠️ 2 file lỡ tạo phiên trước (`checkpoint/types.ts`, `checkpoint/checkpoint-type-detector.ts` trong `src/main/automation/`) | REUSE/VERIFY | đã có draft — đối chiếu với types ở đây, chỉnh cho khớp |

### References

- [Source: architecture.md § Phase 3 Addendum — Checkpoint Auto-Solver (ADR-P3-D12→D16)] — toàn bộ quyết định
- [Source: epics-phase3.md#Story-5.5] — AC gốc
- [Source: src/main/automation/login-service.ts:102-110] — nhánh CHECKPOINT hiện tại (path test/future)
- [Source: src/main/adapters/electron-bootstrap.ts:160-274 (createSelfCommentLoginAdapter), ~L236 nhánh CHECKPOINT] — path PRODUCTION
- [Source: src/main/automation/checkpoint-handler.ts] — detectLoginState (re-verify sau inject)
- [Source: src/main/automation/state-machine.ts:8-19] — TRANSITIONS: SOLVING_CHECKPOINT từ LOGGING_IN, tới WARMING_UP
- [Source: src/main/automation/self-comment-orchestrator.ts:140-147] — orchestrator xử lý loginResult.state CHECKPOINT
- [Source: src/main/adapters/electron-bootstrap.ts:126 (AUTOMATION_BROWSER_HEADLESS_SETTING), 195] — pattern feature flag qua settings repo `=== 'true'`
- [Source: src/main/adapters/electron-safe-storage.ts:8-44] — get/set/delete/hasEncryptedKey
- [Source: src/shared/types/secret.ts] — Secret<T>/brandSecret/revealSecret
- [Source: src/shared/api-client/http-client.ts] — postJson reference (KHÔNG tái dùng — viết riêng)
- [Source: _bmad-output/implementation-artifacts/4-3-login-cookie-xu-ly-2fa-checkpoint.md] — previous story: secret hygiene, finally cleanup, DI mock patterns
- [Source: automation-desktop/CLAUDE.md (rules #10,#11,#16,#21) + project-context.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `cd automation-desktop && npm run typecheck` — PASS.
- `cd automation-desktop && npx playwright test tests/unit/checkpoint-type-detector.spec.ts tests/unit/capsolver-client.spec.ts tests/unit/two-captcha-client.spec.ts tests/unit/checkpoint-solver.spec.ts tests/unit/login-service.spec.ts --reporter=line` — 21 passed.
- `cd automation-desktop && npm run lint` — exit 0; remaining pre-existing warning: `src/main/adapters/electron-bootstrap.ts` direct `console.warn` centralized-logging rule.
- `cd automation-desktop && rg -n "console\\.|apiKey|clientKey|proxyPassword|proxyLogin|CAPTCHA_TOKEN|CAPSOLVER_SECRET|TWO_CAPTCHA_SECRET|password" src/main/automation/checkpoint src/main/adapters/electron-bootstrap.ts` — reviewed hits; no checkpoint token/API key/proxy credential logging added.
- `cd automation-desktop && npx playwright test tests/unit tests/integration tests/e2e --reporter=line` — 290 passed.

### Completion Notes List

- Added checkpoint domain module for type detection, captcha param extraction, provider clients, solver orchestration, token injection, breaker, budget, and safe telemetry.
- Wired login-service optional `solveCheckpoint` path while preserving old CHECKPOINT/TWO_FA fallback when no solver is provided.
- Wired production Electron bootstrap with flag/key gate, one solver instance per app session, CapSolver primary + 2captcha fallback, and profile proxy binding when proxy service is configured; proxyless remains supported when no proxy is configured.
- Preserved manual checkpoint behavior: if solver is unavailable or fails, login returns CHECKPOINT with `keepSessionOpen` so the Chromium process remains available for user intervention.
- Manual live-Facebook inject protocol remains in Dev Notes and was not executed because real provider API key/credit and checkpoint profile are required.

### File List

- `automation-desktop/src/main/automation/checkpoint/types.ts`
- `automation-desktop/src/main/automation/checkpoint/checkpoint-type-detector.ts`
- `automation-desktop/src/main/automation/checkpoint/capsolver-client.ts`
- `automation-desktop/src/main/automation/checkpoint/two-captcha-client.ts`
- `automation-desktop/src/main/automation/checkpoint/checkpoint-solver.ts`
- `automation-desktop/src/main/automation/checkpoint/index.ts`
- `automation-desktop/src/main/automation/login-service.ts`
- `automation-desktop/src/main/automation/index.ts`
- `automation-desktop/src/main/adapters/electron-bootstrap.ts`
- `automation-desktop/tests/fixtures/fb-mock/checkpoint-funcaptcha.html`
- `automation-desktop/tests/fixtures/fb-mock/checkpoint-recaptcha.html`
- `automation-desktop/tests/unit/checkpoint-type-detector.spec.ts`
- `automation-desktop/tests/unit/capsolver-client.spec.ts`
- `automation-desktop/tests/unit/two-captcha-client.spec.ts`
- `automation-desktop/tests/unit/checkpoint-solver.spec.ts`
- `automation-desktop/tests/unit/login-service.spec.ts`

### Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-06-04 | 0.1 | Story created (bmad-create-story) — checkpoint auto-solver FunCaptcha/reCAPTCHA | Luisphan |
| 2026-06-04 | 1.0 | Implemented checkpoint CAPTCHA solver core, provider fallback, login/bootstrap wiring, tests, and verification. | Codex |

