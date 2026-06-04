# Story 12.2b: Messenger Seeding — Surface (IPC start/status + UI trigger + bootstrap wiring)

Status: review

Epic: 12 — Mass Messenger Seeding (Phase 3.4 Growth) · Story: 12.2b (tách từ 12.2) · ID: 12.2b

> ⚠️ **SCOPE — ĐỌC TRƯỚC:** Lớp **surface** wire engine 12.2a (`createMessengerSeedOrchestrator` + `runMessengerSeedBatch` — đã DONE) ra IPC + UI cho user trigger seeding + theo dõi progress. Mirror trio handler+api+view của 4.6b. **KHÔNG** sửa logic engine 12.2a (trừ khi thiếu hook). **KHÔNG** làm Target List CRUD persistence (→ 12.3 — 12.2b chỉ paste/parse UID tại chỗ).

## Story

As a user,
I want bấm nút chạy Messenger Seeding cho 1+ profile với danh sách UID dán vào + template, rồi theo dõi tiến trình (đã gửi/tổng, trạng thái từng profile),
So that tôi seeding DM hàng loạt qua UI (đóng phần surface của Epic 12 Messenger Seeding sau khi engine 12.2a xong).

## Acceptance Criteria

- **AC1 (Start IPC — fire-and-forget batch)** — `phase3:messenger:start` request `{ profileIds: string[], targets: {uid, name?}[] }` → tạo 1 job/profile (`createJob` type `messenger_seed`) → chạy `runMessengerSeedBatch` **fire-and-forget** (KHÔNG await trong handler — batch dài) → trả `{ jobIds: string[] }` ngay. Zod 2-way (request strict + response `.parse()`) + ErrorEnvelope VN + `retryable`. Validate: `profileIds` non-empty, `targets` non-empty, mỗi `uid` non-empty.
- **AC2 (Status IPC — batch-aware)** — `phase3:messenger:status` request `{ jobIds: string[] }` → mỗi job đọc `automation_jobs` state + đếm `job_actions` (sent = số outcome `success`, total = số action đã ghi) → trả `{ jobs: [{ jobId, state, sent, total, reason? }] }`. KHÔNG leak cookie/token/secret (rule #11). (Reuse được `automation_jobs`/`job_actions` của 4.x.)
- **AC3 (Trigger UI)** — View/section Messenger Seeding: (a) textarea paste target UID — 1 dòng/UID, hỗ trợ format `uid` hoặc `uid|name` (parse tại chỗ, KHÔNG persist → 12.3); (b) multi-select profile (từ `listProfiles`); (c) nút "Chạy seeding" → `messenger:start` → poll `messenger:status`. Disable nút khi đang chạy (async button rule #17). Loading/empty/error state riêng (rule #16, class+testid riêng). Hiển thị progress per-profile: state VN + `sent/total`.
- **AC4 (Template — reuse 12.1, render placeholder)** — Seeding chọn template ngẫu nhiên (engine `getRandomTemplate`) + render `{uid}`/`{name}` per target (engine đã làm qua `renderContentTemplate`). UI KHÔNG cần chọn template cụ thể (random theo design). Hiển thị hint: "Seeding dùng template ngẫu nhiên trong kho; quản lý template ở tab Content Templates."
- **AC5 (Bootstrap wiring)** — `electron-bootstrap.ts`: khởi tạo `createMessengerSeedOrchestrator` (deps thật: login adapter [reuse/adapt `createSelfCommentLoginAdapter` shape → `MessengerSeedLoginResult`], `actionExecutor: { executeMessengerSeed }`, `actionTokenClient`, `contentTemplates: contentTemplateRepo`, `jobActions: jobActionRepo`, `stateMachine`, `render: renderContentTemplate`, `navigate` thật, `sleep: (ms)=>new Promise(r=>setTimeout(r,ms))`, `rng: Math.random`, `now/nowMs`, `delayRangeMs` cấu hình) + register `messenger-handlers`. Stub khi `PHASE3_AUTOMATION_STUB=1` (e2e KHÔNG launch Chromium/FB thật).
- **AC6 (Cross-feature guard — finding từ review 12.1)** — Vì `content_templates` dùng CHUNG self-comment ↔ seeding: template chứa `{uid}`/`{name}` nếu bị self-comment chọn → post literal lên FB. 12.2b xử lý tối thiểu: **cảnh báo UI** ở tab Content Templates (hoặc seeding) rằng placeholder CHỈ resolve khi seeding, self-comment sẽ post nguyên văn. (Tách template set per-feature = defer 12.3/sau.)
- **AC7 (Secret + test)** — start/status KHÔNG leak cookie/token (chỉ jobId/state/sent/total/reason). Tests: integration `messenger-ipc-handlers.spec.ts` (Zod 2-way, start fire-and-forget không block + trả jobIds, status đọc state+count, no-secret, invalid payload → VALIDATION_ERROR); e2e `messenger-seeding.spec.ts` (paste UID + chọn profile + trigger + progress hiển thị, **stub batch** — KHÔNG Chromium thật). Lint/typecheck pass + full suite KHÔNG giảm (chạy full suite chốt baseline trước khi bắt đầu).

## Tasks / Subtasks

### IPC schemas
- [x] **T1** — `src/shared/ipc-schemas/messenger.ts` + `index.ts`: `MessengerStartRequestSchema { profileIds: z.array(z.string().min(1)).min(1), targets: z.array(z.object({uid: z.string().trim().min(1), name: z.string().optional()})).min(1) }.strict()` / `Response { jobIds: string[] }`; `MessengerStatusRequestSchema { jobIds: z.array(z.string().min(1)).min(1) }` / `Response { jobs: [{ jobId, state(enum AUTOMATION_JOB_STATES), sent: z.number().int(), total: z.number().int(), reason? }] }`; ErrorEnvelope union. Đăng ký 2 channel `phase3:messenger:start|status` vào `channelRegistry` (rule #6). (AC1/AC2)

### Handlers
- [x] **T2** — `src/main/ipc/messenger-handlers.ts`: `registerMessengerHandlers(ipcMain, { orchestrator, batch: runMessengerSeedBatch, stateMachine, jobRepo, jobActions })`. start: safeParse → tạo jobId/profile → `void runMessengerSeedBatch({profiles, targets, createJobId, runProfile: (jid,pid,t)=>orchestrator.runMessengerSeed(jid,pid,{targets:t})}).catch(log non-secret)` → return `{jobIds}`. status: mỗi jobId → `jobRepo.getJob` + đếm job_actions (cần thêm `countByJob`/`countSuccessByJob` vào `job-action-repo` nếu chưa có). Mirror `automation-handlers.ts` (Zod 2-way, ErrorEnvelope VN, retryable). (AC1/AC2/AC7)
- [x] **T2.1** — `job-action-repo.ts`: + `countByJob(jobId): number` + `countSuccessByJob(jobId): number` (nếu chưa có) cho status sent/total. (AC2)

### Renderer API + UI
- [x] **T3** — `src/renderer/src/api/messenger-api.ts`: `startMessengerSeeding(req)`, `getMessengerStatus(jobIds)` (mirror `automation-api.ts`). (AC3)
- [x] **T4** — `src/renderer/src/views/MessengerSeedingView.tsx` (+ route trong `App.tsx`): textarea paste UID (parse `uid` / `uid|name`), profile multi-select (`listProfiles`), nút trigger (async disable rule #17), poll status → progress per-profile (state VN + sent/total), loading/empty/error riêng (rule #16). Hint template random. (AC3/AC4)
- [x] **T5** — Cảnh báo cross-feature placeholder ở UI (AC6): text trong `ContentTemplatesView` hoặc MessengerSeedingView. (AC6)

### Wiring + tests
- [x] **T6** — `electron-bootstrap.ts`: tạo messenger orchestrator (deps thật + sleep/navigate/render) + register messenger handlers + stub khi `PHASE3_AUTOMATION_STUB=1`. (AC5)
- [x] **T7** — Tests: integration `messenger-ipc-handlers.spec.ts` (Zod 2-way, fire-and-forget trả jobIds không block, status state+count, no-secret, invalid→VALIDATION_ERROR); e2e `messenger-seeding.spec.ts` (paste+select+trigger+progress, stub). (AC7)
- [x] **V** — typecheck + lint (0 errors) + full suite ≥ baseline. Pre-commit secret guard.

> **D1 (defer):** Target List CRUD persistence + filter đã-gửi/chưa-gửi (→ 12.3); chọn template cụ thể cho seeding (hiện random); tách template set self-comment vs seeding (AC6 chỉ cảnh báo); backend `action_type='message'` (xem ⚠️ Risk); warmup enforcement (Epic 9); 4-tier Messenger selector (Epic 5); rate-limit adaptive throttle (Epic 9/10).

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules) + `automation-desktop/project-context.md`

### 🔴 RISK — backend `action_type='message'` (cần xác nhận trước khi chạy thật)
Engine gọi `actionTokenClient.requestActionToken({ actionType: 'message' })`. Backend (Epic 4.5) hiện mới hỗ trợ `'comment'`. **Trước khi seeding chạy production thật**, backend phải accept `action_type='message'` (`backend/app/services/automation/action_token.py` + schema). 12.2b IPC/UI/test xây + verify được qua **stub** (KHÔNG cần backend), nhưng note rõ đây là prerequisite cho real run. KHÔNG tự sửa backend trong story này trừ khi được yêu cầu (scope = desktop surface).

### Mirror pattern sẵn có — ĐỪNG phát minh lại
| 4.6b (self-comment surface — mẫu) | 12.2b (messenger surface) |
|---|---|
| `ipc-schemas/automation.ts` (start/status) | `ipc-schemas/messenger.ts` (start/status, **array** profileIds+targets+jobIds) |
| `ipc/automation-handlers.ts` (fire-and-forget + status) | `ipc/messenger-handlers.ts` (fire-and-forget **batch** + status đếm job_actions) |
| `api/automation-api.ts` | `api/messenger-api.ts` |
| trigger trong `ProfilesView.tsx` | `MessengerSeedingView.tsx` (view riêng — seeding khác scope per-profile) |
| `electron-bootstrap` wire self-comment orchestrator | wire messenger orchestrator + batch |

### 🔴 Engine 12.2a API (đã DONE — wire vào, KHÔNG sửa)
```ts
// từ '../automation'
createMessengerSeedOrchestrator(deps).runMessengerSeed(jobId, profileId, { targets: MessengerTarget[] })
  : Promise<MessengerSeedResult /* {profileId, sent, failed, stoppedReason?, perTarget[]} */>
runMessengerSeedBatch({ profiles: string[], targets: MessengerTarget[], createJobId, runProfile })
  : Promise<MessengerSeedBatchResult /* {perProfile[], totalSent, totalFailed, totalCheckpoint} */>
// MessengerTarget = { uid: string; name?: string }
// MessengerSeedOrchestratorDeps: stateMachine, login, actionTokenClient, contentTemplates{getRandomTemplate},
//   actionExecutor{executeMessengerSeed}, jobActions{recordAction}, render?, navigate?, sleep, rng, now, nowMs,
//   delayRangeMs?, isProfileWarm?, onActionOutcome?, onTransitionError?
```
- `login` cần trả `MessengerSeedLoginResult` (shape giống `SelfCommentLoginResult`). Reuse logic `createSelfCommentLoginAdapter` (electron-bootstrap) — có thể generic hóa hoặc copy adapter đổi return type. Session `MessengerSeedSession.page` cần `goto` (navigate tới `/messages/t/{uid}`).

### 🔴 Fire-and-forget batch (AC1) — handler KHÔNG await
`runMessengerSeedBatch` chạy vài chục giây→phút (N profile × M target). Handler `void ...batch(...).catch(log non-secret)` rồi return `{jobIds}` NGAY. Renderer poll `messenger:status`. (Mirror guardrail 4.6b — block = renderer treo + IPC timeout.)

### 🔴 Secret hygiene (AC7)
- start/status trả CHỈ jobId/state/sent/total/reason — KHÔNG cookie/2FA/token/body-rendered. `automation_jobs.result` đã được engine giữ sạch (12.2a AC4). Rule #11: KHÔNG log cookie/token.

### Status sent/total (AC2)
- `state` từ `automation_jobs` (state-machine). `total` = `countByJob(jobId)` (số job_actions đã ghi cho job đó). `sent` = `countSuccessByJob(jobId)` (outcome='success'). `total` tăng dần khi engine record từng message → progress real-time qua poll. (Engine record per-message ở 12.2a.)

### Parse target UID (AC3) — tại chỗ, KHÔNG persist
- textarea: mỗi dòng `uid` hoặc `uid|name`. Parse: split `\n`, trim, bỏ dòng rỗng, split `|` → `{uid, name?}`. Validate uid non-empty client-side trước khi gửi. Persistence (target_lists table) = 12.3.

### Edge cases
- `profileIds` rỗng / `targets` rỗng → VALIDATION_ERROR (client disable nút + server reject).
- jobId không tồn tại trong status → bỏ qua hoặc state 'không xác định' (đừng crash cả batch status).
- profile đang seeding bị xóa → status job có thể JOB_NOT_FOUND → UI hiển thị nhẹ, KHÔNG spam (học finding 4.6b orphan-poll: clear khi xong/terminal).
- Tất cả job terminal → dừng poll.

### Scope — KHÔNG làm (12.2b)
- 🚫 KHÔNG sửa engine 12.2a (executor/orchestrator/batch) trừ thêm `job-action-repo.countByJob/countSuccessByJob`.
- 🚫 KHÔNG Target List CRUD/persistence (→ 12.3).
- 🚫 KHÔNG sửa backend action_type (note risk, defer).
- 🚫 KHÔNG warmup enforcement / 4-tier selector / rate-limit throttle.
- 🚫 KHÔNG launch Chromium thật trong e2e (stub).

### Files
| File | Action | Ghi chú |
|---|---|---|
| `src/shared/ipc-schemas/messenger.ts` + `index.ts` | NEW/UPDATE | start/status schemas + channelRegistry 2 channel |
| `src/main/ipc/messenger-handlers.ts` | NEW | fire-and-forget batch + status |
| `src/main/db/repositories/job-action-repo.ts` | UPDATE | + countByJob / countSuccessByJob |
| `src/renderer/src/api/messenger-api.ts` | NEW | start/status client |
| `src/renderer/src/views/MessengerSeedingView.tsx` + `App.tsx` | NEW/UPDATE | UI paste+select+trigger+progress |
| `src/renderer/src/views/ContentTemplatesView.tsx` (hoặc seeding view) | UPDATE | cảnh báo placeholder cross-feature (AC6) |
| `src/main/adapters/electron-bootstrap.ts` | UPDATE | wire orchestrator+batch + register handlers + stub |
| `src/renderer/src/assets/main.css` | UPDATE | style view seeding |
| `tests/integration/messenger-ipc-handlers.spec.ts` | NEW | Zod/fire-and-forget/status/no-secret |
| `tests/e2e/messenger-seeding.spec.ts` | NEW | UI trigger + progress (stub) |

### Previous story intelligence
- **12.2a** (DONE, đã review): engine `createMessengerSeedOrchestrator`/`runMessengerSeedBatch`/`executeMessengerSeed` export từ `../automation`. Review patches đã fix: checkpoint terminal transitions, selector parseable, readback unsent-draft, batch pre-target checkpoint aggregate. → engine TIN CẬY, chỉ wire.
- **4.6b** (DONE): mẫu CHÍNH cho surface — `automation-handlers.ts` fire-and-forget (`void orchestrator.run(...).catch()`), `automation.ts` Zod strict 2-way + ErrorEnvelope VN + retryable, `automation-api.ts`, ProfilesView trigger + poll, `electron-bootstrap` wiring + `PHASE3_AUTOMATION_STUB`. Bài học review 4.6b: fire-and-forget KHÔNG await; status no-secret; orphan-poll cleanup khi terminal.
- **12.1** (DONE): `renderContentTemplate` — engine 12.2a đã dùng; UI seeding chỉ cần hint.
- Baseline test: chạy full suite chốt số trước khi bắt đầu (12.2a đã thêm nhiều test). ĐỪNG phá.

### Testing chi tiết (AC7)
- integration `messenger-ipc-handlers.spec.ts`: FakeIpcMain (mirror `automation-ipc-handlers.spec.ts`) — start với stub batch async → trả jobIds NGAY (Date.now diff < 500ms, không block); createJob gọi/profile; status đọc state + count (fake jobRepo/jobActions); no-secret (`JSON.stringify(res)` không match cookie|token); invalid `{profileIds:[]}` → VALIDATION_ERROR.
- e2e `messenger-seeding.spec.ts` (@playwright/test Electron, `PHASE3_AUTOMATION_STUB=1`): license active → mở MessengerSeedingView → paste `123\n456|Bob` → chọn profile → trigger → progress hiển thị (state + sent/total từ stub). KHÔNG Chromium/FB thật.

## References
- [Source: epics-phase3.md#Story-12.2 (L807-821)] — Messenger Seeding AC gốc (surface phần này)
- [Source: 12-2a-messenger-seeding-engine-core.md] — engine API đã DONE (wire vào)
- [Source: src/main/automation/messenger-seed-orchestrator.ts + messenger-seed-batch.ts] — chữ ký engine
- [Source: src/main/ipc/automation-handlers.ts + shared/ipc-schemas/automation.ts + renderer/api/automation-api.ts] — mirror trio 4.6b
- [Source: src/main/adapters/electron-bootstrap.ts] — mẫu wire orchestrator + createSelfCommentLoginAdapter + stub
- [Source: src/shared/ipc-schemas/index.ts] — channelRegistry (đăng ký channel mới)
- [Source: src/main/db/repositories/job-action-repo.ts] — + countByJob/countSuccessByJob
- [Source: automation-desktop/CLAUDE.md] — 25 rules (#6 channel, #7 Zod 2-way, #8/#9 ErrorEnvelope+retryable, #11 no-secret, #15 VN, #16 state, #17 async button)

### Project Structure Notes
- Mirror 4.6b trio + view riêng. Channel `phase3:messenger:*` (rule #6 format). KHÔNG đụng engine 12.2a (trừ job-action-repo count helper).
- Login adapter: cân nhắc generic hóa `createSelfCommentLoginAdapter` → dùng chung cho cả self-comment + messenger (cùng login flow), tránh duplicate. Nếu generic hóa, KHÔNG phá self-comment (4.6b đang DONE).
- Biến thể: status đếm `job_actions` cho progress (4.6b chỉ trả state đơn) — mở rộng hợp lý cho batch seeding.

## Dev Agent Record
### Agent Model Used

Codex GPT-5 — 2026-06-04

### Debug Log References

- Baseline full suite trước implementation: `cd automation-desktop && npx playwright test tests/unit tests/integration tests/e2e --reporter=line` → 267 passed.
- RED phase xác nhận thiếu surface: chưa có `messenger-handlers`/IPC/UI cho Story 12.2b.
- Target integration: `npx playwright test tests/integration/messenger-ipc-handlers.spec.ts --reporter=line` → 3 passed.
- Typecheck: `npm run typecheck` → pass.
- Build: `npm run build` → pass; build cần chạy trước e2e để cập nhật `out/renderer`.
- Target integration + e2e: `npx playwright test tests/integration/messenger-ipc-handlers.spec.ts tests/e2e/messenger-seeding.spec.ts --reporter=line` → 4 passed.
- Lint: `npm run lint` → pass exit 0; còn 1 warning sẵn có `phase3-security/no-direct-logger` tại `src/main/adapters/electron-bootstrap.ts` quanh login adapter `console.warn`.
- Full regression sau implementation: `npx playwright test tests/unit tests/integration tests/e2e --reporter=line` → 271 passed.

### Completion Notes List

- Added Messenger start/status IPC schemas and channel registry entries for `phase3:messenger:start` and `phase3:messenger:status` with strict request validation and response parsing.
- Added Messenger IPC handlers: start creates one `messenger_seed` job per profile, launches batch fire-and-forget, and status returns job state plus `sent/total` counts without secret fields.
- Added `job-action-repo` count helpers for per-job total and success counts.
- Added renderer Messenger API and Messenger Seeding view with paste/parse targets, profile multi-select, async trigger disable, polling, per-profile progress, random-template hint, and placeholder cross-feature warning.
- Wired real Messenger seeding orchestrator and `PHASE3_AUTOMATION_STUB=1` stub in Electron bootstrap; stub records successful message actions and transitions jobs to terminal state for e2e without Chromium/Facebook.
- Added integration and e2e coverage for IPC fire-and-forget/status/no-secret/validation and UI trigger/progress via stub.
- Production real-run prerequisite remains deferred by story scope: backend must accept `action_type='message'`; this story does not patch backend.

### File List

- `_bmad-output/implementation-artifacts/12-2b-messenger-seeding-surface.md`
- `_bmad-output/implementation-artifacts/sprint-status-phase3.yaml`
- `automation-desktop/src/shared/ipc-schemas/messenger.ts`
- `automation-desktop/src/shared/ipc-schemas/index.ts`
- `automation-desktop/src/main/ipc/messenger-handlers.ts`
- `automation-desktop/src/main/ipc/index.ts`
- `automation-desktop/src/main/db/repositories/job-action-repo.ts`
- `automation-desktop/src/renderer/src/api/messenger-api.ts`
- `automation-desktop/src/renderer/src/views/MessengerSeedingView.tsx`
- `automation-desktop/src/renderer/src/components/Sidebar.tsx`
- `automation-desktop/src/renderer/src/components/AppShell.tsx`
- `automation-desktop/src/renderer/src/App.tsx`
- `automation-desktop/src/renderer/src/assets/main.css`
- `automation-desktop/src/main/adapters/electron-bootstrap.ts`
- `automation-desktop/tests/integration/messenger-ipc-handlers.spec.ts`
- `automation-desktop/tests/e2e/messenger-seeding.spec.ts`

## Change Log

- 2026-06-04 — Implemented Messenger seeding surface IPC/API/UI/bootstrap wiring and tests; moved story to review.
