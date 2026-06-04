# Story UX-3.1: Tăng tốc Power-user — Shortcuts, Context menu, Tooltip & Settings

Status: done

> **Namespace:** Epic 3 (Phase C — **OPTIONAL**) của `epics-ux-redesign.md`. Prefix `ux-`. KHÔNG ghi `sprint-status.yaml`. Tiếp nối UX-1.1 + UX-2.1 (đều done). Chỉ làm khi muốn đánh bóng cho power-user; không block giá trị cốt lõi.

## Story

As a power operator (đã quen tool, thao tác nhiều giờ),
I want phím tắt, chuột phải, chú thích cột và một nơi cấu hình tập trung,
so that tôi thao tác lặp nhanh hơn, ít rời bàn phím và chuột.

## Acceptance Criteria

**AC1 — Keyboard shortcuts (UX-DR16)**
1. Trong tab Profiles: `Ctrl/Cmd+A` khi focus trong vùng table → chọn tất cả profile (tương đương select-all), KHÔNG kích hoạt khi đang gõ trong input/textarea.
2. `Enter` khi có ≥1 acc được chọn VÀ không có target warning → chạy bulk self-comment (tương đương bấm nút bulk-run); KHÔNG trigger khi focus đang ở trong input/textarea/select (tránh submit nhầm khi gõ).
3. `/` → focus ô URL target (`bulk-target-input` nếu bulk bar đang hiện); KHÔNG trigger khi đang gõ trong field khác.
4. Có chỗ liệt kê shortcut (tooltip nút hoặc dòng phụ chú trong Settings) để operator biết.
5. Shortcuts chỉ active khi đang ở tab Profiles (ProfilesView keep-mounted nhưng `hidden` ở tab khác — listener phải tôn trọng `activeView`/visibility, không bắt phím khi view ẩn).

**AC2 — Context menu chuột phải trên row (UX-DR16)**
1. Chuột phải trên `<tr data-testid="profile-row-${uid}">` → hiện context menu (`data-testid="profile-context-menu"`) với các mục: Chạy self-comment / Gán proxy / Thả proxy / Sửa / Xóa.
2. Mỗi mục **tái dùng handler hiện có** (`handleStartSelfComment`, `handleAcquireProxy`, `handleReleaseProxy`, `startEdit`, mở confirm xóa) — KHÔNG viết lại logic.
3. "Xóa" trong menu vẫn đi qua confirm inline hiện có (`confirmDeleteId`) — KHÔNG xóa thẳng (rule confirm phá hủy).
4. Menu đóng khi: click ra ngoài, `Esc`, hoặc chọn 1 mục. Mục disabled đúng theo state (vd Thả proxy disabled nếu chưa gán; Chạy disabled nếu đang chạy).
5. `preventDefault()` context menu mặc định của trình duyệt trên row.

**AC3 — Column tooltip (UX-DR16)**
1. Header cột có tooltip giải thích (vd "Job hiện tại" = "Job automation gần nhất của profile"); dùng `title` hoặc tooltip component nhẹ; không thêm dependency.
2. Tối thiểu chú thích cột Job + Proxy + Trạng thái.

**AC4 — Settings view (UX-DR16)**
1. Thay placeholder `settings-panel` (App.tsx) bằng Settings view thực: gom **chế độ trình duyệt mặc định** (`automation_browser_headless`) + chỗ cho **telemetry opt-in** (tương lai, có thể disabled + nhãn "sắp có").
2. Dùng component chuẩn hóa từ Epic 2 (Panel/Toggle/Button + token).
3. ⚠️ **Sync caveat**: `automation_browser_headless` hiện là single source trong `ProfilesView` (state + `getSetting` mount + `handleAutomationBrowserModeChange` + dùng ở row toggle line 747 và BulkActionBar line 1063). Nếu Settings cũng đọc/ghi setting này, PHẢI tránh 2 nguồn lệch nhau: hoặc (a) lift state headless lên App/shared context, hoặc (b) Settings ghi qua `settings-api` rồi ProfilesView re-fetch khi quay lại tab Profiles. Chọn (a) nếu muốn sync tức thì. KHÔNG để 2 toggle hiển thị giá trị khác nhau.
4. `data-testid="settings-view"` giữ nguyên; thêm testid cho toggle (vd `settings-headless-toggle`).

**AC5 — Sidebar disclosure a11y (defer từ review UX-1.1/2.1)**
1. `sidebar-toggle` button thêm `aria-expanded` phản ánh `sidebarExpanded` (hiện state ở AppShell, chưa truyền xuống Sidebar) → truyền `sidebarExpanded` vào Sidebar prop.
2. Cân nhắc giữ trạng thái expand nhất quán khi resize qua breakpoint (không bắt buộc).

**AC6 — Chất lượng**
1. `npm run lint` 0 errors (kể cả test), `npm run typecheck` 0 errors.
2. E2E hiện có còn xanh; thêm test: shortcut select-all + Enter run; context menu hiện + 1 mục hoạt động; Settings toggle lưu.
3. Renderer KHÔNG import `electron` (R-D16); plain CSS, KHÔNG thêm dependency; lock tiếng Việt (rule #15); async action disable-on-click (#17).

## Tasks / Subtasks

- [x] **Task 1 — Keyboard shortcuts (AC1)**: listener gắn ở ProfilesView (hoặc table container), guard `activeView==='profiles'` + không bắt khi target là INPUT/TEXTAREA/SELECT; map Ctrl/Cmd+A, Enter, `/`.
- [x] **Task 2 — Context menu (AC2)**: `components/RowContextMenu.tsx` (hoặc inline) + `onContextMenu` trên `<tr>`; tái dùng handler; đóng on outside-click/Esc; disabled theo state.
- [x] **Task 3 — Column tooltip (AC3)**: `title` trên `<th>` Job/Proxy/Trạng thái.
- [x] **Task 4 — Settings view (AC4)**: thay placeholder; gom headless toggle; xử lý sync caveat (lift state hoặc re-fetch).
- [x] **Task 5 — Sidebar aria-expanded (AC5)**: truyền `sidebarExpanded` → Sidebar; set `aria-expanded`.
- [x] **Task 6 — Chất lượng (AC6)**: lint/typecheck/E2E + test mới.

### Review Findings

- [x] [Review][Patch] Một số label Settings mới thêm vẫn dùng tiếng Anh, vi phạm khóa tiếng Việt [automation-desktop/src/renderer/src/App.tsx:166]
- [x] [Review][Patch] Sidebar toggle ở breakpoint mobile vẫn có thể bị console content che khi click/touch; test hiện chỉ dùng keyboard nên không bắt lỗi pointer [automation-desktop/src/renderer/src/assets/main.css:1240]

#### Review run 2026-06-04 (baseline 1358625 → 7e7632e — Blind/Edge/Auditor)

> 0 BLOCKER · 1 decision · 4 patch · 6 defer · 5 dismiss.

**Decision-needed (resolved → patch, chọn hướng 1: full WAI-ARIA):**

- [x] [Review][Patch] Context menu keyboard navigation chuẩn WAI-ARIA — focus menuitem đầu khi mở + ↑/↓ roving focus + Home/End + giữ Esc. (Quyết định: hướng 1, làm đầy đủ.) [ProfilesView.tsx:~1140] [blind+edge MEDIUM]

**Patch:**

- [x] [Review][Patch] Enter/Ctrl+A/`/` hijack khi focus trên control tương tác — `isEditableTarget` không chặn `<button>`/`[role=menuitem]`/`a`; capture-phase keydown + preventDefault nuốt Enter-activate nút "Lưu"/"Hủy"/confirm-Xóa/menuitem → bulk-run chạy nhầm. Fix: mở rộng guard thành interactive selector. [automation-desktop/src/renderer/src/views/ProfilesView.tsx:64,507] [auditor F1 HIGH + edge EC-24]
- [x] [Review][Patch] `settingsError` stale hiển thị nhầm tab — state share ở MainShell render cả ở `settings-error` và `automation-settings-error`; lỗi phát ở Settings rồi sang Profiles → banner ma. Fix: clear `settingsError` khi đổi `activeView`. [automation-desktop/src/renderer/src/App.tsx:46] [blind+edge MEDIUM]
- [x] [Review][Patch] Context menu state không clear khi đổi tab / profile bị xóa giữa chừng — `contextMenu` + Esc listener không guard `activeView`. Fix: clear khi `activeView !== 'profiles'` và khi target profile rời list. [automation-desktop/src/renderer/src/views/ProfilesView.tsx:609] [auditor F2/F4 + edge EC-6]
- [x] [Review][Patch] Thiếu E2E negative-guard cho Enter — chỉ phủ happy path; AC1.2 hứa không trigger khi gõ trong input/(sau fix) focus nút nhưng không có test bảo vệ. Fix: thêm assertion. [automation-desktop/tests/e2e/profiles.spec.ts] [auditor F3]

**Deferred (xem deferred-work.md):**

- [x] [Review][Defer] Settings toggle đổi headless khi automation đang chạy — inconsistent disable vs row toggle; fix cần lift `automationBusyId` (architectural). [edge EC-19] — deferred
- [x] [Review][Defer] Enter chạy bulk khi headless save in-flight → main đọc persisted cũ (race hẹp, server-read). [edge EC-5] — deferred
- [x] [Review][Defer] Ctrl+A no-op khi table chưa focus / list rỗng — đúng spec AC1.1. [blind+edge EC-2] — deferred, matches AC
- [x] [Review][Defer] Context menu clamp magic numbers (220/230). [blind] — deferred, cosmetic
- [x] [Review][Defer] `.data-table-wrap` tabIndex=0 thiếu role. [blind] — deferred, minor a11y
- [x] [Review][Defer] Checkbox Settings chưa disable-on-click trực tiếp (rule #17) — pre-existing. [auditor F7] — deferred, pre-existing

**Dismissed (5):** Blind "pointerdown BLOCKER" (tự rút lại); Blind "handleBulkSelfComment stale HIGH" (verified false-positive — body chỉ dùng `startSelfComment`, deps đủ, lint exhaustive-deps pass); Blind "getTargetValidationMessage dep" (pure fn); Edge "`/` với 0 profiles" (by design); Auditor F5 "E2E IPC evaluate" (consistent pattern).

## Dev Notes

### Trạng thái hiện tại đã verify

| Điểm | Vị trí | Ghi chú |
|------|--------|---------|
| Chưa có search box | ProfilesView | `/` focus `bulk-target-input` (không có search) |
| Rows chưa có onContextMenu/onKeyDown | `<tr data-testid="profile-row-${uid}">` (~line 818) | attach point cho context menu |
| headless setting single source | ProfilesView:21,137,231,242,747 + BulkActionBar:1063 | Settings phải sync (xem AC4.3) |
| Settings placeholder | `App.tsx:97-104` (`settings-panel`/`settings-view`) | thay bằng view thực |
| sidebar-toggle thiếu aria-expanded | `Sidebar.tsx:42-50`; `sidebarExpanded` ở `AppShell.tsx:30` | truyền prop xuống |

### Handler tái dùng cho context menu (KHÔNG viết lại)

`handleStartSelfComment(profile)`, `handleAcquireProxy(profile)`, `handleReleaseProxy(profile)`, `startEdit(profile)`, set `confirmDeleteId(profile.id)` (mở confirm). Trạng thái disabled: dùng `automationBusyId`, `proxyBusyId`, `proxyAssignments[profile.id]`, `rowBusyId` như các nút row hiện có.

### Việc PHẢI giữ (regression guard)

- Mọi `data-testid` hiện có (UX-1.1/2.1): `profile-row-${uid}`, `profile-self-comment-${uid}`, `bulk-target-input`, `sidebar-toggle`, `settings-view`, `profiles-select-all`...
- Keyboard listener KHÔNG được nuốt phím khi operator đang gõ trong input/textarea (import textarea, target, edit name, license, proxy key).
- ProfilesView keep-mounted: shortcut listener phải off khi `activeView !== 'profiles'` (tránh bắt phím khi ở tab khác).
- Confirm phá hủy (#17 disable-on-click, confirm xóa) — context menu KHÔNG bypass.
- Bulk-run logic + Toast + scoped errors (UX-1.1/2.1) — không hồi quy.

### Ràng buộc

Plain CSS, không thêm dependency (context menu + tooltip tự làm bằng CSS/JS thuần). Token đã có. Lock tiếng Việt. Tham chiếu: `ux-design-specification.md` §UX Patterns, §Component Strategy (Phase C). **Optional** — có thể bỏ qua nếu ưu tiên việc khác.

### References

- [Source: _bmad-output/planning-artifacts/epics-ux-redesign.md#Story 3.1]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] — §Component Strategy (Phase C), §UX Patterns
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — sidebar aria-expanded (AC5)
- [Source: _bmad-output/implementation-artifacts/ux-2-1-trust-feedback-polish.md] + `ux-1-1-...md` — story trước (done) + Review Findings
- [Source: automation-desktop/CLAUDE.md] — rule #15/#16/#17/#20, R-D16
- [Source: automation-desktop/src/renderer/src/views/ProfilesView.tsx] — handlers + rows + headless setting
- [Source: automation-desktop/src/renderer/src/components/Sidebar.tsx, AppShell.tsx] — sidebar toggle
- [Source: automation-desktop/src/renderer/src/App.tsx] — settings placeholder

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-04: Bắt đầu triển khai story UX-3.1; story yêu cầu không ghi sprint-status.yaml nên chỉ cập nhật story file.
- 2026-06-04: `npm run typecheck` pass.
- 2026-06-04: `npm run lint` pass với 0 errors; còn 1 warning cũ ngoài phạm vi ở `src/main/adapters/electron-bootstrap.ts:231`.
- 2026-06-04: `npm run build` pass để cập nhật `out/` trước E2E.
- 2026-06-04: `npx playwright test tests/e2e/profiles.spec.ts tests/e2e/automation-trigger.spec.ts --workers=3` pass 13/13.
- 2026-06-04: `npx playwright test tests/e2e --workers=3` pass 24/24.
- 2026-06-04: Code review applied 2 patch findings; `npm run build`, `npm run lint`, and `npx playwright test tests/e2e/profiles.spec.ts -g "power-user shortcuts" --workers=1` pass.

### Completion Notes List

- Thêm keyboard shortcuts cho Profiles: Ctrl/Cmd+A chọn tất cả khi focus trong bảng, `/` focus URL target, Enter chạy bulk khi hợp lệ; listener tôn trọng `activeView` và bỏ qua input/textarea/select.
- Thêm context menu chuột phải trên row profile, dùng lại handler row hiện có cho self-comment/proxy/edit/delete; delete vẫn mở confirm inline.
- Thêm tooltip `title` cho cột Trạng thái, Proxy, Job.
- Thay Settings placeholder bằng Settings view thật; lift `automation_browser_headless` lên `MainShell` để Profiles, BulkActionBar và Settings dùng cùng nguồn state.
- Thêm `aria-expanded` cho `sidebar-toggle` qua prop `expanded` từ AppShell.
- Thêm E2E power-user phủ shortcut select-all + Enter run, context menu, Settings toggle sync, column tooltips và sidebar aria-expanded.

### File List

- automation-desktop/src/renderer/src/App.tsx
- automation-desktop/src/renderer/src/assets/main.css
- automation-desktop/src/renderer/src/components/AppShell.tsx
- automation-desktop/src/renderer/src/components/Sidebar.tsx
- automation-desktop/src/renderer/src/views/ProfilesView.tsx
- automation-desktop/tests/e2e/profiles.spec.ts
- _bmad-output/implementation-artifacts/ux-3-1-power-user-efficiency.md

### Change Log

- 2026-06-04: Implemented UX-3.1 power-user shortcuts, row context menu, Settings sync, sidebar a11y and E2E coverage.
- 2026-06-04: Addressed code review findings: Settings labels fully Vietnamese and sidebar toggle pointer click fixed on mobile breakpoint.
- 2026-06-04: Applied 5 review patches (WAI-ARIA menu nav, interactive shortcut guard, settingsError clear-on-tab, context menu lifecycle, E2E negative-guard).
