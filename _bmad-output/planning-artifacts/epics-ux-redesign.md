---
stepsCompleted: ['step-01-validate-prerequisites.md', 'step-02-design-epics.md', 'step-03-create-stories.md', 'step-04-final-validation.md']
status: 'complete'
completedAt: '2026-06-04'
inputDocuments:
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - _bmad-output/planning-artifacts/prd-phase3.md
  - automation-desktop/project-context.md
  - automation-desktop/CLAUDE.md
phase: 'phase-3'
scope: 'UI/UX redesign — operator console (brownfield refactor renderer, không đổi backend/IPC)'
parentEpics: '_bmad-output/planning-artifacts/epics-phase3.md'
storyGranularity: 'consolidated — mỗi epic = 1 story lớn (theo yêu cầu solo dev + AI agent)'
---

# automation-desktop UI/UX Redesign — Epic Breakdown

## Overview

Document này decompose **UX Design Specification** (`ux-design-specification.md`) thành epics & stories cho việc tái cấu trúc UI/UX `automation-desktop` (Phase 3.0 Electron). Đây là **brownfield refactor renderer** — KHÔNG đổi backend/IPC/DB, KHÔNG thêm dependency, giữ `data-testid` để bảo toàn E2E.

> **Story granularity:** Theo yêu cầu, mỗi epic = **1 story lớn**. Các hạng mục con (token, AppShell, DataTable...) trở thành **acceptance criteria dạng checklist** trong story — để 1 dev/AI agent implement trọn một mạch thay vì chẻ vụn.
>
> KHÔNG đụng `epics.md` (Phase 1+2) và `epics-phase3.md` (feature epics Phase 3). File này bổ sung cho `epics-phase3.md` ở khía cạnh trải nghiệm UI của các Epic 2/3/4.

## Requirements Inventory

### Functional Requirements

> Trích từ `prd-phase3.md` — chỉ các FR mà UI redesign trực tiếp phục vụ (backend phần lớn đã build).

FR1: User import hàng loạt profile Facebook (`uid|pass|2fa|cookie|...`).
FR2: User xem, sửa, xóa từng profile và metadata (proxy assignment).
FR3: User xem trạng thái real-time của từng profile (idle, running, checkpoint, error).
FR13: User chạy self-comment trên post của chính profile (validation action).
FR24: User cấu hình và xoay proxy (proxyfb).
FR26: Hệ thống bind proxy riêng cho mỗi profile session.
FR36: User accept EULA trước khi sử dụng.
FR37: Hệ thống hiển thị privacy policy minh bạch.

### NonFunctional Requirements

NFR5: IPC round-trip (renderer ↔ main) < 100ms cho thao tác UI.
NFR24: Business logic truy cập framework qua adapter layer — renderer KHÔNG import `electron` trực tiếp.
NFR26: Test coverage cho logic chính (E2E cho UI behavior).
NFR28: UI + error message lock tiếng Việt (Phase 3.0→3.4).

### Additional Requirements

> Từ `automation-desktop/CLAUDE.md` (25 rule) + project-context — ràng buộc kỹ thuật khi refactor.

- Plain CSS, KHÔNG thêm Tailwind/MUI/dependency.
- Giữ nguyên mọi `data-testid` hiện có; thêm testid cho component mới (DataTable, BulkBar) — rule #18.
- Loading state class/testid riêng (`loading-shell`), không trùng main-shell — rule #16.
- Async button disable-on-click trước khi xử lý async — rule #17.
- Error message tiếng Việt trong UI — rule #15.
- Lint + typecheck pass (kể cả test files) — rule #20.

### UX Design Requirements

> Trích đầy đủ từ `ux-design-specification.md`. Mỗi UX-DR giờ là một AC bullet trong story của epic tương ứng.

UX-DR1: Design token layer (`base.css :root`): color/spacing/radius/font scale/mono.
UX-DR2: AppShell full-width (bỏ card `min(780px)`).
UX-DR3: Sidebar nav + tab routing (Dashboard/Profiles/Templates/Proxy/Settings).
UX-DR4: TopBar + StatusCounter real-time.
UX-DR5: DataTable + RowCheckbox (refactor `<ul>`).
UX-DR6: BulkActionBar + multi-select bulk self-comment.
UX-DR7: StatusPill (refactor `.status-badge`), dùng chung profile/job/proxy.
UX-DR8: Toast summary sau batch.
UX-DR9: Gỡ `user-select:none` (copy được).
UX-DR10: EmptyState + onboarding 3 bước (Dashboard).
UX-DR11: Chuẩn hóa Button/Input/Panel theo token.
UX-DR12: Áp token cho Templates/Proxy/EULA/License.
UX-DR13: Responsive desktop breakpoints (1200/900px) + minWidth.
UX-DR14: Accessibility WCAG 2.1 AA.
UX-DR15: Template selector trong run flow.
UX-DR16: Power-user: keyboard shortcuts, context menu, tooltip, Settings view.

### FR Coverage Map

| FR | Epic / Story | Ghi chú |
|----|------|---------|
| FR1 import | Epic 1 / Story 1.1 | Import panel + DataTable |
| FR2 CRUD profile | Epic 1 / Story 1.1 | Sửa/Xóa trong row |
| FR3 real-time status | Epic 1 / Story 1.1 | StatusPill + StatusCounter |
| FR13 self-comment | Epic 1 / Story 1.1 | BulkActionBar bulk run |
| FR24 cấu hình proxy | Epic 1 / Story 1.1 | Proxy nav tab (token polish ở Epic 2) |
| FR26 bind proxy/profile | Epic 1 / Story 1.1 | Cột Proxy + gán/thả trong row |
| FR36 EULA | Epic 2 / Story 2.1 | Gate view áp token |
| FR37 privacy policy | Epic 2 / Story 2.1 | Gate view áp token |

UX-DR coverage: Epic 1 = UX-DR 1,2,3,4,5,6,7,15 (+ keyboard/focus cơ bản từ 14); Epic 2 = UX-DR 8,9,10,11,12,13,14; Epic 3 = UX-DR 16.

## Epic List

### Epic 1: Operator Console & Bulk Run *(Phase A — core, shippable)*
Operator điều hướng một console thực thụ (sidebar nav, full-width), nhìn tất cả tài khoản trong bảng có trạng thái real-time, tick chọn nhiều acc → chạy self-comment hàng loạt bằng 1 nút ("tick & run a fleet"). Giá trị cốt lõi. **1 story.**

### Epic 2: Trust, Feedback & Polish *(Phase B — refinement)*
Operator copy được mọi dữ liệu, nhận toast tổng kết sau batch, được onboarding dẫn dắt, toàn bộ view đồng nhất visual + đạt accessibility AA. **1 story.**

### Epic 3: Power-User Efficiency *(Phase C — optional)*
Operator dùng phím tắt, context menu chuột phải, tooltip cột, khung Settings tập trung — tăng tốc thao tác lặp. **1 story.**

## Epic 1: Operator Console & Bulk Run

Biến card 780px cuộn dọc thành operator console full-width có navigation, bảng tài khoản trạng thái real-time, và chạy self-comment hàng loạt bằng multi-select. **Toàn bộ Epic = 1 story** dưới đây; các hạng mục là checklist AC.

### Story 1.1: Dựng Operator Console + Bulk Self-comment

As an operator,
I want một console full-width với sidebar điều hướng, bảng tài khoản trạng thái real-time, và khả năng tick chọn nhiều acc để chạy self-comment hàng loạt,
So that tôi điều cả đội tài khoản trong tầm mắt thay vì cuộn dọc và click từng acc.

**Acceptance Criteria:**

**Given** `base.css` chỉ có vài biến của electron-vite
**When** thêm lớp design token vào `:root` (UX-DR1)
**Then** có đủ token: color (`--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--accent: #6c7cff`, `--accent-text`), status (`--status-idle/running/checkpoint/error/neutral`), spacing (`--sp-1..6`), radius (`--r-sm/md/lg`), font scale (`--fs-display/h2/body/sm/xs`), `--font-mono`; contrast đạt WCAG AA

**Given** đã qua gate EULA + License (state `ready`)
**When** app render MainShell (UX-DR2, UX-DR3)
**Then** hiển thị `AppShell` grid `sidebar 240px + content 1fr` full-width (bỏ card `min(780px)` căn giữa); sidebar `<nav>` với NavItem Dashboard/Profiles/Templates/Proxy/Settings, item active có `aria-current="page"` + indicator accent trái; state `activeView` điều khiển view; LicenseChip ở chân sidebar
**And** gate views (EULA/License/Loading) vẫn full màn, ẩn sidebar; view cũ (Profiles/Templates/Proxy) mount trong tab tương ứng, `data-testid` cũ còn nguyên

**Given** đang ở console với danh sách profiles
**When** TopBar render (UX-DR4)
**Then** hiển thị tiêu đề view + StatusCounter (số acc idle/running/checkpoint/error, dot + số), cập nhật real-time theo poll hiện có, `aria-live="polite"`

**Given** ProfilesView đang dùng `<ul>` list
**When** refactor sang `<table class="data-table">` (UX-DR5, UX-DR7)
**Then** cột: checkbox / UID(mono) / Tên / StatusPill / Proxy(mono) / Job / Actions; thead sticky; row hover/selected; `StatusPill` thay `.status-badge` (dot + label chữ color-blind safe, variant idle/running/checkpoint/error/neutral, tooltip), dùng chung cho profile status + job state + proxy health
**And** giữ NGUYÊN mọi `data-testid` (`profile-row-${uid}`, `profile-edit-${uid}`, `profile-delete-${uid}`...); loading state class/testid riêng (rule #16); Sửa/Xóa/gán-thả proxy hoạt động như cũ; nút async disable-on-click (rule #17)

**Given** DataTable đang hiển thị
**When** tick checkbox ≥1 acc (hỗ trợ select-all ở header) (UX-DR6, UX-DR15)
**Then** `BulkActionBar` sticky bottom trượt lên: "Đã chọn N" + TargetUrlInput + TemplateSelect ("Random tất cả" hoặc 1 template cụ thể) + HeadlessToggle + nút "▶ Chạy self-comment (N)"; `role="region" aria-label="Hành động hàng loạt"`
**When** bấm nút chạy
**Then** nút disable tức thì (rule #17), enqueue job self-comment cho TỪNG acc đã chọn, pill → "Đang xếp hàng"; poll status real-time từng job; cho phép batch chồng batch (không khóa UI); checkbox auto-clear sau enqueue
**And** thao tác bằng phím được (tab tới checkbox, Space chọn, focus ring accent 2px); mọi error message tiếng Việt (rule #15); lint + typecheck pass, E2E hiện có vẫn xanh + thêm test cho DataTable/BulkBar (rule #18)

## Epic 2: Trust, Feedback & Polish

Hoàn thiện trải nghiệm: copy được dữ liệu, phản hồi điềm tĩnh, onboarding dẫn dắt, đồng nhất visual toàn bộ view, đạt accessibility AA. **Toàn bộ Epic = 1 story.**

### Story 2.1: Hoàn thiện trải nghiệm — Copy, Toast, Onboarding, Đồng nhất & A11y

As an operator,
I want copy được mọi dữ liệu, nhận tổng kết rõ sau mỗi batch, được dẫn dắt khi mới vào, và mọi màn hình đồng nhất + dùng được bằng bàn phím,
So that tôi tin tưởng giao việc cho tool và dùng nó lâu dài không mệt.

**Acceptance Criteria:**

**Given** `body` có `user-select: none` chặn copy (UX-DR9)
**When** gỡ rule này (giữ `none` chỉ cho sidebar/nút nếu cần)
**Then** operator bôi đen + copy được UID, proxy `host:port`, job id, error message; không ảnh hưởng drag/click

**Given** một batch self-comment (Epic 1) vừa chạy xong (UX-DR8)
**When** tất cả job về terminal state
**Then** hiện `Toast` góc dưới phải "X/N hoàn tất · Y checkpoint · Z lỗi", auto-dismiss, `role="status" aria-live="polite"`, variant success/warning/error; acc lỗi vẫn nổi bật trong table

**Given** đang có nhiều biến thể button/input rời rạc + view chưa đồng nhất (UX-DR11, UX-DR12)
**When** chuẩn hóa theo token
**Then** Button (primary/ghost/icon/danger) + Input/Textarea/Select + Panel dùng token; Templates + Proxy hiển thị trong tab console; EULA + License giữ full màn nhưng dùng token mới (bỏ Georgia 64px + gradient glow); secret field vẫn `type=password` + clear sau dùng (rule #10); error tiếng Việt (rule #15)

**Given** operator vừa qua gate, chưa có profile/proxy (UX-DR10)
**When** mở tab Dashboard
**Then** hiện `EmptyState` onboarding 3 bước (① proxy → ② import → ③ chạy), mỗi bước có CTA dẫn tab; khi đã có dữ liệu, Dashboard hiện tổng quan ngắn (counter + license); EmptyState tái dùng cho list rỗng

**Given** layout console (UX-DR13)
**When** thay đổi bề rộng cửa sổ
**Then** ≥1200px sidebar mở 240px; 900–1199px sidebar icon-only; <900px sidebar collapse + table scroll + bulk bar wrap; BrowserWindow `minWidth ~880px`; bỏ breakpoint 620px cũ; E2E resize 1280/1024/900px pass

**Given** toàn bộ console (UX-DR14)
**When** audit WCAG 2.1 AA
**Then** keyboard nav đầy đủ (tab/enter/space, chọn row bằng phím), focus ring accent 2px; semantic HTML + ARIA (`<nav>`/`<table>`/`<th scope>`, aria-label/aria-current/aria-live); status phân biệt bằng dot+label; contrast AA; target size hợp lý; cân nhắc `@axe-core/playwright`; giữ `data-testid`

## Epic 3: Power-User Efficiency

Tăng tốc cho operator thành thạo. Optional — chỉ làm khi Epic 1+2 ổn định. **Toàn bộ Epic = 1 story.**

### Story 3.1: Tăng tốc Power-user — Shortcuts, Context menu, Tooltip & Settings

As a power operator,
I want phím tắt, chuột phải, chú thích cột và một nơi cấu hình tập trung,
So that tôi thao tác lặp nhanh hơn không rời bàn phím.

**Acceptance Criteria:**

**Given** đang ở tab Profiles (UX-DR16)
**When** dùng phím tắt
**Then** hỗ trợ tối thiểu: select-all (Ctrl/Cmd+A trong table), chạy batch (Enter khi có acc chọn + đủ target), focus ô tìm/target (`/`); không xung đột nhập liệu; có chỗ liệt kê shortcut

**Given** một row profile trong DataTable
**When** chuột phải
**Then** context menu: Chạy self-comment / Gán-Thả proxy / Sửa / Xóa (Xóa vẫn confirm); đóng khi click ngoài hoặc Esc; tái dùng handler của nút tương ứng

**Given** DataTable + tab Settings (khung)
**When** hover header cột / mở Settings
**Then** header cột có tooltip giải thích; Settings view gom tùy chọn (chế độ trình duyệt mặc định, telemetry opt-in tương lai...); dùng component chuẩn hóa (Epic 2); giữ `data-testid`
