# Story UX-2.1: Hoàn thiện trải nghiệm — Copy, Toast, Onboarding, Đồng nhất & A11y

Status: review

> **Namespace:** Epic 2 của `epics-ux-redesign.md` (Phase B). Prefix `ux-` tránh trùng Phase 3 features. KHÔNG ghi `sprint-status.yaml`. Tiếp nối **Story UX-1.1 (done)**: AppShell/Sidebar/TopBar/StatusCounter/StatusPill/BulkActionBar/DataTable + design tokens đã có.

## Story

As an operator (vận hành nhiều tài khoản Facebook),
I want copy được mọi dữ liệu, nhận tổng kết rõ sau mỗi batch, được dẫn dắt khi mới vào, và mọi màn hình đồng nhất + dùng được bằng bàn phím,
so that tôi tin tưởng giao việc cho tool và dùng nó lâu dài không mệt.

## Acceptance Criteria

**AC1 — Copy được dữ liệu (UX-DR9)**
1. Gỡ `user-select: none` ở `body` (`main.css:9`). Operator bôi đen + copy được UID, proxy `host:port`, job id, error message.
2. Có thể giữ `user-select: none` cục bộ cho sidebar nav / nút (tránh chọn nhầm khi click nhanh) — KHÔNG để ở `body`.
3. Không ảnh hưởng drag/click hiện có.

**AC2 — Toast summary sau batch (UX-DR8)**
1. Tạo component `Toast` (`components/Toast.tsx`) + CSS `.toast` dùng token; `role="status" aria-live="polite"`; variant success/warning/error (border-left màu status); auto-dismiss (~5s) + nút đóng.
2. **Given** một batch self-comment (Story 1.1) có ≥1 job về terminal state cuối cùng, **Then** hiện Toast "X/N hoàn tất · Y checkpoint · Z lỗi" (đếm từ `automationStatuses` của batch).
3. Acc lỗi vẫn nổi bật trong table (pill đỏ) — Toast KHÔNG che thông tin lỗi; data-testid `bulk-summary-toast`.
4. Toast điềm tĩnh (rule calm-on-error) — KHÔNG overlay đỏ toàn màn hình.

**AC3 — Chuẩn hóa Button/Input/Panel (UX-DR11)**
1. Thống nhất biến thể Button (primary/ghost/icon/danger) dùng `var(--accent)` + focus ring accent 2px; Input/Textarea/Select dùng token; Panel hợp nhất.
2. Mọi async button disable-on-click (rule #17); giữ `data-testid`.

**AC4 — Áp token cho Templates/Proxy/EULA/License (UX-DR12)**
1. Gỡ Georgia serif h1 (`main.css:261-263`) → dùng `--fs-display` (Inter). Bỏ `border-radius: 28px`, `radial-gradient` body bg, `backdrop-filter: blur` (glow marketing) ở gate cards (`main.css:41-52`).
2. EULA + License giữ full màn (ẩn sidebar) nhưng dùng token mới; ContentTemplatesView + ProxyView dùng component chuẩn hóa.
3. Secret field (license key, API key proxy) vẫn `type="password"` + clear sau dùng (rule #10). Error tiếng Việt (rule #15).

**AC5 — Dashboard EmptyState + onboarding 3 bước (UX-DR10)**
1. Tạo component `EmptyState` (icon + tiêu đề + mô tả + CTA) dùng token.
2. Tab Dashboard (hiện là placeholder `dashboard-panel`): khi chưa có profile/proxy → onboarding 3 bước (① Cấu hình proxy → ② Import profile → ③ Chạy self-comment), mỗi bước có CTA `onNavigate` tới tab tương ứng.
3. Khi đã có dữ liệu → Dashboard hiện tổng quan ngắn (StatusCounter + license). EmptyState tái dùng cho list rỗng (profiles/templates) thay text thô hiện tại.

**AC6 — Responsive desktop (UX-DR13)**
1. Breakpoint `1200px` → sidebar icon-only (~64px); `900px` → sidebar collapse (toggle) + table scroll ngang + bulk bar wrap.
2. BrowserWindow đặt `minWidth ~880px` (main process window config).
3. Bỏ breakpoint mobile `620px` cũ (`main.css:1027+`). E2E resize 1280/1024/900px pass.

**AC7 — Accessibility WCAG 2.1 AA (UX-DR14) + các mục defer từ review UX-1.1**
1. Keyboard nav đầy đủ (tab/enter/space, chọn row bằng phím), focus ring accent 2px rõ ở mọi control.
2. `StatusPill`: thêm `role="img"` + `aria-label` (vd "Trạng thái: Đang chạy") — hiện chỉ có `title`.
3. `StatusCounter`: giảm noise screen reader — bỏ `aria-live` ở container đọc cả 4 mục mỗi poll, hoặc `aria-label` tổng hợp ngắn / chỉ announce khi đổi (hiện `aria-live="polite"` đọc lại toàn bộ mỗi 5s).
4. `BulkActionBar` template `<select>`: chuyển sang controlled (`value` + `onChange` state) thay `defaultValue` (uncontrolled); cân nhắc lift/cache `listContentTemplates` để không refetch mỗi lần remount.
5. `Sidebar` `licenseText`: fallback khi license inactive KHÔNG hiển thị "License active" sai (vd "License" / trạng thái thực).
6. `bulk-target-input`: thêm `autoComplete="off"` (cân nhắc `type="url"`); target whitespace-only → cảnh báo hoặc indicator thay vì im lặng fallback feed.
7. `proxyError` chỉ hiện ở đúng row lỗi (`proxyBusyId === profile.id`), không hiện mọi row.
8. `automationError`: cân nhắc tách state per-row vs bulk để không đè lỗi lẫn nhau.
9. `.data-table td` đổi `vertical-align: top` → `middle` (lệch khi cell delete-confirm cao).
10. `offlineGrace` dead prop ở AppShell: dùng hoặc gỡ.
11. Status phân biệt bằng dot + label (không chỉ màu — color-blind). Contrast AA.

**AC8 — Chất lượng**
1. `npm run lint` 0 errors (kể cả test), `npm run typecheck` 0 errors.
2. E2E hiện có còn xanh; thêm test: copy được (chọn text), Toast hiện sau bulk, **`profiles-select-all` checkbox** (defer từ review UX-1.1), resize breakpoints.
3. Renderer KHÔNG import `electron` (R-D16); plain CSS, KHÔNG thêm dependency.

## Tasks / Subtasks

- [x] **Task 1 — Copy (AC1)**: gỡ `user-select:none` body; khoanh vùng cục bộ nếu cần.
- [x] **Task 2 — Toast (AC2)**: `components/Toast.tsx` + CSS; tính summary từ batch `automationStatuses`; gắn vào ProfilesView sau khi batch terminal.
- [x] **Task 3 — Chuẩn hóa Button/Input/Panel (AC3)**: gom class + token.
- [x] **Task 4 — Token cho gate + Templates/Proxy (AC4)**: bỏ Georgia/glow/radius 28; áp token; giữ password fields.
- [x] **Task 5 — Dashboard onboarding + EmptyState (AC5)**: `components/EmptyState.tsx`; Dashboard có/chưa-có-dữ-liệu; tái dùng cho list rỗng.
- [x] **Task 6 — Responsive (AC6)**: breakpoint 1200/900; minWidth window; bỏ 620px.
- [x] **Task 7 — A11y + review defers (AC7)**: StatusPill aria, StatusCounter noise, template controlled, Sidebar license text, proxyError per-row, automationError tách, vertical-align, offlineGrace prop, target validation, keyboard/focus.
- [x] **Task 8 — Chất lượng (AC8)**: lint/typecheck/E2E + test mới (copy, toast, select-all, resize).

## Dev Notes

### Trạng thái hiện tại đã verify (đọc code post-UX-1.1)

| Điểm | Vị trí | Việc |
|------|--------|------|
| `user-select: none` | `main.css:9` (body) | gỡ |
| Georgia serif h1 | `main.css:261-263` | → `--fs-display` Inter |
| Gate card glow | `main.css:41-52` (radius 28, radial-gradient body, backdrop blur) | bỏ glow, dùng token |
| `.data-table td vertical-align: top` | `main.css:719` | → `middle` |
| breakpoint mobile 620px | `main.css:1027+` | bỏ, thay 1200/900 |
| `dashboard-panel`/`settings-panel` | placeholder (`App.tsx:39-60`, `main.css:244`) | Dashboard → onboarding thật |
| Chưa có `.toast`/`.empty-state` | — | tạo mới |
| 102 `var(--)` đã dùng | console part tokenized | mở rộng sang gate/views |

### Component đã có (Story 1.1) — mở rộng, KHÔNG viết lại

- `StatusPill.tsx`: thêm `role="img"`+`aria-label` (AC7.2).
- `StatusCounter.tsx`: sửa `aria-live` noise (AC7.3).
- `BulkActionBar.tsx`: template `<select>` `defaultValue`→controlled; `listContentTemplates` đang fetch mỗi mount (AC7.4); `bulk-target-input` thêm `autoComplete` (AC7.6).
- `Sidebar.tsx`: `licenseText` fallback inactive (AC7.5).
- `AppShell.tsx`: `offlineGrace` prop dead — dùng/gỡ (AC7.10).
- `ProfilesView.tsx`: `proxyError` render mọi row (line ~743) → per-row (AC7.7); `automationError` chung state (AC7.8); target trim im lặng (AC7.6); batch summary feed Toast (AC2).

### Việc PHẢI giữ (regression guard)

- Mọi `data-testid` hiện có (cả Story 1.1 mới: `bulk-action-bar`, `profiles-select-all`, `nav-*`, `license-chip`, `topbar-status-counter`...).
- Pattern disable-on-click (#17), loading-shell riêng (#16), error tiếng Việt (#15), không import electron (R-D16).
- Gate flow (EULA→License→ready) + `activeView` routing + keep-mounted ProfilesView (đã thêm ở review UX-1.1) — không phá.
- Bulk run logic đã sửa ở review (per-job commit + retry) — không hồi quy.

### Ràng buộc

Plain CSS, không thêm dependency. Token đã có ở `base.css :root` (accent `#6c7cff`). Tham chiếu visual: `ux-design-directions.html`. Lock tiếng Việt (NFR28).

### References

- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] — §Visual Foundation, §Component Strategy, §UX Patterns, §Responsive & A11y
- [Source: _bmad-output/planning-artifacts/epics-ux-redesign.md#Story 2.1]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — mục "code review of story ux-1-1" (12 defer gộp vào AC7)
- [Source: _bmad-output/implementation-artifacts/ux-1-1-operator-console-bulk-run.md] — story trước (done) + Review Findings
- [Source: automation-desktop/CLAUDE.md] — rule #15/#16/#17/#20, R-D16
- [Source: automation-desktop/src/renderer/src/assets/main.css] — line refs ở trên
- [Source: automation-desktop/src/renderer/src/components/*.tsx] — component cần mở rộng

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-06-04: Started implementation from explicit story path. Per story namespace note, sprint-status.yaml is not updated for this UX story.
- 2026-06-04: RED phase `npx playwright test tests/e2e/profiles.spec.ts -g "UX polish" ...` failed as expected on body `user-select: none` / missing UX polish behavior.
- 2026-06-04: `npm run build` passed; build includes `npm run typecheck` for node and web.
- 2026-06-04: Targeted GREEN `npx playwright test tests/e2e/profiles.spec.ts -g "UX polish" --reporter=line` passed: 1 passed.
- 2026-06-04: Targeted integration `npx playwright test tests/integration/security-baseline.spec.ts --reporter=line` passed: 4 passed.
- 2026-06-04: `npm run lint` passed with 0 errors; one existing warning remains in `src/main/adapters/electron-bootstrap.ts` for `phase3-security/no-direct-logger`.
- 2026-06-04: `npm run test:e2e` passed: 23 passed.
- 2026-06-04: Full regression `npx playwright test tests/unit tests/integration tests/e2e --reporter=line` passed: 250 passed.
- 2026-06-04: Renderer Electron import check returned no matches for `src/renderer/src`.

### Completion Notes List

- Enabled operator copy/select by removing body-level `user-select: none` while keeping no-select behavior scoped to controls/navigation.
- Added `Toast` batch summary for bulk self-comment terminal states with calm success/warning/error styling, `role="status"`, auto-dismiss, and `bulk-summary-toast` coverage.
- Standardized token use across gate cards, inputs, textareas, buttons, focus rings, panels, Templates, Proxy, EULA/License surfaces, and removed Georgia/glow/radius-28/mobile-marketing styling.
- Added reusable `EmptyState` and replaced placeholder Dashboard with 3-step onboarding CTAs; reused EmptyState for Profiles/Templates empty lists.
- Added responsive desktop behavior: 1200px icon-only sidebar, 900px sidebar toggle/table horizontal scroll/bulk bar wrap, and BrowserWindow `minWidth` guard.
- Closed UX-1.1 deferred a11y/polish items: StatusPill aria, quieter StatusCounter aria label, controlled bulk template select, safer license fallback, target whitespace warning, per-row proxy/automation errors, middle-aligned table cells, and keyboard/focus coverage.
- Added E2E coverage for copy/select behavior, Dashboard onboarding, select-all checkbox, bulk summary toast, a11y attrs, and resize breakpoints; added integration assertion for BrowserWindow minWidth.

### File List

- `automation-desktop/src/main/adapters/electron-security-baseline.ts`
- `automation-desktop/src/renderer/src/App.tsx`
- `automation-desktop/src/renderer/src/assets/main.css`
- `automation-desktop/src/renderer/src/components/AppShell.tsx`
- `automation-desktop/src/renderer/src/components/BulkActionBar.tsx`
- `automation-desktop/src/renderer/src/components/EmptyState.tsx`
- `automation-desktop/src/renderer/src/components/Sidebar.tsx`
- `automation-desktop/src/renderer/src/components/StatusCounter.tsx`
- `automation-desktop/src/renderer/src/components/StatusPill.tsx`
- `automation-desktop/src/renderer/src/components/Toast.tsx`
- `automation-desktop/src/renderer/src/views/ContentTemplatesView.tsx`
- `automation-desktop/src/renderer/src/views/ProfilesView.tsx`
- `automation-desktop/tests/e2e/profiles.spec.ts`
- `automation-desktop/tests/integration/security-baseline.spec.ts`

## Change Log

- 2026-06-04: Implemented UX-2.1 trust/feedback polish: copyable data, batch toast summary, tokenized controls/gates/views, Dashboard onboarding, reusable EmptyState, responsive sidebar/table/bulk layout, a11y/deferred UX-1.1 fixes, BrowserWindow minWidth, and regression coverage.
