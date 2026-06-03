# Story 4.6a: Thực thi self-comment — core end-to-end (headless)

Status: review

Epic: 4 — Lõi Automation Facebook (Self-Comment MVP) · Story: 4.6a (tách từ 4.6) · ID: 4.6a

> ⚠️ **STORY TÍCH HỢP** — ráp 4.1→4.5 thành luồng self-comment chạy được (headless). 4.6a = **core logic + orchestration + backend consume**, KHÔNG UI. Surface (IPC `automation:start` + trigger UI + content_templates CRUD UI) = **4.6b**. Đọc HẾT Dev Notes.

## Story

As a user,
I want chạy self-comment trên post của chính profile (qua luồng automation đầy đủ),
So that validate toàn bộ stack (login → token → action-token gate → execute → persist) hoạt động end-to-end.

## Acceptance Criteria

- **AC1 (Orchestration e2e)** — Given profile có cookie + license active, When gọi `runSelfComment(jobId, profileId)` (entry headless, KHÔNG IPC ở 4.6a), Then state-machine (4.2) drive: `PENDING → ACQUIRING_PROXY → LOGGING_IN → (WARMING_UP) → EXECUTING → DONE`, gọi đúng thứ tự: proxy-pool (3.3, optional) → login-service (4.3) → token-extractor (4.4) → action-token-client (4.5) → action-executor → persist.
- **AC2 (Action-token gate + consume)** — Trước EXECUTING: `requestActionToken({actionType:'comment'})` (4.5). Sau khi action xong: gọi backend **consume** (`POST /api/v1/automation/action/token/consume`) verify JWT (chưa hết hạn) + `jti` tồn tại + `used_at` null → set `used_at`. Reuse (used_at != null) hoặc hết hạn → reject. Token KHÔNG hợp lệ → KHÔNG execute (block).
- **AC3 (Self-comment bundled selector)** — `action-executor` dùng **bundled static selector** (hardcode, đủ validate — Epic 5 nâng 4-tier) comment lên post của chính profile bằng nội dung từ template. (Selector fragile → note Epic 5.)
- **AC4 (Content random từ SQLite)** — Nội dung comment chọn **ngẫu nhiên** từ bảng `content_templates` (id, label, body, created_at). 4.6a: tạo table + repo `getRandomTemplate()` + seed tối thiểu (≥1 template). Nếu rỗng → outcome error rõ ràng (KHÔNG crash). *(CRUD UI = 4.6b.)*
- **AC5 (Persist job_actions + telemetry)** — Kết quả (success/checkpoint/error) ghi `job_actions` (job_id, action_type, target, action_token=**jti reference** KHÔNG phải JWT raw, executed_at, outcome). Gọi telemetry beacon hook `onActionOutcome({outcome, durationMs})` (transport Epic 6 — chỉ hook). `outcome` ∈ `success|checkpoint|selector_miss|proxy_error|timeout|error`.
- **AC6 (Read-back verify)** — Sau comment, verify comment THẬT xuất hiện (read-back DOM/marker). Verify pass → `success` + state DONE. Verify fail → `error`/`selector_miss`.
- **AC7 (Secret hygiene + cleanup)** — Cookie/2FA/fb_dtsg/action-token KHÔNG log/persist raw (chỉ `jti` reference trong job_actions). Browser session đóng `finally` (chống leak — như 4.3). Determinism: random template inject seed/rng để test.
- **AC8 (Test coverage)** — Orchestration + executor + consume + repos có **unit/integration test** (DI mock runner/page/clients + SQLCipher thật cho repos + backend pytest cho consume). 1 integration smoke: real Chromium vs **local FB-mock** (comment box + read-back). Backend pytest consume. Client lint/typecheck/test xanh.

## Tasks / Subtasks

### DB + repos (client)
- [x] **T1** — `src/main/db/client.ts`: + `content_templates(id TEXT PK, label TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)` + `job_actions(id TEXT PK, job_id TEXT NOT NULL REFERENCES automation_jobs(id) ON DELETE CASCADE, action_type TEXT NOT NULL, target TEXT, action_token TEXT, executed_at TEXT NOT NULL, outcome TEXT NOT NULL)`. + cập nhật `db-schema.spec.ts` assert 2 bảng (T1b).
- [x] **T2** — `src/main/db/repositories/content-template-repo.ts`: `getRandomTemplate(rng?)` + `listTemplates()` + seed helper (≥1 default). (CRUD = 4.6b)
- [x] **T3** — `src/main/db/repositories/job-action-repo.ts`: `recordAction({jobId, actionType, target, actionTokenJti, executedAt, outcome})`.

### Automation core (client)
- [x] **T4** — `src/main/automation/action-executor.ts`: `executeSelfComment({page, content, selectors, readBack}): Promise<ActionOutcome>` — bundled selector fill comment box + submit + read-back verify. DI page (PageLike như 4.3) → unit test fake. (AC3/AC6)
- [x] **T5** — `src/main/automation/self-comment-orchestrator.ts`: `runSelfComment(jobId, profileId)` — drive state-machine (4.2) qua các state, gọi loginService (4.3) → tokenExtractor (4.4) → actionTokenClient (4.5) → consume → actionExecutor → recordAction + onActionOutcome → transition DONE/CHECKPOINT_BLOCKED/FAILED. `finally` close session. Deps `Pick<>` + inject `now`/`rng`. (AC1/AC2/AC5/AC7)
- [x] **T6** — `src/main/automation/index.ts` + `src/main/license/index.ts`: APPEND export. (rule #21)

### Backend (consume — mirror license/action_token)
- [x] **T7** — `backend/app/schemas/automation/action_token.py`: + `ActionTokenConsumeRequest {token}` + `ActionTokenConsumeResponse {jti, consumed_at}`.
- [x] **T8** — `backend/app/services/automation/action_token.py`: + `consume_action_token(db, *, token, now=None)`: `jwt.decode` (HS256 settings, verify exp) → SELECT action_tokens WHERE jti → none → `ACTION_TOKEN_INVALID`; `used_at != null` → `ACTION_TOKEN_REUSED`; set `used_at=now`. (AC2)
- [x] **T9** — `backend/app/api/automation.py`: route `POST /api/v1/automation/action/token/consume` + status map (`ACTION_TOKEN_INVALID` 422, `ACTION_TOKEN_REUSED` 409, `ACTION_TOKEN_EXPIRED` 401). + client `action-token-client.ts`: `consumeActionToken(token)`.
- [x] **T10** — Tests:
  - `tests/unit/action-executor.spec.ts` (DI fake page: success read-back, selector miss, submit fail).
  - `tests/unit/self-comment-orchestrator.spec.ts` (DI mock tất cả deps: happy DONE; checkpoint→CHECKPOINT_BLOCKED; token deny→block no-execute; empty template→error; **assert no-secret-leak + session.close mọi nhánh + job_actions ghi jti KHÔNG JWT**).
  - `tests/integration/{content-template,job-action}-repo.spec.ts` (SQLCipher thật).
  - `tests/integration/self-comment-smoke.spec.ts` + `tests/fixtures/fb-mock/own-post.html` (real Chromium: fill comment + read-back).
  - `backend/tests/automation/test_automation_action_token.py`: + consume success (used_at set), reuse→409, expired→401, unknown jti→422.
- [x] **V** — Verify: backend pytest + client lint/typecheck/test + full suite không giảm (baseline 175).

> **D1 (defer → 4.6b):** IPC `phase3:automation:start` + `phase3:automation:status` + automation-handlers; trigger UI (renderer); content_templates CRUD (IPC + UI thêm/sửa/xóa). 4.6a chỉ entry headless `runSelfComment()` + seed template.

## Dev Notes

### ⚠️ ĐỌC TRƯỚC
- **Client**: `automation-desktop/CLAUDE.md` (25 rules) + `project-context.md`.
- **Backend**: mirror `automation/action_token` (4.5) + `license` convention. KHÔNG áp 25 rule client lên Python.
- **Consume points** (đọc kỹ — 4.6a ráp tất cả): `state-machine.ts` (4.2 transition), `login-service.ts` (4.3 `login(jobId,profileId)` → page), `token-extractor.ts` (4.4 `createTokenExtractor` + `fetchHtml=()=>page.content()`), `action-token-client.ts` (4.5 `requestActionToken`), `playwright-runner.ts` (4.3 SessionHandle.page+close).

### End-to-end flow (architecture L1973 — 4.6a phần headless, bỏ bước IPC/UI 1+10)

```
runSelfComment(jobId, profileId):
  transition PENDING→ACQUIRING_PROXY            # (proxy optional — 3.3, có thể bỏ qua nếu chưa cấu hình)
  transition →LOGGING_IN; loginResult = loginService.login(jobId, profileId)   # 4.3 → page; CHECKPOINT_BLOCKED → stop
  # login-service đã transition WARMING_UP nếu LOGGED_IN
  tokens = tokenExtractor({fetchHtml:()=>session.page.content()}).extract()    # 4.4
  actionToken = actionTokenClient.requestActionToken({actionType:'comment'})   # 4.5 — offline/deny → FAILED, no execute
  transition →EXECUTING
  content = contentTemplateRepo.getRandomTemplate(rng)                         # AC4; rỗng → error
  outcome = actionExecutor.executeSelfComment({page, content, selectors, readBack})  # AC3/AC6
  actionTokenClient.consumeActionToken(actionToken.token)                      # AC2 — mark used_at
  jobActionRepo.recordAction({jobId, actionType:'comment', target, actionTokenJti: actionToken.jti, executedAt: now(), outcome})
  onActionOutcome({outcome, durationMs})                                       # telemetry hook (Epic 6)
  transition → outcome==='success' ? DONE : (checkpoint ? CHECKPOINT_BLOCKED : FAILED)
  finally: session.close()
```
- ⚠️ Thứ tự token: lấy fb_dtsg (4.4) + action-token (4.5) TRƯỚC EXECUTING. consume SAU khi execute (mark used). Nếu execute fail vẫn nên consume? → KHÔNG (token chưa "dùng" cho action thành công; reuse-protection ở consume). Note: consume chỉ khi đã thực thi action (dù outcome gì) để chống replay — quyết định: consume ngay sau executeSelfComment bất kể outcome (token đã tiêu).
- State-machine transition trả typed result — kiểm `!ok` (như 4.3 onTransitionError) để không lệch âm thầm.

### 🔴 Secret hygiene (AC7) — tổng hợp R-D3

- Cookie/2FA (4.3) + fb_dtsg/lsd/jazoest (4.4) + action-token JWT (4.5): KHÔNG log/persist raw.
- `job_actions.action_token` = lưu **`jti`** (reference, không nhạy cảm) — KHÔNG lưu JWT raw (JWT chứa claims, là secret L1667). Test assert job_actions KHÔNG chứa JWT.
- Comment `content` từ template KHÔNG phải secret (user-authored) — OK persist/log.
- Browser `finally close()` (4.3 đã fix leak — reuse SessionHandle.close try/finally).

### Action-executor (T4) — bundled selector (fragile, Epic 5 thay)

```ts
async function executeSelfComment({ page, content, selectors, readBack }): Promise<ActionOutcome> {
  // bundled static selector — vd composer/comment box trên post của chính mình
  const box = page.locator(selectors.commentBox).first()    // hardcode selector
  await box.fill(content)
  await page.locator(selectors.submit).first().click()
  // read-back: comment xuất hiện?
  const appeared = await readBack(page, content)             // tìm content trong comment list
  return appeared ? 'success' : 'selector_miss'
}
```
- Selector hardcode (`SELF_COMMENT_SELECTORS` const) — note "fragile, Epic 5 4-tier resolver thay". Test bằng FB-mock fixture (selector ổn định trong fixture).
- DI `page` (PageLike như 4.3 checkpoint-handler) → unit test fake page (fill/click/locator stub) KHÔNG cần browser.
- target = URL/id post của chính profile (4.6a có thể navigate own feed + lấy post đầu, hoặc nhận target inject; giữ đơn giản — note).

### Backend consume (T8) — mirror issue

```python
def consume_action_token(db, *, token, now=None):
    now = now or _utc_now()
    try:
        claims = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])  # verify exp
    except jwt.ExpiredSignatureError: raise _status_error("ACTION_TOKEN_EXPIRED", "Token hành động đã hết hạn.")
    except jwt.PyJWTError: raise _status_error("ACTION_TOKEN_INVALID", "Token hành động không hợp lệ.")
    row = db.query(ActionToken).filter(ActionToken.jti == claims["jti"]).one_or_none()
    if row is None: raise _status_error("ACTION_TOKEN_INVALID", "Token hành động không tồn tại.")
    if row.used_at is not None: raise _status_error("ACTION_TOKEN_REUSED", "Token hành động đã được sử dụng.")
    row.used_at = now; db.commit()
    return ActionTokenConsumeResponse(jti=row.jti, consumed_at=now)
```
- KHÔNG log token. Status map: EXPIRED 401, INVALID 422, REUSED 409.

### content_templates (T2) + job_actions (T3)

- `content_templates`: 4.6a tạo table + `getRandomTemplate(rng=Math.random→inject)` (deterministic test) + `listTemplates` + seed ≥1 default ('DRAFT' rõ ràng). CRUD (insert/update/delete) + IPC + UI = **4.6b**.
- `job_actions`: `recordAction` insert. `action_token` cột = jti string.
- random pick: inject `rng: () => number` (như 4.1 fingerprint) → test deterministic.

### Edge cases
- Login CHECKPOINT_BLOCKED (4.3) → orchestrator dừng tại đó (KHÔNG extract token/execute), state CHECKPOINT_BLOCKED, record outcome 'checkpoint'.
- action-token offline/deny (4.5) → FAILED, KHÔNG execute, KHÔNG consume.
- content_templates rỗng → outcome 'error' + FAILED (KHÔNG comment rỗng).
- read-back fail (comment không thấy) → 'selector_miss' (FB đổi DOM) → outcome ghi nhận, transition FAILED.
- consume reuse (token đã dùng) → lỗi nhưng action đã thực thi → ghi outcome thực + log non-secret cảnh báo.
- Token-extractor fail (4.4 hết retry) → FAILED trước EXECUTING.

### Scope — KHÔNG làm (→ 4.6b)
- KHÔNG IPC `phase3:automation:start`/`:status` + automation-handlers.
- KHÔNG trigger UI / job-status UI (renderer).
- KHÔNG content_templates CRUD (insert/update/delete IPC + UI). 4.6a chỉ table + read + seed.
- KHÔNG telemetry transport (Epic 6 — chỉ `onActionOutcome` hook).
- KHÔNG Messenger Seeding (Epic 12).
- KHÔNG selector 4-tier/hot-config (Epic 5 — bundled hardcode + note).
- KHÔNG warmup behavior logic (state WARMING_UP chỉ transit).

### Files

| File | Action | Stack |
|---|---|---|
| `src/main/db/client.ts` | UPDATE | + content_templates + job_actions |
| `tests/integration/db-schema.spec.ts` | UPDATE | assert 2 bảng mới |
| `src/main/db/repositories/content-template-repo.ts` | NEW | getRandomTemplate/list/seed |
| `src/main/db/repositories/job-action-repo.ts` | NEW | recordAction |
| `src/main/automation/action-executor.ts` | NEW | executeSelfComment (bundled selector + read-back) |
| `src/main/automation/self-comment-orchestrator.ts` | NEW | runSelfComment (drive state-machine, ráp 4.1-4.5) |
| `src/main/automation/index.ts` | UPDATE | barrel append |
| `src/main/license/action-token-client.ts` | UPDATE | + consumeActionToken |
| `src/shared/api-client/http-client.ts` | UPDATE | + ConsumeResponse schema |
| `backend/app/schemas/automation/action_token.py` | UPDATE | + consume req/res |
| `backend/app/services/automation/action_token.py` | UPDATE | + consume_action_token |
| `backend/app/api/automation.py` | UPDATE | + route consume |
| `backend/tests/automation/test_automation_action_token.py` | UPDATE | + consume tests |
| `tests/unit/{action-executor,self-comment-orchestrator}.spec.ts` | NEW | core logic |
| `tests/integration/{content-template-repo,job-action-repo,self-comment-smoke}.spec.ts` + `tests/fixtures/fb-mock/own-post.html` | NEW | DB + e2e smoke |
| ~~IPC / UI / templates CRUD~~ | — | **4.6b** |

### Previous story intelligence
- **4.2** state-machine: `transition(jobId,to)` typed; EXECUTING→DONE/FAILED/CHECKPOINT_BLOCKED. Kiểm `!ok`.
- **4.3** login-service `login(jobId,profileId)`→{state}; SessionHandle.page+close (try/finally fix). onCheckpoint pattern.
- **4.4** tokenExtractor `extract()`; `fetchHtml=()=>page.content()`. selector_miss hook.
- **4.5** actionTokenClient `requestActionToken` + (mới) `consumeActionToken`; backend issue → +consume; jti reference.
- **fingerprint 4.1** rng inject pattern → áp cho random template.
- **175 client test + backend pytest đang PASS** — đừng phá.

### Testing chi tiết (AC8)
Trọng tâm: orchestrator unit (DI mock tất cả → happy/checkpoint/deny/empty-template/no-leak/cleanup) + executor unit (fake page read-back) + repo integration (SQLCipher) + 1 real-Chromium smoke (FB-mock comment+read-back) + backend consume pytest (success/reuse-409/expired-401/invalid-422). KHÔNG hit facebook.com.

## References
- [Source: epics-phase3.md#Story-4.6 (L429-447)] — AC gốc (split 4.6a/4.6b)
- [Source: architecture.md (L1973-1985)] — end-to-end flow self-comment
- [Source: architecture.md (L1402)] — `job_actions(job_id, action_type, target, action_token, executed_at, outcome)`
- [Source: architecture.md (L1368)] — `action_outcome_category: success|checkpoint|selector_miss|proxy_error|timeout`
- [Source: architecture.md (L1817,L1930)] — `action-executor.ts` action_type='self_comment'
- [Source: 4.2 state-machine + 4.3 login + 4.4 token-extractor + 4.5 action-token (client+backend)] — consume points
- [Source: automation-desktop/CLAUDE.md] — 25 rules (client)

## Dev Agent Record

### Agent Model Used
GPT-5 Codex
### Debug Log References
- `cd automation-desktop && npx playwright test tests/unit/action-executor.spec.ts tests/unit/self-comment-orchestrator.spec.ts tests/unit/action-token-client.spec.ts --reporter=line` → 12 passed.
- `cd automation-desktop && npx playwright test tests/integration/content-template-repo.spec.ts tests/integration/job-action-repo.spec.ts tests/integration/self-comment-smoke.spec.ts tests/integration/db-schema.spec.ts --reporter=line` → 7 passed.
- `cd automation-desktop && npm run lint` → 0 errors; existing Node module-type warning only.
- `cd automation-desktop && npm run typecheck` → 0 errors.
- `cd automation-desktop && npx playwright test tests/unit tests/integration --reporter=line` → 189 passed.
- `cd backend && PHASE3_TEST_DATABASE_URL=postgresql://admin:adminpassword@localhost:5433/phase3_test venv/bin/pytest tests/automation/test_automation_action_token.py -q` → 11 passed, 1 warning.
- `cd backend && PHASE3_TEST_DATABASE_URL=postgresql://admin:adminpassword@localhost:5433/phase3_test venv/bin/pytest tests/automation/ -q` → 46 passed, 1 warning.
- `git diff --check` → passed.
- Artifact/secret hygiene grep for `.phase3-manual/`, `secure-storage`, `.db`, `.review`, `test-results`, `playwright-report` → no suspicious artifacts.
### Completion Notes List
- Added client SQLCipher schema support for `content_templates` and `job_actions`, with repository coverage for deterministic template selection, default seeding, JTI-only action records, FK behavior, and cascade cleanup.
- Added bundled-selector `executeSelfComment` core with fill/submit/read-back verification and a local FB mock smoke path; selectors remain intentionally static for 4.6a and are deferred to Epic 5 resolver work.
- Added headless `runSelfComment` orchestrator wiring state-machine, login/session DI, token extraction, per-action token request/consume, executor, persistence, telemetry hook, and `finally` session cleanup.
- Added backend consume endpoint/service/schema for action-token JWT validation, expiry handling, reuse rejection, DB `used_at` marking, and client `consumeActionToken` support.
- Preserved secret hygiene: raw cookies, 2FA seed, fb tokens, and raw action JWT are not persisted; `job_actions.action_token` stores only the JTI reference.
- Kept 4.6b scope out: no IPC start/status surface, no renderer UI, no content template CRUD UI/IPC, and no telemetry transport.
### File List
- `_bmad-output/implementation-artifacts/4-6a-self-comment-core-e2e.md`
- `_bmad-output/implementation-artifacts/sprint-status-phase3.yaml`
- `automation-desktop/src/main/automation/action-executor.ts`
- `automation-desktop/src/main/automation/index.ts`
- `automation-desktop/src/main/automation/self-comment-orchestrator.ts`
- `automation-desktop/src/main/db/client.ts`
- `automation-desktop/src/main/db/repositories/content-template-repo.ts`
- `automation-desktop/src/main/db/repositories/job-action-repo.ts`
- `automation-desktop/src/main/license/action-token-client.ts`
- `automation-desktop/src/shared/api-client/http-client.ts`
- `automation-desktop/tests/fixtures/content-template-repo-electron-entry.ts`
- `automation-desktop/tests/fixtures/fb-mock/own-post.html`
- `automation-desktop/tests/fixtures/job-action-repo-electron-entry.ts`
- `automation-desktop/tests/integration/content-template-repo.spec.ts`
- `automation-desktop/tests/integration/db-schema.spec.ts`
- `automation-desktop/tests/integration/job-action-repo.spec.ts`
- `automation-desktop/tests/integration/self-comment-smoke.spec.ts`
- `automation-desktop/tests/unit/action-executor.spec.ts`
- `automation-desktop/tests/unit/action-token-client.spec.ts`
- `automation-desktop/tests/unit/self-comment-orchestrator.spec.ts`
- `backend/app/api/automation.py`
- `backend/app/schemas/automation/__init__.py`
- `backend/app/schemas/automation/action_token.py`
- `backend/app/services/automation/action_token.py`
- `backend/tests/automation/test_automation_action_token.py`
### Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-06-03 | 1.0 | Implemented self-comment core headless e2e: client DB/repos, action executor, orchestrator, backend action-token consume, client consume method, and unit/integration/backend coverage | Codex |
| 2026-06-03 | 0.1 | Story created (split từ 4.6) — self-comment core e2e headless: orchestrator + executor + consume + job_actions + content_templates table | Luisphan |
