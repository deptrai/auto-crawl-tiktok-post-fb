# Story UX-1.1: Dựng Operator Console + Bulk Self-comment

Status: done

> **Namespace lưu ý:** Story này thuộc epic breakdown **UI/UX redesign** (`epics-ux-redesign.md`), KHÁC với Epic 1 Phase 3 features (`epics-phase3.md`). Dùng prefix `ux-` để tránh trùng `1-1-khoi-tao-scaffold-automation-desktop.md`. KHÔNG ghi vào `sprint-status.yaml` (namespace Phase 3 features) để tránh nhiễu auto-discovery.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator (vận hành nhiều tài khoản Facebook),
I want một console full-width với sidebar điều hướng, bảng tài khoản trạng thái real-time, và khả năng tick chọn nhiều acc để chạy self-comment hàng loạt,
so that tôi điều cả đội tài khoản trong tầm mắt thay vì cuộn dọc và click từng acc.

## Acceptance Criteria

**AC1 — Design tokens (UX-DR1)**
1. Thêm lớp design token vào `src/renderer/src/assets/base.css` `:root`: color (`--bg #0f1216`, `--surface #171b21`, `--surface-2 #1e242c`, `--border #2a323c`, `--text #e8eaed`, `--text-muted #9aa4b0`, `--accent #6c7cff`, `--accent-hover #8893ff`, `--accent-text #0a0d24`), status (`--status-idle #4ad07f`, `--status-running #54a8ff`, `--status-checkpoint #ffb84d`, `--status-error #ff6a52`, `--status-neutral #9aa4b0`), spacing (`--sp-1..6` = 4/8/12/16/24/32), radius (`--r-sm/md/lg` = 8/12/16), font scale (`--fs-display 24`, `--fs-h2 18`, `--fs-body 14`, `--fs-sm 13`, `--fs-xs 11`), `--font-mono: ui-monospace,...`.
2. Token định nghĩa xong; chưa bắt buộc đổi visual mọi component (các AC sau sẽ dùng token).

**AC2 — AppShell + Sidebar nav + routing (UX-DR2, UX-DR3)**
1. **Given** state gate = `ready`, **When** render MainShell, **Then** hiển thị `app-shell` grid `sidebar 240px + content 1fr` full-width — KHÔNG còn `width: min(780px)` căn giữa.
2. Sidebar dùng `<nav>` với NavItem: Dashboard / Profiles / Templates / Proxy / Settings; item active có `aria-current="page"` + indicator accent trái; state `activeView` (useState) điều khiển view; mặc định mở **Profiles**.
3. LicenseChip ("còn N ngày" / offline-grace) hiển thị ở chân sidebar (chuyển từ `.license-status`/`.warning-banner` hiện tại).
4. Gate views (EULA / License / Loading / Readonly) vẫn full màn, KHÔNG render sidebar.
5. ContentTemplatesView / ProxyView mount trong tab tương ứng; ProfilesView ở tab Profiles. Mọi `data-testid` cũ còn nguyên.

**AC3 — TopBar + StatusCounter (UX-DR4)**
1. TopBar hiển thị tiêu đề view + StatusCounter: đếm số profile theo status (idle/running/checkpoint/error) tính từ list profiles hiện có.
2. Counter cập nhật real-time theo poll 5s sẵn có của ProfilesView (không thêm poll mới).
3. Counter có `aria-live="polite"`; dùng dot màu + số.

**AC4 — DataTable + StatusPill (UX-DR5, UX-DR7)**
1. Refactor ProfilesView danh sách từ `<ul className="profiles-list">` sang `<table className="data-table">` semantic: `<thead>` sticky + `<th scope="col">`; cột: checkbox / UID(mono) / Tên hiển thị / StatusPill / Proxy(mono) / Job / Actions.
2. `StatusPill` (component mới, chuẩn hóa từ `.status-badge`): dot màu + label chữ (color-blind safe), variant idle/running/checkpoint/error/neutral, có `title`/tooltip giải thích; dùng chung cho profile status (map `STATUS_LABELS` hiện có) + automation job state (`AUTOMATION_STATE_LABELS`).
3. Giữ NGUYÊN mọi `data-testid`: `profiles-view`, `profiles-list-section`, `profiles-list`, `profile-row-${uid}`, `profile-edit-${uid}`, `profile-edit-save-${uid}`, `profile-edit-cancel-${uid}`, `profile-edit-input-${uid}`, `profile-delete-${uid}`, `profile-delete-confirm-${uid}`, `profile-delete-confirm-submit-${uid}`, `profile-delete-cancel-${uid}`, `profile-proxy-${uid}`, `profile-proxy-acquire-${uid}`, `profile-proxy-release-${uid}`, `profile-self-comment-${uid}`, `profile-automation-status-${uid}`, `profiles-list-loading`, `profiles-list-empty`, `profiles-list-error`.
4. Loading state dùng class/testid riêng (`profiles-list-loading`) — KHÔNG trùng main shell (rule #16).
5. Sửa/Xóa/Gán-Thả proxy hoạt động y như cũ trong row; nút async disable-on-click (rule #17). Hàng/cột UID/proxy/job dùng `var(--font-mono)`.

**AC5 — Multi-select + BulkActionBar + bulk self-comment (UX-DR6, UX-DR15)**
1. Mỗi row có checkbox (`data-testid="profile-select-${uid}"`); header có select-all (`data-testid="profiles-select-all"`); state `selectedIds: Set<string>`.
2. **Given** `selectedIds.size ≥ 1`, **Then** `BulkActionBar` (`data-testid="bulk-action-bar"`, `role="region" aria-label="Hành động hàng loạt"`) hiện sticky bottom: "Đã chọn N" + TargetUrlInput (`bulk-target-input`) + TemplateSelect (`bulk-template-select`) + HeadlessToggle (tái dùng `automation_browser_headless` setting hiện có) + nút "▶ Chạy self-comment (N)" (`bulk-run-button`).
3. **When** bấm Chạy, **Then** nút disable tức thì (rule #17); với MỖI profileId trong `selectedIds` gọi `startSelfComment({ profileId, target })` (loop tuần tự hoặc Promise.all giới hạn); set pill → "Đang xếp hàng"; checkbox auto-clear sau khi enqueue xong.
4. Poll automation status real-time TÁI DÙNG cơ chế `getAutomationStatus` + interval 1s sẵn có (mở rộng cho nhiều job).
5. Cho phép chọn/chạy batch mới khi batch trước đang chạy (không khóa toàn UI).
6. **TemplateSelect Phase A**: chỉ hỗ trợ option "🎲 Random tất cả" (hành vi hiện tại). Các template cụ thể hiển thị trong dropdown NHƯNG **disabled + tooltip "Cần mở rộng IPC (story sau)"** — vì `phase3:automation:start` hiện KHÔNG nhận `templateId` (xem Dev Notes). KHÔNG đổi backend trong story này.
7. Error message tiếng Việt (rule #15); thao tác bằng phím (tab tới checkbox, Space chọn, focus ring `--accent` 2px).

**AC6 — Chất lượng**
1. `npm run lint` 0 errors (kể cả test files), `npm run typecheck` 0 errors.
2. E2E hiện có còn xanh (`npm run test:e2e`); thêm test mới: chọn nhiều acc → bulk bar hiện → bấm chạy → pill đổi trạng thái (`tests/e2e`, escape `[P0]` nếu tag).
3. Renderer KHÔNG import `electron` trực tiếp (rule R-D16 / NFR24) — chỉ qua `window.api`.

## Tasks / Subtasks

- [x] **Task 1 — Design tokens (AC1)**
  - [x] Thêm `:root` token block vào `assets/base.css` (color/spacing/radius/font/mono)
  - [x] Verify contrast AA (text ~13:1, muted ~5:1, accent ~8:1)
- [x] **Task 2 — AppShell + Sidebar + routing (AC2)**
  - [x] Tạo `components/AppShell.tsx` (grid sidebar+content), `components/Sidebar.tsx` (NavItem + LicenseChip)
  - [x] Thêm state `activeView` trong `App.tsx` MainShell; render view theo tab
  - [x] Thêm CSS `.app-shell`, `.sidebar`, `.nav-item`, `.license-chip` vào `main.css` dùng token; bỏ `width: min(780px)` cho main-shell
  - [x] Đảm bảo gate views (EULA/License/Loading/Readonly) vẫn full màn
- [x] **Task 3 — TopBar + StatusCounter (AC3)**
  - [x] Tạo `components/TopBar.tsx` + `components/StatusCounter.tsx`
  - [x] Tính counts từ `profiles` (lift state hoặc truyền callback từ ProfilesView)
- [x] **Task 4 — DataTable + StatusPill (AC4)**
  - [x] Tạo `components/StatusPill.tsx` (variant + tooltip), `components/DataTable` hoặc refactor inline trong ProfilesView
  - [x] Refactor ProfilesView `<ul>` → `<table>`, giữ toàn bộ handler + data-testid
  - [x] CSS `.data-table`, `.status-pill`, `.row-checkbox` dùng token
- [x] **Task 5 — Multi-select + BulkActionBar + bulk run (AC5)**
  - [x] State `selectedIds`; checkbox per row + select-all; Shift-click (optional)
  - [x] Tạo `components/BulkActionBar.tsx` (target + template select + headless toggle + run)
  - [x] `handleBulkSelfComment`: loop `selectedIds` gọi `startSelfComment`; mở rộng automation status poll cho nhiều job
  - [x] TemplateSelect: option "Random tất cả" enabled; template cụ thể disabled + tooltip
- [x] **Task 6 — Chất lượng (AC6)**
  - [x] lint + typecheck pass; E2E cũ xanh
  - [x] Thêm E2E bulk-run flow; (optional) thêm test DataTable render

### Review Findings

> Code review commit `130134e` (2026-06-04) — 3 lớp: Blind Hunter · Edge Case Hunter · Acceptance Auditor.

- [x] [Review][Decision→Patch] Mất trạng thái job + selection khi chuyển tab — RESOLVED (best practice): giữ `ProfilesView` mounted (ẩn bằng `hidden`) để poll + selection sống xuyên tab [App.tsx renderSecondaryView + hidden div]
- [x] [Review][Decision→Defer] Trùng ô Target URL — DEFER: hợp nhất sẽ xóa testid `automation-target-input` → rủi ro vỡ E2E; tách story riêng cập nhật cả test
- [x] [Review][Decision→Defer] Offline-grace hiện 2 chỗ — DEFER: banner (cảnh báo 24h) và LicenseChip (còn N ngày) là thông tin bổ sung, không thật sự trùng; giữ banner cho nổi bật
- [x] [Review][Patch] BLOCKER: `handleBulkSelfComment` — FIXED: commit status từng job ngay khi enqueue + per-profile try/catch (tiếp tục khi 1 job lỗi) + chỉ bỏ chọn job thành công (giữ job lỗi để retry) + báo lỗi tiếng Việt [ProfilesView.tsx:351-388]
- [x] [Review][Patch] `handleDelete` — FIXED: dọn id khỏi `selectedIds` khi xóa profile [ProfilesView.tsx:269-280]
- [x] [Review][Patch] Select-all `indeterminate` — FIXED: thêm `someProfilesSelected` + ref callback set `el.indeterminate` [ProfilesView.tsx:445-448, header checkbox]
- [x] [Review][Defer] StatusCounter `aria-live` đọc cả 4 mục mỗi poll (noisy) — a11y polish, gộp Epic 2 (Story 2.7)
- [x] [Review][Defer] StatusPill chỉ có `title`, thiếu `role`/`aria-label` — a11y, Epic 2
- [x] [Review][Defer] Template `<select>` uncontrolled `defaultValue` — vô hại Phase A (template disabled), revisit khi mở IPC templateId
- [x] [Review][Defer] BulkActionBar refetch templates mỗi lần remount (flicker) — tối ưu sau
- [x] [Review][Defer] `automationError` dùng chung 1 state per-row + bulk — pre-existing, có thể lẫn lỗi
- [x] [Review][Defer] `proxyError` hiện ở mọi row — pre-existing (bản cũ cũng vậy)
- [x] [Review][Defer] Sidebar fallback "License active" khi license inactive — path hầu như không tới (gate chặn), cosmetic
- [x] [Review][Defer] Target URL whitespace bị trim im lặng → fallback feed — pre-existing
- [x] [Review][Defer] `bulk-target-input` thiếu `autoComplete=off`/`type=url` — minor
- [x] [Review][Defer] `.data-table td vertical-align: top` lệch khi cell delete-confirm cao — cosmetic
- [x] [Review][Defer] `offlineGrace` truyền vào AppShell nhưng không dùng trong body (chỉ forward Sidebar) — dead prop cleanup
- [x] [Review][Defer] E2E thiếu test `profiles-select-all` checkbox — bổ sung test sau

**Dismissed (noise/false-positive):** PENDING không map (sai — đã map 'Đang xếp hàng'); nút bulk "kẹt disabled" (đúng pattern rule #17, React khôi phục qua prop); `main-shell` testid trên `section` (cố ý giữ E2E xanh, test pass); select-all stale snapshot (handler đọc `profiles` render hiện tại); `onStatusCountsChange` dep fragility (`setProfileCounts` stable); poll timer rebuild (pattern pre-existing).

## Dev Notes

### Files được TOUCH

| File | Loại | Ghi chú |
|------|------|---------|
| `src/renderer/src/assets/base.css` | UPDATE | thêm token `:root` |
| `src/renderer/src/assets/main.css` | UPDATE | thêm class console mới, bỏ card 780px (giữ class cũ chưa migrate ở story khác) |
| `src/renderer/src/App.tsx` | UPDATE | MainShell → AppShell + activeView routing; giữ nguyên gate logic (loadGate, gateFromStatus, handleAccept, handleActivate, subscribeLicenseChanges) |
| `src/renderer/src/views/ProfilesView.tsx` | UPDATE | `<ul>` → `<table>`, thêm multi-select + bulk bar; giữ mọi handler/testid |
| `src/renderer/src/components/*` | NEW | AppShell, Sidebar, TopBar, StatusCounter, StatusPill, BulkActionBar |

### State machine / behaviors PHẢI giữ (đọc kỹ ProfilesView.tsx hiện tại)

- `refreshProfiles` (poll 5s, có `listInFlightRef`/`pendingRefreshRef` chống chồng lấn) — GIỮ NGUYÊN logic, chỉ đổi render.
- Automation status poll (interval 1s cho job active, `TERMINAL_AUTOMATION_STATES`) — mở rộng cho nhiều job thay vì 1.
- Proxy: `acquireProxyForProfile`/`releaseProxyForProfile`, `refreshProxyAssignments`.
- Edit/Delete inline confirm (`.profile-delete-confirm`) — giữ pattern confirm phá hủy.
- `handleAutomationBrowserModeChange` + setting `automation_browser_headless` — tái dùng cho HeadlessToggle ở bulk bar.
- Mọi nút async đã có pattern `e.currentTarget.disabled = true` trước `void handler()` (rule #17) — giữ.

### ⚠️ Caveat quan trọng — Template selector (AC5.6)

IPC `phase3:automation:start` (xem `src/renderer/src/api/automation-api.ts`) **chỉ nhận `{ profileId, target? }`** — KHÔNG có `templateId`. Template được random server-side. Vì story này **không đổi backend/IPC**, TemplateSelect chỉ enable "Random tất cả". Chọn template cụ thể = story tương lai (mở rộng schema `phase3:automation:start` + handler). Đừng giả định truyền được templateId.

### Bulk self-comment

`startSelfComment` nhận 1 profile/lần. Bulk = lặp qua `selectedIds`. Cân nhắc chạy tuần tự (an toàn) hoặc giới hạn song song. Mỗi job trả `jobId` riêng → lưu vào `automationStatuses[profileId]` (đã có Record). Mở rộng poll hiện tại (đang poll mọi entry active) là đủ.

### Ràng buộc CLAUDE.md

- Renderer KHÔNG import `electron` (chỉ `window.api`) — rule R-D16.
- Loading state class/testid riêng — rule #16.
- Async button disable-on-click — rule #17.
- Error message tiếng Việt — rule #15.
- Lint pass cả test files — rule #20.
- Plain CSS, KHÔNG thêm dependency.

### Project Structure Notes

- Component mới đặt tại `src/renderer/src/components/` (đã có `Versions.tsx` làm tiền lệ).
- KHÔNG cần router lib cho 5 view — dùng `activeView` state + conditional render.
- Tham chiếu visual: `_bmad-output/planning-artifacts/ux-design-directions.html` (accent indigo `#6c7cff`, mật độ row 44px).

### References

- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Visual Design Foundation] — design tokens
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Component Strategy] — AppShell/DataTable/BulkActionBar/StatusPill spec
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Defining Experience & Mechanics] — bulk run flow
- [Source: _bmad-output/planning-artifacts/epics-ux-redesign.md#Story 1.1] — AC gốc
- [Source: automation-desktop/CLAUDE.md] — 25 rule (esp #15/#16/#17/#20, R-D16)
- [Source: automation-desktop/src/renderer/src/views/ProfilesView.tsx] — code hiện tại (handlers, testid, poll)
- [Source: automation-desktop/src/renderer/src/api/automation-api.ts] — startSelfComment signature (KHÔNG có templateId)
- [Source: automation-desktop/src/renderer/src/App.tsx] — gate logic phải giữ

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-04: Started implementation from explicit story path. Per story namespace note, sprint-status.yaml is not updated for this UX story.
- 2026-06-04: RED phase `npx playwright test tests/e2e/profiles.spec.ts -g "operator console" --reporter=line` failed as expected on missing `app-shell`.
- 2026-06-04: Targeted GREEN validation `npm run build && npx playwright test tests/e2e/profiles.spec.ts tests/e2e/content-templates.spec.ts tests/e2e/proxy.spec.ts --reporter=line` passed: 13 passed.
- 2026-06-04: `npm run lint` passed with 0 errors; one existing warning remains in `src/main/adapters/electron-bootstrap.ts` for `phase3-security/no-direct-logger`.
- 2026-06-04: `npm run build && npm run test:e2e` passed; build includes `npm run typecheck`; E2E result: 22 passed.
- 2026-06-04: Full regression `npx playwright test tests/unit tests/integration tests/e2e --reporter=line` passed: 249 passed.

### Completion Notes List

- Implemented the full operator console shell with AppShell, sidebar navigation, view routing, and sidebar LicenseChip while preserving full-screen gate views.
- Added TopBar and live StatusCounter fed by the existing ProfilesView 5s profile polling flow; no extra profile poll was introduced.
- Refactored ProfilesView from list rendering to a semantic table with sticky headers, StatusPill variants, mono UID/proxy/job columns, and preserved existing profile/proxy/edit/delete/self-comment handlers and `data-testid`s.
- Added multi-select and sticky BulkActionBar for bulk self-comment enqueue, using the existing `startSelfComment({ profileId, target })` IPC contract per selected profile and the existing 1s automation status polling for multiple jobs.
- Kept TemplateSelect Phase A scoped to "Random tất cả"; template-specific options remain disabled with tooltip because backend/IPC does not accept `templateId` in this story.
- No backend or IPC schema changes were made; renderer continues to use `window.api` only.

### File List

- `automation-desktop/src/renderer/src/App.tsx`
- `automation-desktop/src/renderer/src/assets/base.css`
- `automation-desktop/src/renderer/src/assets/main.css`
- `automation-desktop/src/renderer/src/components/AppShell.tsx`
- `automation-desktop/src/renderer/src/components/BulkActionBar.tsx`
- `automation-desktop/src/renderer/src/components/Sidebar.tsx`
- `automation-desktop/src/renderer/src/components/StatusCounter.tsx`
- `automation-desktop/src/renderer/src/components/StatusPill.tsx`
- `automation-desktop/src/renderer/src/components/TopBar.tsx`
- `automation-desktop/src/renderer/src/views/ProfilesView.tsx`
- `automation-desktop/tests/e2e/content-templates.spec.ts`
- `automation-desktop/tests/e2e/profiles.spec.ts`
- `automation-desktop/tests/e2e/proxy.spec.ts`

## Change Log

- 2026-06-04: Implemented UX-1.1 operator console, sidebar routing, live status counters, profile data table, status pills, multi-select bulk self-comment flow, and E2E coverage; validated lint, typecheck/build, targeted E2E, full E2E, and full unit/integration/E2E regression.
