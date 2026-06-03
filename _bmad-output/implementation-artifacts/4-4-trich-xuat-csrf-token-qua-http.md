# Story 4.4: Trích xuất CSRF token qua HTTP

Status: ready-for-dev

Epic: 4 — Lõi Automation Facebook (Self-Comment MVP) · Story: 4.4 · ID: 4.4

## Story

As a user,
I want hệ thống trích xuất `fb_dtsg` / `lsd` / `jazoest` từ HTML Facebook (sau khi login),
So that các action HTTP-based (self-comment 4.6) có đủ CSRF token để gửi request.

## Acceptance Criteria

- **AC1 (Parse tokens)** — Given đã login thành công (4.3, có page/HTML Facebook đã auth), When token-extractor lấy HTML, Then parse được `fb_dtsg`, `lsd`, `jazoest` (port logic regex từ C# stage 1).
- **AC2 (In-memory session)** — Token lưu **in-memory session** (object trả về cho caller giữ trong job session), KHÔNG persist SQLite, KHÔNG qua IPC, KHÔNG ghi `automation_jobs.result`.
- **AC3 (jazoest fallback)** — Nếu HTML có sẵn `jazoest` → dùng; nếu không → compute từ `fb_dtsg` (`jazoest = "2" + tổng charCode của fb_dtsg`). Pure, deterministic.
- **AC4 (Parse fail → telemetry + retry)** — Nếu parse fail (thiếu `fb_dtsg`/`lsd` — FB đổi HTML), Then gọi hook `onSelectorMiss(token)` (transport telemetry `selector_miss` defer Epic 6) + retry (bounded, KHÔNG vô hạn). Hết retry → throw/typed error rõ ràng (KHÔNG chứa token/secret).
- **AC5 (Secret hygiene)** — `fb_dtsg/lsd/jazoest` nằm trong secret-keys list (architecture L1667) → TUYỆT ĐỐI KHÔNG log (không `console`/`logger` chứa token), KHÔNG persist, KHÔNG IPC, KHÔNG vào error message / telemetry payload (chỉ gửi TÊN token thiếu, KHÔNG gửi value).
- **AC6 (Test coverage)** — `parseTokens` (pure) + orchestration (retry/selector_miss/no-leak) có **unit test** (DI `fetchHtml`, KHÔNG hit facebook.com). Lint + typecheck pass.

## Tasks / Subtasks

- [ ] **T1** — `src/main/automation/token-extractor.ts`:
  - `export interface SessionTokens { fbDtsg: string; lsd: string; jazoest: string }`
  - `parseTokens(html: string): SessionTokens | null` — PURE regex parser (AC1/AC3). Return `null` nếu thiếu `fbDtsg` HOẶC `lsd`.
  - `createTokenExtractor(deps): TokenExtractor` → `extract(): Promise<SessionTokens>` (AC2/AC4).
- [ ] **T2** — `src/main/automation/index.ts`: APPEND export `createTokenExtractor`, `parseTokens`, type `SessionTokens` (giữ exports 4.1/4.2/4.3). (rule #21)
- [ ] **T3** — Tests:
  - `tests/unit/token-extractor.spec.ts`:
    - `[P0] parseTokens` happy: HTML chứa `DTSGInitialData`/`fb_dtsg` + `LSD`/`lsd` + `jazoest` → parse đúng 3 token.
    - `[P0] jazoest fallback`: HTML có fb_dtsg nhưng KHÔNG có jazoest → compute `"2"+sumCharCode(fbDtsg)` đúng (test vector cố định).
    - `[P0] parse fail`: HTML thiếu fb_dtsg/lsd → `parseTokens` trả `null`.
    - `[P0] extract retry + selector_miss`: DI `fetchHtml` fail lần 1 (HTML rác) → `onSelectorMiss` gọi → lần 2 HTML ok → trả token. Hết maxAttempts → throw typed error.
    - `[P0] no-leak`: error/telemetry KHÔNG chứa token value (assert `not.toContain` token giả).
- [ ] **T4** — Verify: `npm run lint` + `npm run typecheck` + test mới PASS + full suite không giảm (baseline 167). Grep tự kiểm KHÔNG có log statement chứa token + KHÔNG `Date.now` trong logic thuần (inject nếu cần backoff).

> **D1 (defer):** KHÔNG per-action server JWT (4.5 — khác hẳn, gọi backend). KHÔNG self-comment / HTTP POST action (4.6). KHÔNG IPC/UI. KHÔNG telemetry transport (Epic 6 — chỉ `onSelectorMiss` hook). KHÔNG state machine transition (4.4 là helper của EXECUTING, không tự transition).

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules) + `automation-desktop/project-context.md`

4.4 là **pure main-process infra** (parser + thin fetch wrapper). Nhẹ hơn 4.3 NHIỀU — KHÔNG launch browser mới, KHÔNG dep mới.

### 🔴 GUARDRAIL — Secret hygiene (AC5)

`fb_dtsg/lsd/jazoest` thuộc secret-keys list (architecture L1667: `...fb_dtsg, lsd, jazoest, action_token, jti...`). Tuy "nhẹ" hơn cookie nhưng VẪN:
- 🚫 KHÔNG `console.log`/`logger` chứa token value (chưa có `redact()` util → đơn giản là KHÔNG log token).
- 🚫 KHÔNG persist SQLite / KHÔNG IPC payload / KHÔNG `automation_jobs.result`.
- 🚫 `onSelectorMiss` + error message chỉ chứa **TÊN** token thiếu (vd `'fb_dtsg'`), KHÔNG chứa HTML/value.
- Token sống in-memory trong session object, caller (4.6) giữ; KHÔNG cache ra đĩa.

### parseTokens (T1) — PURE regex, port từ C# stage 1

```ts
// fb_dtsg: thử nhiều pattern (FB render khác nhau)
//   "DTSGInitialData",[],{"token":"<...>"}   |   name="fb_dtsg" value="<...>"   |   ["DTSGInitial",...,"<...>"]
// lsd:    "LSD",[],{"token":"<...>"}          |   name="lsd" value="<...>"        |   ["LSD",[],{"token":"<...>"},...]
// jazoest: name="jazoest" value="(\d+)"  → nếu không có, compute từ fb_dtsg
function computeJazoest(fbDtsg: string): string {
  let sum = 0
  for (const ch of fbDtsg) sum += ch.charCodeAt(0)
  return `2${sum}`
}
export function parseTokens(html: string): SessionTokens | null {
  const fbDtsg = matchFirst(html, [/"DTSGInitialData",\[\],\{"token":"([^"]+)"/, /name="fb_dtsg"\s+value="([^"]+)"/])
  const lsd = matchFirst(html, [/"LSD",\[\],\{"token":"([^"]+)"/, /name="lsd"\s+value="([^"]+)"/])
  if (!fbDtsg || !lsd) return null
  const jazoest = matchFirst(html, [/name="jazoest"\s+value="(\d+)"/]) ?? computeJazoest(fbDtsg)
  return { fbDtsg, lsd, jazoest }
}
```
- Regex FB **fragile** (FB đổi HTML thường xuyên) → Epic 5 (selector-resolver 4-tier) sẽ thay. 4.4 hardcode + dùng `onSelectorMiss` làm cơ chế phát hiện + retry. Test bằng HTML fixture ổn định.
- Thử nhiều pattern cho mỗi token (FB render khác nhau giữa các version/route).

### Extract orchestration (T1) — DI + retry + telemetry

```ts
export interface TokenExtractorDeps {
  fetchHtml: () => Promise<string>          // real = () => session.page.content(); test = fake HTML
  onSelectorMiss: (token: string) => void   // telemetry hook (transport Epic 6)
  maxAttempts?: number                       // default 3, bounded
}
async extract(): Promise<SessionTokens> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const html = await deps.fetchHtml()
    const tokens = parseTokens(html)
    if (tokens) return tokens
    deps.onSelectorMiss('fb_dtsg_or_lsd')    // CHỈ tên, không value/HTML
    // (optional) backoff: computeBackoffMs từ shared/retry.ts — nếu dùng sleep, inject để test không chờ thật
  }
  throw new Error('TOKEN_EXTRACTION_FAILED')  // KHÔNG chứa token/HTML
}
```
- `fetchHtml` real: `() => session.page.content()` (page đã login từ 4.3) — HOẶC `context.request.get(facebook.com).then(r=>r.text())` nếu muốn pure-HTTP. 4.4 nhận `fetchHtml` injected → consumer (4.6) quyết định nguồn. Unit test inject fake → KHÔNG cần browser.
- `maxAttempts` bounded (KHÔNG vô hạn). Nếu backoff có delay thật → inject `sleep`/`now` để test nhanh (như 3.2 inject clock). Khuyến nghị: 4.4 retry KHÔNG sleep (FB HTML fail = đổi cấu trúc, retry ngay cũng được) → tránh phức tạp; hoặc backoff nhỏ injectable.

### Edge cases

- HTML rỗng / không phải FB → `parseTokens` null → retry → hết → throw.
- fb_dtsg có nhưng lsd thiếu (hoặc ngược lại) → null (cả 2 bắt buộc). jazoest optional (compute fallback).
- fb_dtsg ký tự Unicode → `charCodeAt` theo UTF-16 code unit (port C# có thể khác với surrogate; FB token là ASCII alnum nên không vấn đề — note nếu lo).
- HTML chứa nhiều match fb_dtsg (vd nhiều form) → lấy match ĐẦU (`matchFirst`). Note: FB thường nhất quán.
- `extract` gọi nhiều lần (re-extract sau khi token hết hạn) → mỗi lần fetch HTML mới + parse lại; không cache stale.

### Scope — KHÔNG làm

- KHÔNG per-action server token JWT (4.5 — gọi backend `POST /api/v1/automation/action/token`).
- KHÔNG self-comment / HTTP POST action gửi token (4.6).
- KHÔNG IPC/UI; KHÔNG telemetry transport (Epic 6 — chỉ `onSelectorMiss` hook).
- KHÔNG state machine transition (4.4 = helper, không tự đổi state job).
- KHÔNG selector hot-config 4-tier (Epic 5 — hardcode regex + selector_miss).
- 🚫 KHÔNG log/persist/transmit token value (AC5).

### Files

| File | Action | Ghi chú |
|---|---|---|
| `src/main/automation/token-extractor.ts` | NEW | parseTokens (pure) + createTokenExtractor (DI fetchHtml + retry + onSelectorMiss) |
| `src/main/automation/index.ts` | UPDATE | APPEND exports (giữ 4.1/4.2/4.3) |
| `tests/unit/token-extractor.spec.ts` | NEW | parse happy/fallback/fail + extract retry/selector_miss/no-leak |
| ~~IPC / UI / bootstrap / integration browser~~ | — | DEFER / KHÔNG cần (parser pure, DI fetchHtml) |

### Previous story intelligence (4.1/4.2/4.3 + 3.x)

- **4.3** `SessionHandle.page` (Playwright Page, đã login) → `page.content()` là nguồn `fetchHtml` thật. 4.4 nhận `fetchHtml` injected (đừng import playwright trực tiếp vào token-extractor — giữ pure + testable).
- **4.3 onCheckpoint pattern** → 4.4 dùng `onSelectorMiss` hook y hệt (telemetry transport Epic 6).
- **3.2 clock injection** → nếu 4.4 backoff có delay, inject (đa số khuyên KHÔNG sleep cho đơn giản).
- **shared/retry.ts** có `computeBackoffMs` — tái dùng nếu cần backoff.
- **Secret-no-log**: chưa có `redact()` util → đơn giản KHÔNG viết log chứa token (như 4.3 — 0 log statement trong module nhạy cảm).
- **167 test đang PASS** — đừng phá.

### Testing chi tiết (AC6)

Pure parser + DI orchestration → **unit-only đủ** (KHÔNG cần integration browser, KHÔNG hit FB). Tùy chọn: 1 integration đọc `tests/fixtures/fb-mock/*.html` có nhúng token để verify parseTokens trên HTML thực-tế-hơn (nice-to-have, không bắt buộc). Trọng tâm: parseTokens chính xác (port C# regex) + extract retry/telemetry/no-leak.

## References

- [Source: epics-phase3.md#Story-4.4 (L401-413)] — AC gốc (fb_dtsg/lsd/jazoest, in-memory, selector_miss + retry)
- [Source: epics-phase3.md#FR-P3-06 (L910)] — Token extraction qua HTTP
- [Source: architecture.md (L1667)] — secret-keys list (fb_dtsg/lsd/jazoest = secret, redact)
- [Source: architecture.md (L1818,L1929)] — `main/automation/token-extractor.ts`
- [Source: src/main/automation/playwright-runner.ts (4.3)] — SessionHandle.page → page.content()
- [Source: src/main/automation/login-service.ts (4.3)] — onCheckpoint hook pattern (mirror onSelectorMiss)
- [Source: src/shared/retry.ts] — computeBackoffMs (optional)
- [Source: automation-desktop/CLAUDE.md + project-context.md] — 25 rules (đặc biệt #11 no-log secret)

## Dev Agent Record

### Agent Model Used

_TBD_

### Debug Log References

_TBD_

### Completion Notes List

_TBD_

### File List

_TBD_

### Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-06-03 | 0.1 | Story created (bmad-create-story) — token-extractor fb_dtsg/lsd/jazoest qua HTTP | Luisphan |
