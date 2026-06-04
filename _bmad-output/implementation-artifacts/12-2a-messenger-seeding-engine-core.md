# Story 12.2a: Messenger Seeding Engine — Core (headless, không IPC/UI)

Status: done

Epic: 12 — Mass Messenger Seeding (Phase 3.4 Growth) · Story: 12.2a (tách từ 12.2) · ID: 12.2a

> ⚠️ **SCOPE — ĐỌC TRƯỚC:** 12.2 (Messenger Seeding Engine) tách **12.2a (core)** + **12.2b (surface)** theo tiền lệ 4.6a/4.6b (single-dev-session sizing). Story này = **CORE engine headless**: executor gửi DM + orchestrator duyệt target + batch rotation + render cá nhân hóa. **KHÔNG** làm IPC/UI/bootstrap wiring (→ 12.2b). Tất cả qua **DI** để unit/integration test KHÔNG cần Chromium/Facebook thật.

## Story

As a developer (lớp core cho user),
I want một engine headless: với 1 profile đã login + danh sách target UID + template, gửi DM Messenger lần lượt (cá nhân hóa `{uid}`/`{name}`), delay ngẫu nhiên, và khi 1 profile bị checkpoint/rate-limit thì dừng profile đó nhưng KHÔNG crash cả batch,
So that 12.2b chỉ cần wire IPC + UI lên engine sẵn có (mirror cách 4.6b wire 4.6a).

## Acceptance Criteria

- **AC1 (Messenger executor)** — `executeMessengerSeed({ page, content }): Promise<ActionOutcome>` (mirror `executeSelfComment`): locate ô soạn tin Messenger (bundled selector, fragile → note Epic 5) → fill `content` → gửi → readback verify. Trả `ActionOutcome` (`success`/`selector_miss`/`checkpoint`/`error`...). Pure DOM qua `CommentPageLike`-style interface, KHÔNG import electron.
- **AC2 (Orchestrator per-profile)** — `runMessengerSeed(jobId, profileId, { targets, vars? }): Promise<MessengerSeedResult>`:
  - login (DI, mirror self-comment) → checkpoint/2FA/login-fail → transition phù hợp + return (KHÔNG gửi).
  - Với **mỗi target** trong `targets` (mảng `{ uid, name? }`): `getRandomTemplate(rng)` → `renderContentTemplate(body, { uid, name })` (reuse 12.1) → `requestActionToken({ actionType: 'message' })` → navigate `https://www.facebook.com/messages/t/{uid}` (DI navigate) → `executeMessengerSeed` → `consumeActionToken` → `recordAction({ actionType: 'message', target: uid, outcome, actionTokenJti })` → **delay ngẫu nhiên** (DI sleep, KHÔNG block test).
  - **Checkpoint/rate-limit giữa chừng** → DỪNG batch của profile này (transition `CHECKPOINT_BLOCKED`, record reason), trả về kết quả partial (đã gửi N/total). KHÔNG throw ra ngoài.
  - Kết thúc bình thường → transition `DONE`. Trả `{ profileId, sent, failed, stoppedReason? , perTarget: [...] }`.
- **AC3 (Batch coordinator + rotation + isolation)** — `runMessengerSeedBatch({ profiles, targets, ... }): Promise<BatchResult>` (pure orchestration):
  - Phân bổ targets cho các profile (round-robin hoặc chia slice — chốt round-robin), chạy **tuần tự từng profile** qua `runMessengerSeed`.
  - 1 profile checkpoint/throw → **isolate**: record lý do, **tiếp tục profile kế tiếp** (try/catch quanh mỗi profile — KHÔNG crash batch). AC gốc: "profile đó dừng, log lý do, profile khác tiếp tục".
  - Aggregate: tổng sent/failed/checkpoint per-profile.
- **AC4 (Per-message recording + secret hygiene)** — Mỗi message ghi 1 row `job_actions` (`actionType:'message'`, `target: uid`, `outcome`, `actionTokenJti`). KHÔNG ghi cookie/token/body-rendered chứa secret vào `result`/log (rule #11). `result` JSON chỉ `{outcome, reason?, sent, total}` (rule: KHÔNG secret trong `automation_jobs.result`).
- **AC5 (Warmup soft-gate + proxy DI — defer hard)** — Warmup (Epic 9) CHƯA có → inject optional `isProfileWarm?(profileId): boolean`; nếu có và `false` → skip profile với reason `NOT_WARMED` (soft gate, KHÔNG block toàn bộ). Proxy riêng mỗi session = trách nhiệm adapter `login` (Epic 3, wire ở 12.2b) — engine KHÔNG tự quản proxy, chỉ nhận session đã có proxy qua `login` DI. Ghi note rõ.
- **AC6 (Test headless + verify)** — Unit: executor (success/selector_miss/checkpoint), orchestrator (multi-target happy + render `{uid}/{name}` đúng per target + checkpoint dừng batch + token request/consume + delay được gọi qua fake + record per-message), batch (round-robin rotation + 1 profile checkpoint vẫn chạy profile khác + aggregate). Tất cả dùng **fake DI** (KHÔNG Chromium/FB/network). Lint + typecheck pass + full suite KHÔNG giảm (baseline hiện tại — chạy `npx playwright test tests/unit tests/integration tests/e2e` để chốt số trước khi bắt đầu, ~246).

## Tasks / Subtasks

### Messenger executor (DOM)
- [x] **T1** — `src/main/automation/messenger-seed-executor.ts`: `MESSENGER_SEED_SELECTORS` (msgBox, sendButton, sentMarker — bundled, comment `// ⚠️ Fragile — Epic 5 4-tier selector resolver`) + `executeMessengerSeed({ page, content, selectors?, readBack? })`. Mirror `action-executor.ts` (dùng `LocatorLike`/`CommentPageLike` từ `./action-executor`). (AC1)
- [x] **T2** — `tests/unit/messenger-seed-executor.spec.ts`: success (fill+send+readback ok), selector_miss (msgBox absent), checkpoint (nếu detect), error (locator throw). Fake page/locator. (AC6)

### Orchestrator per-profile
- [x] **T3** — `src/main/automation/messenger-seed-orchestrator.ts`: types `MessengerTarget = { uid: string; name?: string }`, `MessengerSeedResult`, `MessengerSeedOrchestratorDeps` (login, extractTokens?, actionTokenClient, contentTemplates `getRandomTemplate`, actionExecutor `executeMessengerSeed`, jobActions `recordAction`, stateMachine `transition`, render = `renderContentTemplate`, navigate DI, sleep DI `(ms)=>Promise`, rng, now/nowMs, isProfileWarm?, onActionOutcome?, onTransitionError?). `createMessengerSeedOrchestrator(deps).runMessengerSeed(jobId, profileId, {targets})`. Mirror `self-comment-orchestrator.ts` (login gating → loop targets → token → navigate → execute → record → delay → checkpoint stops). (AC2/AC4/AC5)
- [x] **T4** — `tests/unit/messenger-seed-orchestrator.spec.ts`: (a) 3 target happy → 3 record `actionType:'message'`, render `{uid}/{name}` đúng per target, token request+consume mỗi message, sleep gọi giữa các message (fake), transition DONE; (b) checkpoint ở target #2 → DỪNG, record reason, transition CHECKPOINT_BLOCKED, KHÔNG gửi target #3; (c) login fail → FAILED, KHÔNG gửi; (d) `isProfileWarm=false` → skip reason NOT_WARMED; (e) secret hygiene: `JSON.stringify(result)` KHÔNG chứa token/cookie. (AC6)

### Batch coordinator
- [x] **T5** — `src/main/automation/messenger-seed-batch.ts`: `runMessengerSeedBatch({ profiles: string[], targets: MessengerTarget[], createJobId, runProfile })` — round-robin chia targets → từng profile gọi `runProfile(jobId, profileId, slice)` trong try/catch (isolate) → aggregate `{ perProfile: [...], totalSent, totalFailed, totalCheckpoint }`. Pure (nhận `runProfile` qua DI = orchestrator.runMessengerSeed). (AC3)
- [x] **T6** — `tests/unit/messenger-seed-batch.spec.ts`: 2 profile + 5 target → round-robin chia đúng (3/2); profile #1 throw/checkpoint → profile #2 vẫn chạy (isolate); aggregate đếm đúng. Fake `runProfile`. (AC3/AC6)

### Wiring exports + verify
- [x] **T7** — `src/main/automation/index.ts`: export `executeMessengerSeed`, `MESSENGER_SEED_SELECTORS`, `createMessengerSeedOrchestrator`, `runMessengerSeedBatch` + types. (KHÔNG đụng export cũ.)
- [x] **V** — `cd automation-desktop && npm run typecheck` + `npm run lint` (0 errors kể cả test mới) + `npx playwright test tests/unit tests/integration tests/e2e --reporter=line` (≥ baseline). Pre-commit secret guard.

### Review Findings
- [x] [Review][Patch] Messenger checkpoint/empty-target terminal transitions are invalid and ignored [automation-desktop/src/main/automation/messenger-seed-orchestrator.ts:185]
- [x] [Review][Patch] Default checkpoint selector is not parseable by Playwright, so checkpoint text detection is disabled [automation-desktop/src/main/automation/messenger-seed-executor.ts:27]
- [x] [Review][Patch] Default readback can report success from unsent composer draft text [automation-desktop/src/main/automation/messenger-seed-executor.ts:48]
- [x] [Review][Patch] Batch checkpoint aggregate misses pre-target checkpoint/2FA/rate-limit stops [automation-desktop/src/main/automation/messenger-seed-batch.ts:37]
- [x] [Review][Patch] Batch with targets but no profiles reports zero failures [automation-desktop/src/main/automation/messenger-seed-batch.ts:29]

> **D1 (defer → 12.2b):** IPC `phase3:messenger:start|status` + schemas + channelRegistry; UI nhập/paste target UID + chọn template + nút trigger + progress poll; `electron-bootstrap` wire orchestrator+batch + proxy/playwright adapter thật + action type 'message' backend. **→ Epic khác:** warmup enforcement (Epic 9.1); 4-tier Messenger selector (Epic 5); Target List CRUD + filter đã-gửi/chưa-gửi (12.3); rate-limit adaptive throttle (Epic 9/10).

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules) + `automation-desktop/project-context.md`

### Mirror pattern sẵn có — ĐỪNG phát minh lại
Engine này song song 1-1 với self-comment (4.6a). Copy cấu trúc, đổi action.

| Self-comment (4.6a — mẫu) | Messenger-seed (12.2a — viết mới) |
|---|---|
| `action-executor.ts` → `executeSelfComment` | `messenger-seed-executor.ts` → `executeMessengerSeed` |
| `self-comment-orchestrator.ts` → `runSelfComment` (1 action) | `messenger-seed-orchestrator.ts` → `runMessengerSeed` (loop N target) |
| (không có batch) | `messenger-seed-batch.ts` → rotation + isolation |
| `actionType: 'comment'` | `actionType: 'message'` |
| `getRandomTemplate` → `template.body` raw | `getRandomTemplate` → **`renderContentTemplate(body, {uid,name})`** (reuse 12.1) |

### 🔴 Reuse bắt buộc (KHÔNG tạo lại)
- **`renderContentTemplate`** từ `src/shared/content-template-render.ts` (Story 12.1) — đây CHÍNH là consumer production mà 12.1 chờ đợi. `render(template.body, { uid: target.uid, name: target.name })`.
- **`getRandomTemplate(rng)`** từ `content-template-repo.ts` — chọn template ngẫu nhiên mỗi message.
- **`ActionTokenClient`** (`requestActionToken({actionType:'message'})` + `consumeActionToken`) — Epic 4.5. Signature: `requestActionToken(request: {actionType: string}): Promise<ActionToken>`; `ActionToken` có `.token`, `.jti`.
- **`JobActionRepository.recordAction`** — `{ jobId, actionType, target, actionTokenJti, executedAt, outcome }`.
- **`AutomationStateMachine.transition(jobId, to, {result?})`** — states reuse: `PENDING→ACQUIRING_PROXY→LOGGING_IN→WARMING_UP→EXECUTING→DONE|CHECKPOINT_BLOCKED|FAILED`. KHÔNG thêm state mới.
- **`ActionOutcome`** (`action-executor.ts`): `success|checkpoint|selector_miss|proxy_error|timeout|error`. **KHÔNG thêm `rate_limited`** (Epic 9/10 territory) → map rate-limit → `checkpoint` + reason `'RATE_LIMITED'`.

### 🔴 Batch resilience (AC3) — KHÔNG crash batch
```ts
for (const profileId of profiles) {
  const slice = assignment.get(profileId) ?? []
  try {
    const r = await runProfile(createJobId(), profileId, slice)
    perProfile.push(r)
  } catch (err) {
    // isolate: 1 profile chết KHÔNG dừng batch (rule #11: log non-secret)
    perProfile.push({ profileId, sent: 0, failed: slice.length, stoppedReason: 'PROFILE_ERROR' })
  }
}
```

### 🔴 Secret hygiene (AC4)
- `automation_jobs.result` + log CHỈ `{outcome, reason, sent, total}` — KHÔNG cookie/token/2FA/fb_dtsg/body-đã-render (body có thể vô hại nhưng đừng đổ vào result để giữ thói quen). `actionTokenJti` OK (reference, không phải secret nặng).
- KHÔNG log `target.uid` kèm cookie. uid là public id, OK log riêng.

### Personalization (AC2) — nguồn `name`
- `target = { uid, name? }`. 12.2a nhận sẵn qua param (12.3 Target List sẽ cấp uid+name). Nếu `name` undefined → `renderContentTemplate` tự thay `{name}` → `''` (đã test ở 12.1). KHÔNG fetch name từ FB (defer).

### Delay ngẫu nhiên (AC2) — DI để test KHÔNG chờ thật
- Inject `sleep: (ms: number) => Promise<void>` + tính `ms` từ `rng()` (vd `min + rng()*(max-min)`). Test inject `sleep = async () => {}` + assert số lần gọi. KHÔNG dùng `setTimeout` trực tiếp trong logic (rule: testable).

### Edge cases
- `targets` rỗng → trả `{sent:0, failed:0}` ngay, transition DONE (không lỗi).
- Template repo rỗng (`getRandomTemplate` undefined) → FAILED reason `TEMPLATE_MISSING` (mirror self-comment), KHÔNG gửi.
- 1 target executor `selector_miss` → record `selector_miss`, **tiếp tục** target kế (selector_miss KHÁC checkpoint — không dừng batch profile); chỉ `checkpoint` mới dừng profile.
- profile login fail → FAILED, perProfile ghi failed=slice.length.
- navigate tới `/messages/t/{uid}` lỗi (uid sai) → executor/navigate throw → catch → record error cho target đó → tiếp tục.

### Scope — KHÔNG làm (12.2a)
- 🚫 KHÔNG IPC/schema/channelRegistry (→ 12.2b).
- 🚫 KHÔNG UI/renderer (→ 12.2b).
- 🚫 KHÔNG `electron-bootstrap` wiring / proxy adapter / playwright adapter thật (→ 12.2b).
- 🚫 KHÔNG warmup enforcement cứng (Epic 9) — chỉ soft-gate DI.
- 🚫 KHÔNG Target List CRUD (12.3); KHÔNG selector 4-tier (Epic 5); KHÔNG launch Chromium thật trong test.

### Files
| File | Action | Ghi chú |
|---|---|---|
| `src/main/automation/messenger-seed-executor.ts` | NEW | DOM send DM (mirror action-executor) |
| `src/main/automation/messenger-seed-orchestrator.ts` | NEW | loop target + render + token + record + delay + checkpoint-stop |
| `src/main/automation/messenger-seed-batch.ts` | NEW | round-robin + per-profile isolation + aggregate |
| `src/main/automation/index.ts` | UPDATE | export 4 symbol mới + types |
| `tests/unit/messenger-seed-executor.spec.ts` | NEW | executor outcomes |
| `tests/unit/messenger-seed-orchestrator.spec.ts` | NEW | multi-target/checkpoint/render/secret |
| `tests/unit/messenger-seed-batch.spec.ts` | NEW | rotation + isolation + aggregate |

### Previous story intelligence
- **4.6a** `self-comment-orchestrator.ts` — mẫu CHÍNH: login gating (LOGIN_FAILED/CHECKPOINT/TWO_FA), `transition(deps,jobId,to,{result})`, `safeResult(outcome,reason)`, `record`, `emit`, `finally session.close()`. Copy y hệt, đổi action thành loop.
- **4.6a** `action-executor.ts` — mẫu `executeSelfComment`: `locator(sel).first()` → `exists()` → `fill` → `click` → `readBack`. `LocatorLike`/`CommentPageLike` reuse được.
- **4.6b** `automation-handlers.ts` fire-and-forget + status — **dùng ở 12.2b**, KHÔNG phải giờ.
- **12.1** `renderContentTemplate(body,{uid,name})` — consumer chính là story này.
- **Baseline test** sau 12.1: ~246 passed (chạy lại để chốt). ĐỪNG phá.

### Testing chi tiết (AC6)
- Tất cả unit, fake DI: fake `login` trả session với fake `page.locator`, fake `actionTokenClient`, fake `contentTemplates.getRandomTemplate`, fake `jobActions.recordAction` (push vào array), fake `stateMachine.transition` (push state), `sleep = async()=>{}`, `rng = ()=>0`, `render = renderContentTemplate` (THẬT — để verify personalization).
- Assert: số record = số target gửi, `actionType==='message'`, target===uid, body render đúng (`{uid}`→uid, `{name}`→name), token consume gọi, checkpoint dừng đúng chỗ, batch isolation.

## References
- [Source: epics-phase3.md#Story-12.2 (L807-821)] — Messenger Seeding Engine AC gốc
- [Source: epics-phase3.md#Epic-12 (L784-790)] — blast radius cao, phân biệt self-comment
- [Source: src/main/automation/self-comment-orchestrator.ts] — mẫu orchestrator (copy structure)
- [Source: src/main/automation/action-executor.ts] — mẫu executor + ActionOutcome + LocatorLike
- [Source: src/shared/content-template-render.ts] — renderContentTemplate (12.1, reuse)
- [Source: src/main/license/action-token-client.ts] — requestActionToken({actionType}) + consumeActionToken
- [Source: src/main/db/repositories/job-action-repo.ts] — recordAction signature
- [Source: src/shared/types/automation-job.ts] — states (KHÔNG thêm mới)
- [Source: automation-desktop/CLAUDE.md] — 25 rules (#1 adapter, #11 no-secret-log, #15 VN message, #18 unit test, #21 file structure)

### Project Structure Notes
- 3 file mới đều ở `src/main/automation/` (đúng domain folder, rule #21). Pure logic + DI → KHÔNG import electron (rule #1).
- KHÔNG đụng adapter/preload/db schema/ipc. KHÔNG conflict cấu trúc.
- Biến thể: rate-limit map về `checkpoint` outcome (không mở rộng enum) — đã giải thích, giữ enum ổn định cho Epic 9/10.

## Dev Agent Record
### Agent Model Used
Codex GPT-5 (2026-06-04)

### Debug Log References
- 2026-06-04: Baseline trước khi code mới: `npx playwright test tests/unit tests/integration tests/e2e --reporter=line` trong `automation-desktop/` → `251 passed`.
- 2026-06-04: RED phase: chạy 3 spec mới trước implementation → fail do thiếu `messenger-seed-executor`, `messenger-seed-orchestrator`, `messenger-seed-batch`.
- 2026-06-04: Targeted GREEN: `npx playwright test tests/unit/messenger-seed-executor.spec.ts tests/unit/messenger-seed-orchestrator.spec.ts tests/unit/messenger-seed-batch.spec.ts --reporter=line` → `12 passed`.
- 2026-06-04: `npm run typecheck` → pass.
- 2026-06-04: `npm run lint` → pass exit code 0; còn 1 warning cũ `src/main/adapters/electron-bootstrap.ts:231 no-direct-logger` không thuộc story.
- 2026-06-04: Full regression: `npx playwright test tests/unit tests/integration tests/e2e --reporter=line` → `263 passed`.
- 2026-06-04: Secret grep guard trên source Messenger mới không phát hiện token/cookie/body render trong production source; secret markers chỉ nằm trong test fixtures/assertions.
- 2026-06-04: Code-review patches applied: valid terminal transitions for no-target/checkpoint paths, parseable Messenger checkpoint selector, draft-safe readback, checkpoint aggregate for pre-target stops, and no-profile batch failure accounting.
- 2026-06-04: Post-review targeted regression: `npx playwright test tests/unit/messenger-seed-executor.spec.ts tests/unit/messenger-seed-orchestrator.spec.ts tests/unit/messenger-seed-batch.spec.ts tests/unit/state-machine.spec.ts --reporter=line` → `23 passed`.
- 2026-06-04: Post-review `npm run typecheck` → pass.
- 2026-06-04: Post-review full regression: `npx playwright test tests/unit tests/integration tests/e2e --reporter=line` → `267 passed`.
- 2026-06-04: Post-review `npm run lint` → pass exit code 0; còn 1 warning cũ `src/main/adapters/electron-bootstrap.ts:231 no-direct-logger` không thuộc story.
- 2026-06-04: Final targeted regression after format cleanup: `npx playwright test tests/unit/messenger-seed-executor.spec.ts tests/unit/messenger-seed-batch.spec.ts tests/unit/state-machine.spec.ts --reporter=line` → `18 passed`.

### Completion Notes List
- Implemented headless Messenger seed executor with bundled fragile selectors, checkpoint detection, fill/send/readback verification, and no Electron import.
- Implemented per-profile Messenger seed orchestrator with DI-only login/navigation/sleep/render/token/action recording, per-target personalization via `renderContentTemplate`, checkpoint stop behavior, warmup soft-gate, and safe terminal result JSON.
- Implemented pure batch coordinator with round-robin target distribution, per-profile try/catch isolation, and sent/failed/checkpoint aggregation.
- Added unit coverage for executor outcomes, orchestrator happy/checkpoint/login-fail/not-warmed/secret-hygiene flows, and batch rotation/isolation/aggregate flows.
- Resolved review findings with regression coverage for real Playwright checkpoint selector parsing, draft-safe readback, checkpoint aggregate edge cases, no-profile batches, and state-machine terminal transitions used by Messenger seeding.
- Exported all new core symbols and types from `src/main/automation/index.ts`; IPC/UI/bootstrap wiring intentionally deferred to 12.2b.

### File List
- `automation-desktop/src/main/automation/messenger-seed-executor.ts`
- `automation-desktop/src/main/automation/messenger-seed-orchestrator.ts`
- `automation-desktop/src/main/automation/messenger-seed-batch.ts`
- `automation-desktop/src/main/automation/state-machine.ts`
- `automation-desktop/src/main/automation/index.ts`
- `automation-desktop/tests/unit/messenger-seed-executor.spec.ts`
- `automation-desktop/tests/unit/messenger-seed-orchestrator.spec.ts`
- `automation-desktop/tests/unit/messenger-seed-batch.spec.ts`
- `automation-desktop/tests/unit/state-machine.spec.ts`
- `_bmad-output/implementation-artifacts/12-2a-messenger-seeding-engine-core.md`
- `_bmad-output/implementation-artifacts/sprint-status-phase3.yaml`
