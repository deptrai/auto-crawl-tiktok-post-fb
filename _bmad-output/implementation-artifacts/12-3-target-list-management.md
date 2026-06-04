# Story 12.3: Target List Management — Messenger target lists + sent/error filters

Status: ready-for-dev

Epic: 12 — Mass Messenger Seeding (Phase 3.4 Growth) · Story: 12.3 · ID: 12.3

> ⚠️ **SCOPE — ĐỌC TRƯỚC:** 12.2b đã có Messenger Seeding surface nhưng target UID chỉ paste/parse tại chỗ, **KHÔNG persist**. Story này thêm quản lý Target Lists cho Messenger: SQLite repo + IPC + renderer API + tab UI + wire list vào Messenger start/status. **KHÔNG sửa engine gửi DM 12.2a trừ khi cần thêm metadata optional không phá API**. **KHÔNG làm scraper lấy UID từ post**; chỉ import paste/file `.txt`.

## Story

As a user,
I want quản lý danh sách target UID để gửi Messenger,
So that tôi tổ chức chiến dịch seeding theo từng nhóm mục tiêu, tránh gửi trùng, và lọc lại UID gửi lỗi để chạy lại.

## Acceptance Criteria

- **AC1 (SQLite persistence)** — `openEncryptedDatabase` tạo bảng `target_lists(id, label, created_at)` và `target_list_entries(list_id, uid, name, sent_at, failed_at, last_outcome, last_error_reason, created_at)` với FK `list_id REFERENCES target_lists(id) ON DELETE CASCADE` và unique `(list_id, uid)`. Nếu cần link job/list, thêm bảng `target_list_jobs(list_id, job_id, created_at)` FK tới `target_lists` + `automation_jobs`. Không lưu cookie/token/body rendered.
- **AC2 (Repository semantics)** — `target-list-repo.ts` hỗ trợ: list summaries kèm counts (`total`, `sent`, `unsent`, `error`), create/delete list, import entries từ mảng `{uid,name?}` với dedupe trong input + dedupe trong DB, list entries theo filter `all|unsent|sent|error`, link list với jobIds, apply job outcomes từ `job_actions` để set `sent_at` khi outcome `success`, set `failed_at/last_outcome/last_error_reason` khi outcome != `success`. `sent` ưu tiên hơn error nếu UID đã thành công sau retry.
- **AC3 (IPC contract)** — Thêm schemas + handlers + channel registry cho `phase3:target-list:list`, `phase3:target-list:create`, `phase3:target-list:delete`, `phase3:target-list:entries`, `phase3:target-list:import`. Zod strict request + response `.parse()`, ErrorEnvelope tiếng Việt + `retryable`, schema string `.trim().min(1)`, no secrets. Invalid payload (`label` rỗng, `uid` rỗng, filter sai) → `VALIDATION_ERROR` và không ghi DB.
- **AC4 (Target Lists UI)** — Thêm nav/tab `Target Lists`: list panel + create form + import paste textarea + file `.txt` import qua renderer File API + filter segmented control `Tất cả / Chưa gửi / Đã gửi / Lỗi` + entries table. UI có loading/empty/error state riêng với class/testid riêng; async buttons disable DOM ngay trong click handler. Dòng import hỗ trợ format `uid` hoặc `uid|name`, bỏ dòng rỗng, dedupe UID, báo số created/skipped.
- **AC5 (Messenger integration)** — `MessengerSeedingView` vẫn giữ paste ad-hoc, nhưng thêm mode chọn Target List: chọn list + filter (`unsent` mặc định, cho phép `error`) → load entries → dùng entries làm `targets` cho `phase3:messenger:start`. `MessengerStartRequest` thêm optional `targetListId`; handler link `targetListId` với mọi `jobId`. Khi status poll terminal jobs, cập nhật target list outcomes từ `job_actions` qua repo để filter sent/error phản ánh sau khi chạy. Không block start handler; batch vẫn fire-and-forget.
- **AC6 (No duplicate send guard)** — Khi user chọn list filter `unsent`, targets gửi chỉ gồm entry chưa `sent_at` và chưa `failed_at`; filter `error` chỉ gồm UID lỗi để retry. Nếu list/filter không có target hợp lệ → UI disable nút và server reject `targets` empty như 12.2b. Import duplicate UID trong cùng list không tạo duplicate row.
- **AC7 (Test + verify)** — Tests: integration repo/schema for target list counts/import/filter/delete/link/apply outcomes; IPC handlers for valid + invalid payload + no-secret; E2E Target Lists UI create/import/filter/file-paste path enough; E2E Messenger chọn target list → trigger stub batch → list entries chuyển `sent`. Run `npm run typecheck`, `npm run lint`, and full Playwright suite. Existing 12.2b paste-only Messenger flow must remain passing.

## Tasks / Subtasks

### DB + repository
- [ ] **T1** — `automation-desktop/src/main/db/client.ts`: add `target_lists`, `target_list_entries`, `target_list_jobs` tables. Preserve current `CREATE TABLE IF NOT EXISTS` style, FK enforcement, and no production migration framework invention. Add/extend `tests/integration/db-schema.spec.ts` to assert columns, FK cascade, unique `(list_id, uid)`, and no secret columns. (AC1)
- [ ] **T2** — `automation-desktop/src/main/db/repositories/target-list-repo.ts`: implement `TargetListRepository` with methods `listLists()`, `createList({label,createdAt})`, `deleteList(id)`, `importEntries({listId, entries, createdAt})`, `listEntries({listId, filter})`, `linkJobs({listId, jobIds, createdAt})`, `applyJobOutcomes(jobId, now)`. Use prepared statements and transactions for import/link/outcome update. (AC2/AC6)
- [ ] **T2.1** — `automation-desktop/tests/integration/target-list-repo.spec.ts`: real encrypted DB coverage for create/import dedupe/counts/filter/delete cascade/link/apply outcomes from `job_actions`. Include retry behavior: failed UID appears in `error`, then later success sets `sent_at` and removes from `error`. (AC2/AC6/AC7)

### IPC schemas + handlers
- [ ] **T3** — `automation-desktop/src/shared/ipc-schemas/target-list.ts` + `index.ts`: define summaries, entries, filters (`all|unsent|sent|error`), import result `{created, skippedDuplicate, total}` and channels `phase3:target-list:list|create|delete|entries|import`. Use strict Zod, VN-safe public response shapes, no target body/secret fields. (AC3)
- [ ] **T4** — `automation-desktop/src/main/ipc/target-list-handlers.ts` + `ipc/index.ts`: register handlers mirroring `content-template-handlers.ts` error style. `delete` missing list → `TARGET_LIST_NOT_FOUND`; `entries` missing list → `TARGET_LIST_NOT_FOUND`; invalid payload → `VALIDATION_ERROR`. (AC3)
- [ ] **T4.1** — `automation-desktop/tests/integration/target-list-ipc-handlers.spec.ts`: FakeIpcMain tests for create/list/import/entries/delete, invalid payload no DB write, no-secret `JSON.stringify(response)` guard. (AC3/AC7)

### Bootstrap + renderer API
- [ ] **T5** — `automation-desktop/src/main/adapters/electron-bootstrap.ts`: create `targetListRepo`, add to `BootstrapDeps.repos`, register `registerTargetListHandlers`, and pass repo to Messenger handlers for `targetListId` link/outcome apply. Preserve existing stub mode. (AC3/AC5)
- [ ] **T6** — `automation-desktop/src/renderer/src/api/target-list-api.ts`: add client functions `listTargetLists`, `createTargetList`, `deleteTargetList`, `importTargetEntries`, `listTargetEntries` with local `assertOk` pattern. (AC4)

### Target Lists UI
- [ ] **T7** — `automation-desktop/src/renderer/src/views/TargetListsView.tsx`: create top-level view. Features: list summaries with counts, create list form, selected-list detail, paste textarea, `.txt` file import via `<input type="file" accept=".txt,text/plain">`, import result banner, filter segmented control, entries table. Parse lines `uid` or `uid|name` in renderer; dedupe before IPC; show validation errors before calling IPC. (AC4/AC6)
- [ ] **T8** — Update navigation/rendering: `Sidebar.tsx` `ConsoleView`, `NAV_ITEMS`, `AppShell.tsx` title map, `App.tsx` secondary view render, `main.css` styles. Use distinct testids: `nav-targets`, `target-lists-view`, `target-list-create-button`, `target-list-import-textarea`, `target-list-import-button`, `target-list-filter-unsent`, `target-list-entry-row-<uid>`. (AC4)

### Messenger integration
- [ ] **T9** — Extend `automation-desktop/src/shared/ipc-schemas/messenger.ts` with optional `targetListId?: string` on `MessengerStartRequestSchema`; update `messenger-api.ts` input type. Do **not** make `targetListId` required; paste-only 12.2b flow must still work. (AC5)
- [ ] **T10** — Update `automation-desktop/src/main/ipc/messenger-handlers.ts`: deps optionally include `targetLists`; after job creation and before fire-and-forget batch, if `targetListId` present call `targetLists.linkJobs({listId, jobIds, createdAt})`; in `status`, for terminal jobs call `targetLists.applyJobOutcomes(jobId, now)` idempotently. If link fails because list missing, return `TARGET_LIST_NOT_FOUND` and do not create jobs or start batch. (AC5/AC7)
- [ ] **T11** — Update `MessengerSeedingView.tsx`: add source mode toggle `Dán UID` / `Target List`; list selector + filter (`unsent` default, `error` retry); load list entries via target-list API; build `targets` from selected list entries; pass `targetListId` to `startMessengerSeeding`; retain existing textarea path and existing e2e behavior. (AC5/AC6)

### Tests + verify
- [ ] **T12** — E2E `tests/e2e/target-lists.spec.ts`: active license → open Target Lists → create list → paste `123\n456|Bob\n123` → import → counts show created/skipped → filters show unsent entries. Use stub/no Chromium. (AC4/AC6/AC7)
- [ ] **T13** — Extend `tests/e2e/messenger-seeding.spec.ts` or add focused test: create/import target list → Messenger source `Target List` with filter `unsent` → select profile → trigger stub batch → progress done → revisit Target Lists and assert entries are `sent` / absent from `unsent`. Existing paste-only test must remain. (AC5/AC7)
- [ ] **V** — Run `cd automation-desktop && npm run typecheck && npm run lint && npx playwright test tests/unit tests/integration tests/e2e --reporter=line`. Also run targeted specs while developing: `target-list-repo`, `target-list-ipc-handlers`, `target-lists.e2e`, `messenger-seeding.e2e`. (AC7)

> **D1 (defer):** scraper/import UID từ Facebook post reactions/comments/shares; CSV/XLSX import; list rename; bulk delete entries; per-campaign scheduling; warmup enforcement; backend `action_type='message'`; template set tách self-comment vs seeding; adaptive rate-limit throttle.

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` + `automation-desktop/project-context.md`

Critical rules relevant here: IPC channel `phase3:<domain>:<verb>`, Zod request+response validation, ErrorEnvelope tiếng Việt, no raw secrets over IPC/log, loading/empty/error state riêng, async button disable before await, `@playwright/test` only, and renderer must not import `electron` or `src/main/*`.

### Current state to preserve

- **12.2b Messenger paste flow exists and must keep working:** `MessengerSeedingView.tsx` parses textarea lines `uid` / `uid|name`, calls `startMessengerSeeding({profileIds, targets})`, then polls `getMessengerStatus(jobIds)`. Do not remove this path; add Target List as a second source mode.
- **Messenger IPC is fire-and-forget:** `registerMessengerHandlers` creates one `messenger_seed` job per profile, starts `runMessengerSeedBatch` without awaiting it, and returns `{jobIds}` immediately. 12.3 must not block this handler while updating list metadata.
- **Progress source:** `messenger:status` computes `sent/total` from `job_actions.countSuccessByJob/countByJob`. Target-list outcome sync should reuse `job_actions` instead of changing engine result payloads.
- **DB pattern:** Current client creates tables directly in `openEncryptedDatabase` with SQLCipher + `foreign_keys = ON`. Architecture mentions versioned SQLite migrations, but this repo currently does not have a migration runner. For 12.3, follow current code unless a migration runner already exists by implementation time.

### Recommended schema and outcome rules

```sql
CREATE TABLE IF NOT EXISTS target_lists(
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS target_list_entries(
  list_id TEXT NOT NULL REFERENCES target_lists(id) ON DELETE CASCADE,
  uid TEXT NOT NULL,
  name TEXT,
  sent_at TEXT,
  failed_at TEXT,
  last_outcome TEXT,
  last_error_reason TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(list_id, uid)
);

CREATE TABLE IF NOT EXISTS target_list_jobs(
  list_id TEXT NOT NULL REFERENCES target_lists(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES automation_jobs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(list_id, job_id)
);
```

- Filter `unsent`: `sent_at IS NULL AND failed_at IS NULL`.
- Filter `sent`: `sent_at IS NOT NULL`.
- Filter `error`: `sent_at IS NULL AND failed_at IS NOT NULL`.
- On `success`: set `sent_at = now`, `failed_at = NULL`, `last_outcome = 'success'`, `last_error_reason = NULL`.
- On non-success: set `failed_at = now`, `last_outcome = outcome`, `last_error_reason = outcome` only if `sent_at IS NULL`; do not downgrade a UID already sent successfully.
- Import duplicate `(list_id, uid)` should skip, not update existing `name` silently. Report skipped count so user understands dedupe.

### IPC design

Use domain `target-list` to match channel format and avoid plural drift.

Expected public response shapes:
- `TargetListSummary = { id, label, createdAt, total, sent, unsent, error }`
- `TargetListEntry = { listId, uid, name?, sentAt?, failedAt?, lastOutcome?, lastErrorReason?, createdAt }`
- `TargetListImportResponse = { ok:true, result:{ created, skippedDuplicate, total } }`

Do not expose job action tokens, cookies, 2FA seed, rendered template body, or raw profile secrets.

### UI behavior details

- `TargetListsView` should be an operational tool, not a marketing page: dense list/detail layout, simple counts, predictable controls.
- File import can use browser File API from renderer (`file.text()`); no main-process file picker required in this story.
- Use segmented buttons or radio buttons for filters. Keep text short: `Tất cả`, `Chưa gửi`, `Đã gửi`, `Lỗi`.
- Empty states must distinguish: no lists, selected list has no entries, filter has no matching entries, import textarea empty.
- Long UID/name cells must not overflow; use existing table/card styles or add constrained CSS.

### Messenger integration guardrails

- `MessengerStartRequestSchema` remains backward-compatible: `{ profileIds, targets, targetListId? }`.
- Handler must validate duplicate profile IDs already covered in 12.2b; keep it.
- If `targetListId` exists but repo missing/not found, fail before creating jobs to avoid orphan jobs.
- `applyJobOutcomes(jobId)` must be idempotent because renderer polls status repeatedly.
- Do not add target list IDs to `job_actions`; link is via `target_list_jobs` + `automation_jobs` + `job_actions.target`.
- If one target UID appears in multiple lists, only lists linked to that job should be updated.

### Previous story intelligence

- **12.1:** `content_templates` CRUD already exists; placeholders `{uid}`/`{name}` render via `renderContentTemplate`. 12.3 does not touch template schema.
- **12.2a:** engine accepts `MessengerTarget = { uid, name? }`; personalization is already wired. Target lists should output this exact shape.
- **12.2b:** surface has `phase3:messenger:start|status`, duplicate profile validation, missing job terminal status, and stub mode for e2e. Extend, do not replace.
- **Recent local change:** checkpoint/captcha manual flow now keeps Chromium open on `CHECKPOINT_BLOCKED`. 12.3 should not alter login/session close behavior.

### Files

| File | Action | Notes |
|---|---|---|
| `automation-desktop/src/main/db/client.ts` | UPDATE | Add target list tables |
| `automation-desktop/src/main/db/repositories/target-list-repo.ts` | NEW | CRUD/import/filter/link/outcome sync |
| `automation-desktop/src/shared/ipc-schemas/target-list.ts` | NEW | Zod schemas + types |
| `automation-desktop/src/shared/ipc-schemas/index.ts` | UPDATE | Export schemas + register channels |
| `automation-desktop/src/main/ipc/target-list-handlers.ts` | NEW | IPC handlers |
| `automation-desktop/src/main/ipc/index.ts` | UPDATE | Export handler |
| `automation-desktop/src/main/ipc/messenger-handlers.ts` | UPDATE | Optional targetListId link/outcome sync |
| `automation-desktop/src/shared/ipc-schemas/messenger.ts` | UPDATE | Optional `targetListId` |
| `automation-desktop/src/renderer/src/api/target-list-api.ts` | NEW | Renderer client |
| `automation-desktop/src/renderer/src/api/messenger-api.ts` | UPDATE | Optional `targetListId` input |
| `automation-desktop/src/renderer/src/views/TargetListsView.tsx` | NEW | Target list management UI |
| `automation-desktop/src/renderer/src/views/MessengerSeedingView.tsx` | UPDATE | Target List source mode |
| `automation-desktop/src/renderer/src/components/Sidebar.tsx` | UPDATE | Add nav item |
| `automation-desktop/src/renderer/src/components/AppShell.tsx` | UPDATE | Title map |
| `automation-desktop/src/renderer/src/App.tsx` | UPDATE | Render TargetListsView |
| `automation-desktop/src/renderer/src/assets/main.css` | UPDATE | Styles |
| `automation-desktop/src/main/adapters/electron-bootstrap.ts` | UPDATE | Create repo/register handlers/pass to messenger |
| `automation-desktop/tests/integration/db-schema.spec.ts` | UPDATE | Schema assertions |
| `automation-desktop/tests/integration/target-list-repo.spec.ts` | NEW | Repo behavior |
| `automation-desktop/tests/integration/target-list-ipc-handlers.spec.ts` | NEW | IPC behavior |
| `automation-desktop/tests/e2e/target-lists.spec.ts` | NEW | UI create/import/filter |
| `automation-desktop/tests/e2e/messenger-seeding.spec.ts` | UPDATE | List-backed seeding regression |

### References

- [Source: `_bmad-output/planning-artifacts/epics-phase3.md` Epic 12 / Story 12.3] — target lists, import paste/file, sent/error filters, link list with seeding job.
- [Source: `_bmad-output/implementation-artifacts/12-2b-messenger-seeding-surface.md`] — current paste-only Messenger surface and deferred 12.3 scope.
- [Source: `automation-desktop/src/renderer/src/views/MessengerSeedingView.tsx`] — existing target parser, profile multi-select, polling flow to preserve.
- [Source: `automation-desktop/src/main/ipc/messenger-handlers.ts`] — fire-and-forget start/status, duplicate profile guard, missing-job terminal response.
- [Source: `automation-desktop/src/main/db/client.ts`] — current SQLite schema creation pattern.
- [Source: `automation-desktop/src/main/db/repositories/content-template-repo.ts`] — prepared statement repo pattern.
- [Source: `automation-desktop/src/shared/ipc-schemas/index.ts`] — channel registry pattern.
- [Source: `automation-desktop/project-context.md`] — Electron Phase 3 rules: IPC, security, UI states, tests.

### Project Structure Notes

- New DB repository belongs under `src/main/db/repositories/` and must not import renderer/electron.
- New UI view belongs under `src/renderer/src/views/`; renderer API wrapper under `src/renderer/src/api/`.
- Shared IPC schemas belong under `src/shared/ipc-schemas/`; all new channels must be registered in `channelRegistry`.
- No backend/FastAPI change in this story. Target lists are local desktop SQLite data.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-06-04 — Story created by BMad create-story workflow; status ready-for-dev.
