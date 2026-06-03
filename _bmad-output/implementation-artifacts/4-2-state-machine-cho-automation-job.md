# Story 4.2: State machine cho automation job

Status: ready-for-dev

Epic: 4 — Lõi Automation Facebook (Self-Comment MVP) · Story: 4.2 · ID: 4.2

## Story

As a developer,
I want job automation chạy qua một state machine có guard + persist + checkpoint/resume,
So that các story sau (4.3 login, 4.6 self-comment) có khung orchestration chuẩn, và job dài KHÔNG phải retry-from-scratch khi app crash (NFR19).

## Acceptance Criteria

- **AC1 (States)** — Hệ thống định nghĩa đầy đủ 10 state SCREAMING_SNAKE_CASE: `PENDING | ACQUIRING_PROXY | LOGGING_IN | SOLVING_CHECKPOINT | WARMING_UP | EXECUTING | DONE | CHECKPOINT_BLOCKED | FAILED | CANCELLED` (union literal type — KHÔNG dùng string tự do).
- **AC2 (Transition + guard)** — `transition(jobId, to)` CHỈ cho phép cạnh hợp lệ theo bảng transition; cạnh không hợp lệ → trả lỗi typed (KHÔNG đổi state, KHÔNG persist). Happy path: `PENDING → ACQUIRING_PROXY → LOGGING_IN → SOLVING_CHECKPOINT → WARMING_UP → EXECUTING → DONE`. Mọi non-terminal state có nhánh tới `FAILED`/`CANCELLED`.
- **AC3 (Persist)** — Mỗi transition thành công persist `state` (+ `completed_at`/`result` khi vào terminal) vào bảng `automation_jobs` (SQLCipher). `createJob` khởi tạo state `PENDING` + `started_at`.
- **AC4 (Terminal guard)** — Từ terminal state (`DONE | FAILED | CANCELLED | CHECKPOINT_BLOCKED`) KHÔNG được transition tiếp (không "hồi sinh" job đã kết thúc) → trả lỗi typed.
- **AC5 (Resume — NFR19)** — Given job đang ở non-terminal state đã persist, When app "crash" rồi restart (mô phỏng = đóng + mở lại DB), Then đọc lại job từ `automation_jobs` ra ĐÚNG state cuối; `listResumable()` trả về job non-terminal đó (để 4.3+ tiếp tục từ state cuối, KHÔNG chạy lại từ `PENDING`).
- **AC6 (Test coverage)** — Transition table + guard + terminal-guard có **unit test**; create/persist/resume round-trip có **integration test** (SQLCipher thật). Lint + typecheck pass.

## Tasks / Subtasks

- [ ] **T1** — `src/main/db/client.ts`: thêm migration `CREATE TABLE IF NOT EXISTS automation_jobs(...)` (sau `proxy_configs`). Cột theo architecture: `id, profile_id, type, state, started_at, completed_at, result`. FK `profile_id REFERENCES profiles(id) ON DELETE CASCADE` (foreign_keys đã ON). (AC3)
- [ ] **T1b** — 🟠 `tests/integration/db-schema.spec.ts`: thêm 1 test mirror pattern `proxy_configs` — regex match `CREATE TABLE ... automation_jobs` + assert các cột bắt buộc. (nếu không, schema mới không được cover) (AC6)
- [ ] **T2** — `src/shared/types/automation-job.ts`: `AutomationJobState` union literal (10 state) + `AutomationJob` interface + `TERMINAL_STATES` set + (tùy chọn) zod schema nếu cần validate `result`. (AC1)
- [ ] **T3** — `src/main/automation/state-machine.ts`: `TRANSITIONS: Record<AutomationJobState, readonly AutomationJobState[]>` + `canTransition(from, to)` + `isTerminal(state)` (pure) + `createStateMachine({ repo, now })` → `transition(jobId, to)` (guard → persist) + `createJob(input)`. (AC2, AC3, AC4)
- [ ] **T4** — `src/main/db/repositories/automation-job-repo.ts`: `createAutomationJobRepository(db)` → `createJob`, `updateState(id, state, { completedAt?, result? })`, `getJob(id)`, `listResumable()` (state NOT IN terminal). Pattern y hệt `proxy-repo.ts`/`profile-repo.ts`. (AC3, AC5)
- [ ] **T5** — `src/main/automation/index.ts`: barrel export state-machine + types (đã export fingerprint từ 4.1 — APPEND, không xóa). (rule #21)
- [ ] **T6** — Tests: `tests/unit/state-machine.spec.ts` (AC2/AC4 — transition table, guard reject invalid edge, terminal guard) + `tests/integration/automation-job-repo.spec.ts` hoặc `state-machine.spec` integration (AC3/AC5 — persist + crash/resume round-trip trên SQLCipher thật). (AC6)
- [ ] **T7** — Verify: `npm run lint` + `npm run typecheck` + chạy test mới PASS + full suite không giảm (baseline hiện 144).

> **D1 (defer IPC/UI):** KHÔNG tạo `automation-handlers` IPC hay UI ở 4.2. FSM là orchestration infra; `phase3:automation:start` + UI job-list sẽ wire ở **4.6** (self-comment end-to-end, khi có executor thật). 4.2 chỉ cung cấp khung + persist + resume capability.

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules) + `automation-desktop/project-context.md`

4.2 là **pure main-process infra** (FSM logic + SQLite repo). KHÔNG đụng Electron API trực tiếp → KHÔNG cần adapter.

### Bản chất: orchestration SKELETON, chưa có side-effect thật

Mỗi state đại diện 1 giai đoạn job, nhưng **công việc thực của từng state là của story sau** (ACQUIRING_PROXY→4.x dùng proxy-pool 3.3; LOGGING_IN/SOLVING_CHECKPOINT→4.3; EXECUTING→4.6). 4.2 CHỈ làm: định nghĩa state + cạnh hợp lệ + guard + persist + resume. KHÔNG gọi proxy/playwright/login gì cả.

### State names — enforce bằng TYPE, KHÔNG bằng lint

> ⚠️ Architecture (L2179) nhắc lint rule `state-machine-uppercase` — **rule này CHƯA tồn tại** trong `eslint.config.mjs`. ĐỪNG dựa vào lint để bắt sai state name. Enforce bằng `AutomationJobState` union literal type — TypeScript sẽ báo lỗi nếu dùng state ngoài tập. (Nếu muốn, có thể thêm lint rule sau — ngoài scope 4.2.)

### Transition table (đề xuất — bám happy path AC2 + nhánh terminal)

```ts
export type AutomationJobState =
  | 'PENDING' | 'ACQUIRING_PROXY' | 'LOGGING_IN' | 'SOLVING_CHECKPOINT'
  | 'WARMING_UP' | 'EXECUTING' | 'DONE' | 'CHECKPOINT_BLOCKED' | 'FAILED' | 'CANCELLED'

export const TERMINAL_STATES = new Set<AutomationJobState>([
  'DONE', 'FAILED', 'CANCELLED', 'CHECKPOINT_BLOCKED'
])

export const TRANSITIONS: Record<AutomationJobState, readonly AutomationJobState[]> = {
  PENDING:            ['ACQUIRING_PROXY', 'CANCELLED'],
  ACQUIRING_PROXY:    ['LOGGING_IN', 'FAILED', 'CANCELLED'],
  LOGGING_IN:         ['SOLVING_CHECKPOINT', 'WARMING_UP', 'CHECKPOINT_BLOCKED', 'FAILED', 'CANCELLED'],
  SOLVING_CHECKPOINT: ['WARMING_UP', 'CHECKPOINT_BLOCKED', 'FAILED', 'CANCELLED'],
  WARMING_UP:         ['EXECUTING', 'FAILED', 'CANCELLED'],
  EXECUTING:          ['DONE', 'FAILED', 'CANCELLED'],
  DONE: [], FAILED: [], CANCELLED: [], CHECKPOINT_BLOCKED: []
}

export function canTransition(from: AutomationJobState, to: AutomationJobState): boolean {
  return TRANSITIONS[from].includes(to)
}
export function isTerminal(state: AutomationJobState): boolean {
  return TERMINAL_STATES.has(state)
}
```

> `CHECKPOINT_BLOCKED` = terminal (job dừng, cần user can thiệp — 4.3 sẽ phát telemetry); KHÔNG auto-resume. `listResumable()` chỉ lấy non-terminal (PENDING/ACQUIRING_PROXY/LOGGING_IN/SOLVING_CHECKPOINT/WARMING_UP/EXECUTING).

### State machine + clock injection (testability — mirror circuit-breaker 3.2)

```ts
export interface AutomationStateMachineDeps {
  repo: Pick<AutomationJobRepository, 'createJob' | 'getJob' | 'updateState'>
  now: () => string   // ISO timestamp; inject để test deterministic (KHÔNG Date.now/new Date trong logic)
}
function transition(jobId, to): { ok: true; state } | { ok: false; code: string } {
  const job = repo.getJob(jobId)
  if (!job) return { ok: false, code: 'JOB_NOT_FOUND' }
  if (isTerminal(job.state)) return { ok: false, code: 'JOB_TERMINAL' }        // AC4
  if (!canTransition(job.state, to)) return { ok: false, code: 'INVALID_TRANSITION' } // AC2
  const completedAt = isTerminal(to) ? deps.now() : undefined
  repo.updateState(jobId, to, { completedAt })                                  // AC3
  return { ok: true, state: to }
}
```

- **now injection**: ở bootstrap (4.6) truyền `now: () => new Date().toISOString()`; test truyền `() => '2026-06-03T00:00:00.000Z'`.
- Transition trả **typed result** (`{ok}`/`{code}`), KHÔNG phải `ErrorEnvelope` — vì 4.2 không qua IPC. Khi 4.6 wire IPC, map `code` → ErrorEnvelope + message tiếng Việt (rule #8/#9/#15). (rule ErrorEnvelope CHỈ áp ở IPC boundary, đừng nhồi vào FSM thuần.)

### automation_jobs migration (T1 — bám style client.ts)

```sql
CREATE TABLE IF NOT EXISTS automation_jobs(
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  result TEXT
)
```

- Đặt sau block `proxy_configs` trong `openEncryptedDatabase`. `foreign_keys = ON` đã bật trước đó (L23) → FK cascade hoạt động.
- `type`: loại job (MVP = `'self-comment'`); để TEXT, validate ở caller sau.
- `result`: JSON string|null — kết quả job. 🔴 **R-D3 (rule #10):** KHÔNG BAO GIỜ ghi cookie/2FA/token/password vào `result`. 4.2 chưa ghi gì nhạy cảm; flag cho 4.3+ khi điền result.

### Repo (T4 — pattern proxy-repo/profile-repo)

`createAutomationJobRepository(db)` với prepared statements:
- `createJob({ id, profileId, type, state, startedAt })` → INSERT.
- `updateState(id, state, { completedAt?, result? })` → UPDATE state (+ completed_at/result nếu có).
- `getJob(id)` → SELECT → map snake_case → camelCase (như profile-repo `getProfileById`).
- `listResumable()` → `SELECT ... WHERE state NOT IN ('DONE','FAILED','CANCELLED','CHECKPOINT_BLOCKED')`.

### Resume / NFR19 (AC5) — cốt lõi

State machine **stateless về runtime** — mọi state sống trong DB. "Resume" = đọc lại từ DB. Integration test mô phỏng crash: tạo job → transition vài bước (persist) → `db.close()` → `openEncryptedDatabase` lại (cùng path+key) → `getJob` ra state cuối → `listResumable` chứa job. KHÔNG cần re-execute (executor là 4.3+). 4.2 chứng minh **state survive restart**.

### Edge cases

- `transition` job không tồn tại → `JOB_NOT_FOUND` (không throw).
- Transition tới chính state hiện tại (self-loop) → `TRANSITIONS[from]` không chứa `from` → `INVALID_TRANSITION` (không cho no-op transition; tránh ghi đè completed_at).
- `createJob` trùng `id` → SQLite PK conflict throw — caller (4.6) sinh `id` unique (crypto.randomUUID ở composition root, KHÔNG trong FSM logic). 4.2 test dùng id cố định.
- `CANCELLED` từ PENDING (user hủy trước khi chạy) → hợp lệ (PENDING→CANCELLED).
- DB chưa có profile tương ứng → FK constraint fail khi createJob → integration test insert profile trước (như fixture 4.1).

### Scope — KHÔNG làm

- KHÔNG gọi proxy-pool/playwright/login/checkpoint (4.3+); mỗi state chưa có "công việc" thật.
- KHÔNG IPC `automation:start` / UI job-list (defer 4.6 — D1).
- KHÔNG telemetry/beacon (Epic 6); CHECKPOINT_BLOCKED chỉ set state, chưa phát event.
- KHÔNG cài playwright dep.
- KHÔNG ghi secret vào `result` (R-D3).
- KHÔNG thêm state `LICENSE_EXPIRED_READ_ONLY` (architecture L2016 — future, ngoài 4.2).

### Files

| File | Action | Ghi chú |
|---|---|---|
| `src/main/db/client.ts` | UPDATE | + migration `automation_jobs` (chỉ ADD CREATE TABLE) |
| `tests/integration/db-schema.spec.ts` | UPDATE | + test assert cột `automation_jobs` (mirror proxy_configs) |
| `src/shared/types/automation-job.ts` | NEW | `AutomationJobState` union + `AutomationJob` + `TERMINAL_STATES` |
| `src/main/automation/state-machine.ts` | NEW | TRANSITIONS + canTransition + isTerminal + createStateMachine |
| `src/main/db/repositories/automation-job-repo.ts` | NEW | createJob/updateState/getJob/listResumable |
| `src/main/automation/index.ts` | UPDATE | APPEND export state-machine + types (giữ fingerprint exports 4.1) |
| `tests/unit/state-machine.spec.ts` | NEW | AC2/AC4 (transition table, guard, terminal) |
| `tests/integration/automation-job-repo.spec.ts` | NEW | AC3/AC5 (persist + crash/resume SQLCipher) |
| ~~`automation-handlers.ts` / UI~~ | — | **DEFER 4.6** (D1) |

### Previous story intelligence (4.1 + 3.x)

- **4.1 fingerprint**: dùng `Pick<>` cho service deps (giảm mock surface) → áp dụng cho `state-machine` deps `Pick<AutomationJobRepository, ...>`. Generator pure + clock/seed injection → FSM cũng inject `now`.
- **4.1 integration test** dùng esbuild-fixture electron-entry; **3.2 proxy-repo/settings-repo** dùng `_electron.launch()` + `app.evaluate()` + smoke-result env. 🟠 **Chọn 1 pattern**: ưu tiên pattern repo-test sẵn có (xem `tests/integration/proxy-repo.spec.ts`) để nhất quán; nếu dùng esbuild-fixture (4.1) thì OK nhưng đừng tạo pattern thứ 3. (Finding L1 của review 4.1.)
- **profile-repo/proxy-repo**: mẫu repo chuẩn (prepared stmt + map snake→camel + interface). Copy y hệt.
- **db-schema.spec**: chỉ regex-match source client.ts — nhớ thêm assertion cho table mới (T1b).
- **144 test đang PASS** — đừng phá.

### Testing chi tiết (AC6)

**unit/state-machine.spec.ts** (pure, không DB — dùng fake repo `Pick<>` in-memory hoặc stub):
- `[P0] happy path`: PENDING→ACQUIRING_PROXY→LOGGING_IN→...→EXECUTING→DONE đều `canTransition` true.
- `[P0] invalid edge`: vd PENDING→EXECUTING, ACQUIRING_PROXY→DONE → `canTransition` false; `transition` trả `{ok:false, code:'INVALID_TRANSITION'}` + repo.updateState KHÔNG gọi.
- `[P0] terminal guard`: job ở DONE/FAILED/CANCELLED/CHECKPOINT_BLOCKED → `transition(...)` → `{ok:false, code:'JOB_TERMINAL'}`.
- `[P0] job not found`: `transition('ghost', ...)` → `{ok:false, code:'JOB_NOT_FOUND'}`.
- `[P0] completedAt set on terminal`: transition vào DONE → repo.updateState nhận `completedAt = now()` (inject clock cố định → assert giá trị).
- `[P0] isTerminal/TERMINAL_STATES` đúng 4 state.

**integration/automation-job-repo.spec.ts** (SQLCipher thật, insert profile trước):
- `[P0] persist + resume (NFR19)`: createJob(PENDING) → transition →ACQUIRING_PROXY→LOGGING_IN (persist) → `db.close()` → reopen cùng path/key → `getJob` state = 'LOGGING_IN' → `listResumable()` chứa job.
- `[P0] terminal excluded from resumable`: job →...→DONE → `listResumable()` KHÔNG chứa; `completed_at` đã set.
- `[P1] FK`: createJob với profile_id không tồn tại → throw (FK) — verify cascade/constraint.

## References

- [Source: epics-phase3.md#Story-4.2 (L371-384)] — AC gốc (FSM states + guard + persist + resume)
- [Source: architecture.md (L1553-1555)] — state names SCREAMING_SNAKE_CASE + `canTransition` guard
- [Source: architecture.md (L1401)] — `automation_jobs(id, profile_id, type, state, started_at, completed_at, result)`
- [Source: architecture.md (L1570,L1814)] — `main/automation/state-machine.ts`
- [Source: architecture.md (L1976)] — flow automation-handlers → state-machine (IPC defer 4.6)
- [Source: architecture.md (L2016)] — `LICENSE_EXPIRED_READ_ONLY` future state (ngoài 4.2)
- [Source: NFR19] — crash resume từ state cuối
- [Source: src/main/db/client.ts] — schema style + foreign_keys ON
- [Source: src/main/db/repositories/proxy-repo.ts + profile-repo.ts] — repo pattern
- [Source: src/main/proxy/circuit-breaker.ts] — clock injection pattern
- [Source: tests/integration/db-schema.spec.ts] — schema test pattern
- [Source: automation-desktop/CLAUDE.md + project-context.md] — 25 rules

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
| 2026-06-03 | 0.1 | Story created (bmad-create-story) — automation state-machine + persist + resume NFR19 | Luisphan |
