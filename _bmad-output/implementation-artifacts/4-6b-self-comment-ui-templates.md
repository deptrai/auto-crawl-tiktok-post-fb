# Story 4.6b: Self-comment — surface (IPC + UI + content_templates CRUD)

Status: review

Epic: 4 — Lõi Automation Facebook (Self-Comment MVP) · Story: 4.6b (tách từ 4.6) · ID: 4.6b

> Lớp **surface** cuối Epic 4: wire core e2e (4.6a `runSelfComment`) ra IPC + UI, cho user trigger + quản lý template. Mirror trio handler+api+view (proxy/profile 3.3/2.x). Nhẹ hơn 4.6a (chủ yếu IPC + React UI theo pattern sẵn).

## Story

As a user,
I want bấm nút chạy self-comment + quản lý danh sách template comment qua UI,
So that tôi dùng được tính năng tự bình luận mà không cần CLI (đóng MVP self-comment).

## Acceptance Criteria

- **AC1 (Trigger IPC)** — `phase3:automation:start` (request `{profileId, target?}`) → tạo job (state-machine `createJob` PENDING) → chạy `runSelfComment` **fire-and-forget** (KHÔNG await trong handler — job dài) → trả `{jobId}` ngay. Zod 2-way + ErrorEnvelope (retryable, message tiếng Việt).
- **AC2 (Status IPC)** — `phase3:automation:status` (request `{jobId}`) → đọc `automation_jobs` → trả `{state, outcome?}` (state hiện tại). Renderer poll để cập nhật. KHÔNG trả cookie/token/secret.
- **AC3 (Template CRUD IPC)** — `phase3:content-template:list|create|update|delete`: list (id,label,body,createdAt), create ({label,body}), update ({id,label,body}), delete ({id}). Zod 2-way + ErrorEnvelope. Body/label non-empty (rule #14).
- **AC4 (Template UI)** — View quản lý template: list + thêm/sửa/xóa (form label+body). Loading/empty/error state riêng (rule #16). Async button disable-on-click (rule #17). KHÔNG cho xóa template cuối cùng nếu sẽ làm self-comment fail (cảnh báo "cần ≥1 template").
- **AC5 (Trigger UI)** — Nút "Chạy self-comment" cho profile (trong ProfilesView hoặc view automation) → gọi `automation:start` → hiển thị trạng thái job (poll `automation:status`): đang chạy / DONE / CHECKPOINT_BLOCKED / FAILED + message tiếng Việt. Disable nút khi job đang chạy.
- **AC6 (Navigate-to-own-post)** — Xử lý finding #2 của 4.6a: flow THẬT cần điều hướng tới post của chính profile trước executor. 4.6b: `target` (URL post) từ UI/request → orchestrator navigate page tới `target` trước `executeSelfComment`; nếu thiếu target → navigate own profile feed + lấy post đầu (bundled selector, note Epic 5). Selector fragile → note.
- **AC7 (Wire bootstrap)** — `electron-bootstrap.ts`: khởi tạo `createSelfCommentOrchestrator` (deps: stateMachine 4.2, login 4.3, extractTokens 4.4, actionTokenClient 4.5, contentTemplates+jobActions repo, actionExecutor, now/nowMs/rng/onActionOutcome) + register automation-handlers + content-template-handlers. seed template mặc định khi DB mới.
- **AC8 (Secret + test)** — Status/IPC KHÔNG leak cookie/token (chỉ state/outcome/jti). Tests: handler integration (Zod 2-way, start fire-and-forget không block, status read), repo CRUD integration (SQLCipher), e2e (template CRUD UI + trigger button + status poll, stub automation). Lint/typecheck pass + full suite không giảm (baseline 189).

## Tasks / Subtasks

### Content templates CRUD
- [x] **T1** — `content-template-repo.ts`: + `createTemplate({label,body,createdAt})` (id=randomUUID) + `updateTemplate({id,label,body})` + `deleteTemplate(id)` + `countTemplates()`. (AC3)
- [x] **T2** — `src/shared/ipc-schemas/content-template.ts` + `index.ts`: schemas list/create/update/delete (request+response, ErrorEnvelope union) + đăng ký `channelRegistry` 4 channel `phase3:content-template:*`. (AC3)
- [x] **T3** — `src/main/ipc/content-template-handlers.ts`: `registerContentTemplateHandlers(ipcMain, repo)` — Zod 2-way + ErrorEnvelope VN (mirror proxy-handlers). (AC3)
- [x] **T4** — `src/renderer/src/api/content-template-api.ts` + `src/renderer/src/views/ContentTemplatesView.tsx`: CRUD UI (list/add/edit/delete, loading/empty/error riêng, async button disable-on-click). (AC4)

### Automation start/status
- [x] **T5** — `src/shared/ipc-schemas/automation.ts` + `index.ts`: `AutomationStartRequest {profileId, target?}` / `Response {jobId}`; `AutomationStatusRequest {jobId}` / `Response {state, outcome?}`. + channelRegistry 2 channel. (AC1/AC2)
- [x] **T6** — `src/main/ipc/automation-handlers.ts`: `registerAutomationHandlers(ipcMain, {orchestrator, stateMachine, jobRepo})`:
  - start: `createJob({id:uuid, profileId, type:'self_comment'})` → **`void orchestrator.runSelfComment(jobId, profileId)`** (fire-and-forget, KHÔNG await — bọc `.catch` log non-secret) → return `{jobId}`.
  - status: `jobRepo.getJob(jobId)` → `{state, outcome?}` (outcome từ job_actions hoặc job state). KHÔNG leak secret.
  (AC1/AC2/AC8)
- [x] **T7** — `src/renderer/src/api/automation-api.ts` + trigger UI (nút trong `ProfilesView.tsx` hoặc view mới) + poll status. (AC5)

### Navigate-to-own-post + wiring
- [x] **T8** — `self-comment-orchestrator.ts`: nhận `target?` → navigate `page` tới target trước `executeSelfComment` (thêm `navigate(page, target)` step, dùng SessionHandle.page.goto hoặc page method); thiếu target → navigate own feed + bundled selector lấy post (note Epic 5 thay). (AC6)
- [x] **T9** — `electron-bootstrap.ts`: wire orchestrator + register 2 nhóm handler + seed template default (DB mới). (AC7)
- [x] **T10** — Tests: integration `content-template-ipc-handlers.spec.ts` + `automation-ipc-handlers.spec.ts` (Zod 2-way, start fire-and-forget không block + return jobId, status read, no-secret); integration `content-template-repo.spec.ts` (CRUD SQLCipher); e2e `content-templates.spec.ts` + `automation-trigger.spec.ts` (CRUD UI + trigger + status poll, **stub orchestrator** để KHÔNG launch browser thật trong e2e). (AC8)
- [x] **V** — Verify: `npm run lint` + `typecheck` + test mới + full suite không giảm (baseline 189). Pre-commit secret guard.

> **D1 (defer):** auto-find own post chính xác (Epic 5 selector 4-tier); warmup behavior trước comment (Epic 9); telemetry transport (Epic 6 — `onActionOutcome` hook đã có 4.6a); Messenger Seeding (Epic 12).

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules) + `project-context.md`

### Mirror pattern sẵn có (đừng phát minh lại)
- **Handler trio**: `proxy-handlers.ts` + `ipc-schemas/proxy.ts` + `renderer/api/proxy-api.ts` + `views/ProxyView.tsx` (3.3). Copy cấu trúc cho content-template + automation.
- **channelRegistry** (`src/shared/ipc-schemas/index.ts:93`): đăng ký MỌI channel mới (preload throw "Unregistered IPC channel" nếu thiếu). Format `phase3:<domain>:<verb>` (rule #6).
- **Zod 2-way** (rule #7): handler safeParse request + `.parse()` response. **ErrorEnvelope** (rule #8/#9) + message tiếng Việt (rule #15) + `retryable`.
- **View** (ProfilesView/ProxyView): loading/empty/error class+testid riêng (rule #16); async button disable-on-click (rule #17).

### 🔴 GUARDRAIL — Fire-and-forget automation:start (AC1)

`runSelfComment` LÀ job dài (launch Chromium, login, execute — vài chục giây). IPC handle **KHÔNG được await** (block → renderer treo + IPC timeout).
```ts
ipcMain.handle('phase3:automation:start', async (_e, req): Promise<AutomationStartResponse> => {
  const parsed = AutomationStartRequestSchema.safeParse(req)
  if (!parsed.success) return parseError(...)
  const jobId = randomUUID()
  stateMachine.createJob({ id: jobId, profileId: parsed.data.profileId, type: 'self_comment' })
  // FIRE-AND-FORGET — KHÔNG await
  void orchestrator.runSelfComment(jobId, parsed.data.profileId).catch((err) => {
    // log non-secret (KHÔNG cookie/token); job state đã chuyển FAILED trong orchestrator
  })
  return AutomationStartResponseSchema.parse({ ok: true, jobId })
})
```
- Renderer poll `automation:status` để biết tiến trình (PENDING→…→DONE/FAILED/CHECKPOINT_BLOCKED).
- `target` truyền vào orchestrator (qua deps hoặc param) cho navigate-to-own-post (AC6).

### 🔴 Secret hygiene (AC8)
- `automation:status` trả CHỈ `{state, outcome}` — KHÔNG cookie/2FA/token/jti-as-secret. (jti không phải secret nặng nhưng KHÔNG cần trả status.)
- content_templates body/label = user content (KHÔNG secret) — OK.
- KHÔNG log cookie/token trong handler (rule #11).

### Navigate-to-own-post (AC6 — finding #2 của 4.6a)
- 4.6a: orchestrator truyền `page` cho executor nhưng page ở FB home → real flow selector_miss. 4.6b sửa: orchestrator nhận `target` → `await page.goto(target, {timeout})` (page đã login 4.3) TRƯỚC `executeSelfComment`. Thiếu target → navigate own feed (`https://www.facebook.com/me`) + bundled selector lấy post đầu (fragile, Epic 5).
- ⚠️ `page` của 4.6a là `CommentPageLike` (chỉ `locator`) — cần mở rộng để có `goto` (hoặc thêm method navigate vào SessionHandle). Giữ DI: inject `navigate: (page, target) => Promise<void>` để test fake.

### automation:status — outcome nguồn
- `state` từ `automation_jobs` (state-machine 4.2). `outcome` (success/checkpoint/...) từ `job_actions` mới nhất của job (job-action-repo cần `getLatestOutcome(jobId)`) HOẶC suy từ state (DONE→success, CHECKPOINT_BLOCKED→checkpoint, FAILED→error). Đơn giản: map từ state. (Thêm `job-action-repo.getLatestByJob` nếu cần.)

### Edge cases
- start khi profile chưa login/no-cookie → orchestrator tự FAILED (4.6a) → status FAILED. UI hiển thị lỗi.
- start 2 lần cùng profile → 2 job khác jobId (uuid) — OK (mỗi job độc lập); UI nên disable nút khi có job active cho profile đó.
- delete template cuối → cảnh báo "cần ≥1 template để self-comment" (AC4) — `countTemplates()` check.
- status jobId không tồn tại → ErrorEnvelope `JOB_NOT_FOUND` retryable:false.
- e2e KHÔNG launch browser thật: stub orchestrator (inject fake runSelfComment) để test UI trigger + status mà không cần Chromium/FB.

### Scope — KHÔNG làm
- KHÔNG đổi logic core 4.6a (orchestrator/executor) trừ thêm navigate-to-own-post (AC6) + nhận target.
- KHÔNG auto-find own post chính xác (Epic 5 4-tier selector); KHÔNG warmup (Epic 9); KHÔNG telemetry transport (Epic 6).
- KHÔNG Messenger Seeding (Epic 12); KHÔNG mass-action (Epic 9/10).
- 🚫 KHÔNG leak cookie/token qua IPC/status/log.

### Files
| File | Action | Ghi chú |
|---|---|---|
| `src/main/db/repositories/content-template-repo.ts` | UPDATE | + create/update/delete/count |
| `src/shared/ipc-schemas/content-template.ts` + `index.ts` | NEW/UPDATE | schemas + channelRegistry 4 channel |
| `src/main/ipc/content-template-handlers.ts` | NEW | CRUD handlers Zod 2-way |
| `src/renderer/src/api/content-template-api.ts` + `views/ContentTemplatesView.tsx` | NEW | CRUD UI |
| `src/shared/ipc-schemas/automation.ts` + `index.ts` | NEW/UPDATE | start/status schemas + channelRegistry 2 channel |
| `src/main/ipc/automation-handlers.ts` | NEW | start (fire-and-forget) + status |
| `src/renderer/src/api/automation-api.ts` + trigger UI (ProfilesView) | NEW/UPDATE | nút chạy + poll status |
| `src/main/automation/self-comment-orchestrator.ts` | UPDATE | + navigate-to-own-post (target) |
| `src/main/db/repositories/job-action-repo.ts` | UPDATE | + getLatestByJob (nếu status cần outcome) |
| `src/main/adapters/electron-bootstrap.ts` | UPDATE | wire orchestrator + register 2 handler + seed template |
| `tests/integration/{content-template-ipc-handlers,automation-ipc-handlers,content-template-repo}.spec.ts` | NEW | Zod/CRUD/fire-and-forget |
| `tests/e2e/{content-templates,automation-trigger}.spec.ts` | NEW | UI (stub orchestrator) |

### Previous story intelligence
- **4.6a**: `createSelfCommentOrchestrator` (deps đầy đủ) + `runSelfComment(jobId, profileId)`; content-template-repo (list/getRandom/seed) + job-action-repo (recordAction); finding #2 navigate-to-own-post → AC6.
- **4.2** state-machine `createJob` + `getJob` (job state cho status).
- **3.3 proxy trio** + **2.x profile trio**: mẫu handler+api+view + channelRegistry. ProfilesView async-button + loading pattern.
- **189 test đang PASS** — đừng phá.

### Testing chi tiết (AC8)
- integration: automation-handlers start → trả jobId NGAY (không block; orchestrator stub async) + createJob gọi; status → getJob state. content-template-handlers CRUD Zod 2-way + ErrorEnvelope VN. repo CRUD SQLCipher.
- e2e (@playwright/test Electron, **stub orchestrator** — KHÔNG Chromium thật): ContentTemplatesView thêm/sửa/xóa hiển thị đúng; nút trigger → status hiển thị (PENDING→DONE giả lập qua stub job state).

## References
- [Source: epics-phase3.md#Story-4.6 (L429-447)] — AC gốc (split 4.6a/4.6b; AC5 content_templates CRUD UI thuộc 4.6b)
- [Source: architecture.md (L1973-1985)] — e2e flow bước 1 (IPC start) + 10 (poll status)
- [Source: 4.6a self-comment-orchestrator + content-template-repo + job-action-repo] — core wire
- [Source: src/main/ipc/proxy-handlers.ts + shared/ipc-schemas/proxy.ts + renderer/api/proxy-api.ts + views/ProxyView.tsx] — mirror trio
- [Source: src/shared/ipc-schemas/index.ts:93] — channelRegistry
- [Source: src/main/automation/state-machine.ts] — createJob/getJob
- [Source: automation-desktop/CLAUDE.md] — 25 rules

## Dev Agent Record
### Agent Model Used
GPT-5 Codex
### Debug Log References
- `cd automation-desktop && npm run typecheck` → 0 errors.
- `cd automation-desktop && npm run lint` → 0 errors; existing Node module-type warning only.
- `cd automation-desktop && npx playwright test tests/unit/self-comment-orchestrator.spec.ts tests/integration/content-template-ipc-handlers.spec.ts tests/integration/automation-ipc-handlers.spec.ts tests/integration/content-template-repo.spec.ts --reporter=line` → 11 passed.
- `cd automation-desktop && npx playwright test tests/e2e/content-templates.spec.ts tests/e2e/automation-trigger.spec.ts --reporter=line` → 2 passed.
- `cd automation-desktop && npx playwright test tests/unit/license-service.spec.ts tests/unit/ipc-contracts.spec.ts --reporter=line` → 14 passed.
- `cd automation-desktop && npm run build` → electron-vite build passed.
- `cd automation-desktop && npx playwright test tests/unit tests/integration tests/e2e --reporter=line` → 215 passed.
- `git diff --check` → passed.
- Artifact/secret hygiene grep for `.phase3-manual/`, `secure-storage`, `.db`, `.review`, `test-results`, `playwright-report` → no suspicious tracked/untracked artifacts.
### Completion Notes List
- Added content template CRUD repository methods and IPC handlers with Zod request/response validation, Vietnamese ErrorEnvelope messages, and server-side protection against deleting the final template.
- Added renderer content template API + `ContentTemplatesView` for list/create/edit/delete with distinct loading/empty/error states and immediate async button disabling.
- Added automation start/status schemas, channel registry entries, renderer API, IPC handlers, fire-and-forget job start, and status polling with state/outcome only.
- Added profile-row self-comment trigger UI with optional target URL input, active-job button disabling, and Vietnamese status labels.
- Wired Electron bootstrap to seed default templates, initialize automation job/content/job-action repos, state machine, action-token client, self-comment orchestrator, and 4.6b handlers; E2E uses `PHASE3_AUTOMATION_STUB=1` to avoid launching real browser/Facebook.
- Updated self-comment orchestrator to accept `target`, navigate before execution, and fall back to `https://www.facebook.com/me` when target is omitted.
- Persisted `license.key` in secure storage during activation so per-action token requests can work in the real app; rollback deletes it if public settings persistence fails.
- Preserved secret hygiene: status IPC does not return cookies/tokens/JWT/fb_dtsg; UI and tests assert profile secrets are not rendered.
### File List
- `_bmad-output/implementation-artifacts/4-6b-self-comment-ui-templates.md`
- `_bmad-output/implementation-artifacts/sprint-status-phase3.yaml`
- `automation-desktop/src/main/adapters/electron-bootstrap.ts`
- `automation-desktop/src/main/automation/index.ts`
- `automation-desktop/src/main/automation/self-comment-orchestrator.ts`
- `automation-desktop/src/main/db/repositories/content-template-repo.ts`
- `automation-desktop/src/main/db/repositories/job-action-repo.ts`
- `automation-desktop/src/main/ipc/automation-handlers.ts`
- `automation-desktop/src/main/ipc/content-template-handlers.ts`
- `automation-desktop/src/main/ipc/index.ts`
- `automation-desktop/src/main/license/license-service.ts`
- `automation-desktop/src/renderer/src/App.tsx`
- `automation-desktop/src/renderer/src/api/automation-api.ts`
- `automation-desktop/src/renderer/src/api/content-template-api.ts`
- `automation-desktop/src/renderer/src/assets/main.css`
- `automation-desktop/src/renderer/src/views/ContentTemplatesView.tsx`
- `automation-desktop/src/renderer/src/views/ProfilesView.tsx`
- `automation-desktop/src/shared/ipc-schemas/automation.ts`
- `automation-desktop/src/shared/ipc-schemas/content-template.ts`
- `automation-desktop/src/shared/ipc-schemas/index.ts`
- `automation-desktop/tests/e2e/automation-trigger.spec.ts`
- `automation-desktop/tests/e2e/content-templates.spec.ts`
- `automation-desktop/tests/fixtures/content-template-repo-electron-entry.ts`
- `automation-desktop/tests/integration/automation-ipc-handlers.spec.ts`
- `automation-desktop/tests/integration/content-template-ipc-handlers.spec.ts`
- `automation-desktop/tests/integration/content-template-repo.spec.ts`
- `automation-desktop/tests/unit/license-service.spec.ts`
- `automation-desktop/tests/unit/self-comment-orchestrator.spec.ts`
### Change Log
| Date | Version | Description | Author |
|---|---|---|---|
| 2026-06-03 | 1.0 | Implemented self-comment surface: template CRUD IPC/UI, automation start/status IPC/UI, bootstrap wiring, target navigation, license key secure storage, and test coverage | Codex |
| 2026-06-03 | 0.1 | Story created (split từ 4.6) — surface: automation IPC start/status + trigger UI + content_templates CRUD + navigate-to-own-post | Luisphan |
