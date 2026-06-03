# Story 12.1: Content Templates — Placeholder `{uid}`/`{name}` (net-new bổ sung 4.6b)

Status: review

Epic: 12 — Mass Messenger Seeding (Phase 3.4 Growth) · Story: 12.1 · ID: 12.1

> ⚠️ **SCOPE QUAN TRỌNG — ĐỌC TRƯỚC:** CRUD content_templates (repo + IPC `phase3:content-template:*` + `ContentTemplatesView` UI + bảng `content_templates(id,label,body,created_at)`) **ĐÃ làm xong ở Story 4.6b**. Story 12.1 **CHỈ** bổ sung phần **net-new**: hỗ trợ placeholder `{uid}` và `{name}` trong body template + render runtime + UI preview. **KHÔNG tạo lại** CRUD/IPC/repo/UI đã có. Render được Messenger Seeding (12.2) tiêu thụ khi gửi DM cá nhân hóa.

## Story

As a user,
I want body của content template hỗ trợ placeholder `{uid}` và `{name}` (thay bằng giá trị thật khi gửi),
So that automation seeding chọn ngẫu nhiên template rồi cá nhân hóa từng tin nhắn → giảm dấu hiệu spam đồng loạt (đóng phần còn thiếu của 12.1 sau 4.6b).

## Acceptance Criteria

- **AC1 (Render function thuần)** — Hàm pure `renderContentTemplate(body: string, vars: ContentTemplateVars): string` (`vars = { uid?: string; name?: string }`):
  - Thay **MỌI** lần xuất hiện của `{uid}` → `vars.uid`, `{name}` → `vars.name`.
  - Placeholder hợp lệ nhưng **thiếu giá trị** (undefined/null) → thay bằng **chuỗi rỗng** (để recipient KHÔNG thấy literal `{name}`).
  - Token KHÔNG hỗ trợ (vd `{foo}`) → **giữ nguyên** (để user nhìn thấy typo, không nuốt im lặng).
  - Đặt ở `src/shared/` (cả renderer preview lẫn main seeding import được — rule #1 adapter discipline: renderer CHỈ import từ shared, KHÔNG từ main).
  - Export hằng `CONTENT_TEMPLATE_PLACEHOLDERS = ['{uid}', '{name}']` (single source of truth cho UI hint + validate).
- **AC2 (UI hint + live preview)** — `ContentTemplatesView` (form thêm + form sửa):
  - Hint text liệt kê placeholder hỗ trợ (`{uid}`, `{name}`) gần ô body, lấy từ `CONTENT_TEMPLATE_PLACEHOLDERS` (đừng hardcode tách rời).
  - Live preview: render body hiện tại với **sample vars** (`uid='100012345678'`, `name='Nguyễn Văn A'`) → hiển thị kết quả; testid riêng (`content-template-preview`). Empty body → preview ẩn hoặc rỗng (loading/empty state riêng — rule #16).
- **AC3 (KHÔNG đụng self-comment flow)** — KHÔNG wire render vào `self-comment-orchestrator` (self-comment KHÔNG có uid/name target → không có gì để thay). Render được 12.2 (Messenger Seeding Engine) tiêu thụ. content_templates schema **giữ nguyên** (placeholder sống trong text body, KHÔNG cột mới, KHÔNG migration).
- **AC4 (Reuse — KHÔNG tái tạo)** — Reuse nguyên `content-template-repo.ts`, `content-template-handlers.ts`, `ipc-schemas/content-template.ts`, `content-template-api.ts` của 4.6b. KHÔNG thêm IPC channel mới (render là client/seeding-side, không qua IPC). Channel naming dùng `phase3:content-template:*` (epics doc ghi `phase3:content:*` là **cũ/superseded** bởi 4.6b — đừng đổi).
- **AC5 (Test + verify)** — Unit test render function (đa occurrence, cả 2 placeholder, thiếu var → rỗng, token lạ giữ nguyên, body rỗng, body không placeholder, placeholder dính liền `{uid}{name}`). E2E: UI hint + preview hiển thị đúng khi gõ body có placeholder. Lint + typecheck pass + full suite KHÔNG giảm (**baseline 218** sau patch 4.6b).

## Tasks / Subtasks

### Render util (net-new core)
- [x] **T1** — `src/shared/content-template-render.ts`: `export type ContentTemplateVars = { uid?: string; name?: string }`; `export const CONTENT_TEMPLATE_PLACEHOLDERS = ['{uid}', '{name}'] as const`; `export function renderContentTemplate(body: string, vars: ContentTemplateVars): string` — replaceAll `{uid}`/`{name}` (thiếu → `''`); token khác giữ nguyên. Pure, no side-effect, no import electron. (AC1)
- [x] **T2** — `tests/unit/content-template-render.spec.ts`: cases — both placeholders replaced; multiple occurrences (`'{name} {name}'`); missing var → empty string; unknown token `{foo}` untouched; empty body → `''`; no-placeholder body unchanged; adjacent `{uid}{name}`. (AC5)

### UI hint + preview (net-new surface)
- [x] **T3** — `src/renderer/src/views/ContentTemplatesView.tsx`: thêm hint placeholder (từ `CONTENT_TEMPLATE_PLACEHOLDERS`) cạnh ô body (cả create + edit form); live preview `renderContentTemplate(body, SAMPLE_VARS)` với testid `content-template-preview` (+ edit variant). Import render util từ `../../../shared/content-template-render`. (AC2)
- [x] **T4** — `src/renderer/src/assets/main.css`: style cho hint + preview block (nhẹ, theo pattern hiện có). (AC2)
- [x] **T5** — `tests/e2e/content-templates.spec.ts` (extend, KHÔNG file mới trừ khi cần): gõ body `'Chào {name} ({uid})'` → assert preview hiển thị `'Chào Nguyễn Văn A (100012345678)'`; hint chứa `{uid}` và `{name}`. Reuse harness e2e content-templates sẵn có. (AC5)

### Verify
- [x] **V** — `cd automation-desktop && npm run typecheck` + `npm run lint` (0 errors kể cả test mới) + `npx playwright test tests/unit tests/integration tests/e2e --reporter=line` (≥ baseline 218). Pre-commit secret guard (placeholder/body = user content, KHÔNG secret — OK). (AC5)

> **D1 (defer):** placeholder mở rộng (`{firstname}`, `{custom1}`...) + escape literal `\{uid\}` nếu cần → Epic 12 sau hoặc khi 12.2 yêu cầu. Live-preview với target THẬT (uid/name từ list) → 12.3 Target List. Wire render vào seeding flow → 12.2.

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules) + `automation-desktop/project-context.md`

### Đây là story REUSE-HEAVY — đừng phát minh lại
4.6b đã giao đầy đủ hạ tầng content_templates. Story này CHỈ thêm 1 hàm pure + UI preview. **Trước khi code, đọc các file 4.6b dưới để hiểu state hiện tại và KHÔNG phá:**

| File 4.6b (đã có) | Vai trò | 12.1 có đụng? |
|---|---|---|
| `src/main/db/repositories/content-template-repo.ts` | CRUD + `getRandomTemplate(rng)` | ❌ KHÔNG đổi (body lưu nguyên text có placeholder) |
| `src/main/ipc/content-template-handlers.ts` | IPC CRUD Zod 2-way | ❌ KHÔNG đổi |
| `src/shared/ipc-schemas/content-template.ts` | schemas (label≤120, body≤2000) | ❌ KHÔNG đổi (placeholder nằm trong body 2000 chars) |
| `src/renderer/src/api/content-template-api.ts` | renderer API client | ❌ KHÔNG đổi |
| `src/renderer/src/views/ContentTemplatesView.tsx` | CRUD UI (create+edit form, list) | ✅ thêm hint + preview (KHÔNG sửa logic CRUD) |
| `src/main/automation/self-comment-orchestrator.ts` | dùng `template.body` | ❌ KHÔNG đụng (AC3 — self-comment không có uid/name) |

### 🔴 Adapter discipline (rule #1) — render util ĐẶT Ở `src/shared/`
- Renderer (`ContentTemplatesView`) CHỈ import được từ `src/shared/` (KHÔNG `src/main/`). Messenger Seeding 12.2 (main process) cũng import được từ shared. → `src/shared/content-template-render.ts` là vị trí ĐÚNG (giống `src/shared/retry.ts` — flat file, KHÔNG cần folder+barrel vì không phải service).
- Hàm pure: KHÔNG import electron, KHÔNG side-effect, KHÔNG I/O. Test bằng unit (rule #18: pure function = unit test đủ).

### Placeholder render — hợp đồng rõ ràng (AC1)
```ts
// src/shared/content-template-render.ts
export type ContentTemplateVars = { uid?: string; name?: string }
export const CONTENT_TEMPLATE_PLACEHOLDERS = ['{uid}', '{name}'] as const

export function renderContentTemplate(body: string, vars: ContentTemplateVars): string {
  return body
    .replaceAll('{uid}', vars.uid ?? '')   // thiếu → rỗng (recipient không thấy literal)
    .replaceAll('{name}', vars.name ?? '') // token lạ {foo} KHÔNG match → giữ nguyên
}
```
- `String.prototype.replaceAll` có sẵn (Node 18+ / Chromium renderer) — KHÔNG cần regex/escape. TS strict OK.
- Quyết định behavior (chốt trong story, đừng tự đổi): thiếu var → `''`; token không hỗ trợ → giữ nguyên. Test phải assert cả 2.

### UI hint + preview (AC2)
- `ContentTemplatesView` đã có form create (state `body`) + form edit (state `editBody`). Thêm:
  - Dưới ô body: `<p>` hint "Placeholder hỗ trợ: {uid}, {name}" — render từ `CONTENT_TEMPLATE_PLACEHOLDERS.join(', ')`.
  - Preview: `renderContentTemplate(body, SAMPLE_VARS)` với `SAMPLE_VARS = { uid: '100012345678', name: 'Nguyễn Văn A' }`; testid `content-template-preview`. Body rỗng → ẩn preview (rule #16 empty state riêng, đừng share class với main).
- Async button (rule #17) KHÔNG đổi — preview là render đồng bộ, không cần button.

### Channel naming — KHÔNG đổi
- Epics doc (`epics-phase3.md:805`) ghi `phase3:content:list|create|update|delete` nhưng **4.6b đã implement `phase3:content-template:*`** (format `phase3:<domain>:<verb>` rule #6, domain = `content-template`). 12.1 reuse nguyên, KHÔNG đổi tên, KHÔNG thêm channel (render không qua IPC).

### Edge cases
- Body chỉ có placeholder (`'{name}'`) + thiếu name → preview rỗng. OK.
- Placeholder dính liền `'{uid}{name}'` → cả 2 thay đúng (replaceAll độc lập).
- Body 2000 chars có nhiều placeholder → render vẫn O(n), không vấn đề perf.
- Token gần giống `{ uid }` (có space) → KHÔNG match (chỉ match exact `{uid}`). Document: user phải gõ đúng không space.

### Scope — KHÔNG làm
- KHÔNG tạo lại CRUD/IPC/repo/schema/UI-list của 4.6b.
- KHÔNG thêm migration / cột DB (placeholder sống trong body text).
- KHÔNG wire render vào self-comment orchestrator (AC3).
- KHÔNG build Messenger Seeding Engine (12.2) / Target List (12.3).
- KHÔNG placeholder mở rộng ngoài `{uid}`/`{name}` (D1 defer).

### Files
| File | Action | Ghi chú |
|---|---|---|
| `src/shared/content-template-render.ts` | NEW | pure render + `CONTENT_TEMPLATE_PLACEHOLDERS` + types |
| `src/renderer/src/views/ContentTemplatesView.tsx` | UPDATE | hint + live preview (create + edit form) |
| `src/renderer/src/assets/main.css` | UPDATE | style hint + preview |
| `tests/unit/content-template-render.spec.ts` | NEW | unit render edge cases |
| `tests/e2e/content-templates.spec.ts` | UPDATE | e2e hint + preview |

### Previous story intelligence
- **4.6b** (vừa code-review xong, +6 patch): content_templates CRUD repo (`createTemplate/updateTemplate/deleteTemplate/countTemplates/getRandomTemplate/seedDefaults`), IPC `phase3:content-template:*` Zod 2-way + ErrorEnvelope VN, `ContentTemplatesView` (create+edit form, list, loading/empty/error testid riêng, async button rule #17, maxLength 120/2000). Baseline test = **218 passed** (215 + 3 patch tests). ĐỪNG phá.
- **4.6a**: `getRandomTemplate(rng)` chọn template ngẫu nhiên cho self-comment (không placeholder).
- Mẫu pure-util + unit test: xem `src/shared/retry.ts` + `tests/unit/retry.spec.ts` (flat shared file, unit test thuần).

### Testing chi tiết (AC5)
- unit `content-template-render.spec.ts`: 7 case ở T2. Pure → KHÔNG cần Electron/DB.
- e2e `content-templates.spec.ts`: reuse harness sẵn (license active → ContentTemplatesView); gõ body có placeholder → assert preview text + hint. KHÔNG launch automation/browser thật.

## References
- [Source: epics-phase3.md#Story-12.1 (L792-805)] — AC gốc (content templates + placeholder `{uid}`/`{name}` + IPC — phần CRUD đã làm 4.6b)
- [Source: epics-phase3.md#Epic-12 (L784-790)] — Mass Messenger Seeding; phân biệt self-comment (Epic 4) vs DM (Epic 12)
- [Source: 4-6b-self-comment-ui-templates.md] — hạ tầng content_templates đã giao (reuse)
- [Source: src/main/db/repositories/content-template-repo.ts] — repo CRUD (KHÔNG đổi)
- [Source: src/renderer/src/views/ContentTemplatesView.tsx] — UI thêm hint + preview
- [Source: src/shared/retry.ts] — mẫu pure shared util + unit test
- [Source: automation-desktop/CLAUDE.md] — 25 rules (#1 adapter, #6 channel, #16 state, #18 unit test, #21 file structure)

### Project Structure Notes
- Render util đặt `src/shared/` (flat file như `retry.ts`) — đúng vì cả renderer (preview) + main (seeding 12.2) import được; tuân rule #1 (renderer KHÔNG import main).
- KHÔNG conflict cấu trúc: không thêm folder/service mới, không đụng adapter/preload/db.
- Biến thể duy nhất so với epics doc: channel naming `phase3:content-template:*` (4.6b) thay vì `phase3:content:*` (doc cũ) — đã giải thích, KHÔNG đổi.

## Dev Agent Record
### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-04: Sprint status hiện có key cũ `12-1-upload-len-youtube-shorts` ở `review`; story active `12-1-content-templates` không có key sprint riêng, nên tracking status trong story file.
- 2026-06-04: Red phase: `npx playwright test tests/unit/content-template-render.spec.ts tests/e2e/content-templates.spec.ts --reporter=line` fail do chưa có `src/shared/content-template-render.ts`.
- 2026-06-04: Green subset: `npm run build && npx playwright test tests/unit/content-template-render.spec.ts tests/e2e/content-templates.spec.ts --reporter=line` → 8 passed.
- 2026-06-04: Lint: `npm run lint` → exit 0, còn 1 warning existing `phase3-security/no-direct-logger` trong `electron-bootstrap.ts`.
- 2026-06-04: Full validation: `npm run build && npx playwright test tests/unit tests/integration tests/e2e --reporter=line` → 246 passed.

### Completion Notes List

- Added shared pure renderer `renderContentTemplate` plus `CONTENT_TEMPLATE_PLACEHOLDERS` for `{uid}` and `{name}` without Electron/main imports.
- Added create/edit template placeholder hint sourced from `CONTENT_TEMPLATE_PLACEHOLDERS`, and live preview rendered with sample UID/name values.
- Kept content template CRUD, IPC channels, DB schema, and self-comment orchestration unchanged per AC3/AC4.
- Added render unit coverage for replacement, missing vars, unknown tokens, empty body, unchanged body, and adjacent placeholders; extended existing content-template E2E to assert hint + preview.

### File List

Story 12.1 files:

- `automation-desktop/src/shared/content-template-render.ts` — new shared placeholder renderer.
- `automation-desktop/src/renderer/src/views/ContentTemplatesView.tsx` — placeholder hint + live preview for create/edit forms.
- `automation-desktop/src/renderer/src/assets/main.css` — hint/preview styling.
- `automation-desktop/tests/unit/content-template-render.spec.ts` — pure render unit tests.
- `automation-desktop/tests/e2e/content-templates.spec.ts` — E2E coverage for hint + preview.
- `_bmad-output/implementation-artifacts/12-1-content-templates.md` — story status/tasks/dev record updates.

Pre-existing worktree files also modified/formatted during validation, not part of Story 12.1 AC scope:

- `automation-desktop/src/main/adapters/electron-bootstrap.ts`
- `automation-desktop/src/main/automation/own-post-target-resolver.ts`
- `automation-desktop/src/main/automation/playwright-runner.ts`
- `automation-desktop/tests/integration/login-smoke.spec.ts`
- `automation-desktop/tests/unit/cookie.spec.ts`
- `automation-desktop/tests/unit/own-post-target-resolver.spec.ts`
- `automation-desktop/tests/unit/playwright-runner.spec.ts`

### Change Log

- 2026-06-04: Implemented Story 12.1 placeholder render utility, UI hint/live preview, unit/E2E coverage, and marked story ready for review.
