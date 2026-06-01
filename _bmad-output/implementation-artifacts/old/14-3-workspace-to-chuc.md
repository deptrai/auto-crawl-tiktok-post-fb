# Story 14.3: Workspace Tổ Chức (Organization Workspace)

## 1. Story Foundation (Requirements)

**User Story:**
As a Super Admin,
I want to tổ chức campaigns theo workspace/organization,
So that nhiều team hoặc khách hàng có thể dùng cùng một hệ thống mà không thấy data của nhau (Multi-Tenancy Isolation).

**Acceptance Criteria:**
- **Given** Hệ thống có nhiều Organization
- **When** user đăng nhập
- **Then** chỉ thấy campaigns, data và facebook pages thuộc organization của mình
- **And** Super Admin (người có `organization_id` = NULL) có thể tuỳ chọn switch giữa các organizations trên giao diện để quản lý.

## 2. Developer Context (Guardrails)

### Technical Requirements
- Mở rộng Database Schema (Multi-Tenancy):
  - Khởi tạo model `Organization` (`id`, `name`, `slug`, `created_at`).
  - Thêm cột `organization_id` (Foreign Key) vào các model chính: `User`, `Campaign`, `FacebookPage`.
- Phân tách Dữ Liệu (Data Isolation):
  - Lấy `organization_id` từ Token của người dùng.
  - Sửa lại toàn bộ các query liên quan đến Campaigns, Facebook Pages, Tasks để luôn filter kèm điều kiện `where(organization_id == current_org_id)`.
  - Nếu là Super Admin, cho phép request gửi kèm header (VD: `X-Organization-Id`) để thao tác thay cho Organization khác.
- Giao diện Frontend:
  - Hiển thị Context Switcher (Dropdown) cho Super Admin đổi Organization đang làm việc.
  - Giao diện Admin quản lý danh sách Organization, thêm/sửa/xóa.

### Architecture Compliance
- Multi-Tenancy qua Shared-DB / Column-based Isolation: Mọi bảng dữ liệu người dùng phải gắn ID của tổ chức. Bắt buộc filter để chống lộ lọt data.
- API Design: Frontend gửi header `X-Organization-Id` hoặc lấy trực tiếp từ JWT.

### File Structure Impacts
- `backend/app/models/organization.py`: Định nghĩa model mới (Đã gộp vào models.py).
- `backend/alembic/versions/`: Tạo migration `add_organizations_table_and_relationships`.
- `backend/app/api/v1/*.py`: Cập nhật các câu truy vấn SQLAlchemy.
- `backend/app/api/deps.py`: Cập nhật logic get current user/organization.
- `frontend/src/features/organizations/`: Màn hình quản lý Organizations cho Super Admin.

## 3. Latest Tech Specifics
- SQLAlchemy 2.0: Sử dụng `apply_org_filter` helper để gài `organization_id` vào các câu select.

## 4. Status
Status: `done`
Note: Tính năng đã hoàn thành và được kiểm thử (Unit Test + Code Review).

## 5. Tasks / Subtasks

- [x] Task 1: Thiết lập Database Schema cho Organizations
  - [x] 1.1: Tạo model `Organization`.
  - [x] 1.2: Thêm khoá ngoại `organization_id` vào các model: `User`, `Campaign`, `FacebookPage`.
  - [x] 1.3: Sinh Alembic Migration và apply.
- [x] Task 2: Cập nhật luồng Data Isolation (Backend)
  - [x] 2.1: Sửa logic Router để tự động filter các query (VD: get_campaigns) theo `organization_id` lấy từ token.
  - [x] 2.2: Hỗ trợ Super Admin pass header `X-Organization-Id` để ghi đè `organization_id` truy vấn.
  - [x] 2.3: Thêm Endpoint quản trị Organizations (CRUD) dành riêng cho Super Admin.
- [x] Task 3: Giao diện Workspace Switcher (Frontend)
  - [x] 3.1: Dựng UI Organization Switcher trên Header cho Super Admin.
  - [x] 3.2: Lưu Organization đang chọn vào Global State (Zustand) và đính kèm vào Axios Interceptor request headers.
  - [x] 3.3: Màn hình Organization Management (danh sách orgs).
- [x] Task 4: Viết Unit Tests
  - [x] 4.1: Test Data Isolation: Đảm bảo User ở Org A không fetch được Campaign của Org B.

### Review Findings

- [x] [Review][Patch] Bổ sung Unit Tests kiểm chứng Data Isolation cho Multi-Tenancy.
- [x] [Review][Patch] Rò rỉ dữ liệu chéo (Cross-Tenant Data Leakage) do orphaned users — Đã đổi thành `ondelete='CASCADE'`.
- [x] [Review][Patch] Rò rỉ dữ liệu (Data Isolation Leakage) đối với Task, Event, Worker, InteractionLog, Video — Đã thêm `organization_id` và áp dụng filter.
- [x] [Review][Patch] Lỗi Logic khóa quyền tự cập nhật Profile của `owner` — Đã sửa logic so sánh role.
- [x] [Review][Patch] Lỗi 500 (DoS) khi thêm trùng FB Page — Đã thêm check global page_id.
- [x] [Review][Patch] Lỗ hổng Token Substitution (Refresh Token dùng như Access Token) — Đã thêm check `type == "access"`.
- [x] [Review][Patch] API Validate FB Page ném NameError — Đã khai báo param `org_id`.
- [x] [Review][Patch] Bỏ qua kiểm tra Must Change Password trong Auth flow — Đã tích hợp vào `RoleChecker`.
- [x] [Review][Patch] Global Runtime Override — Đã giới hạn quyền `super_admin`.
- [x] [Review][Patch] Lệnh drop_table nguy hiểm trong migration cũ — Đã comment lệnh drop users_old.
- [x] [Review][Patch] Rò rỉ trạng thái ở Frontend khi đăng xuất — Đã dọn dẹp state trong `handleLogout`.
- [x] [Review][Defer] Xóa bảo vệ chống Brute-Force trong API login — deferred, pre-existing

## 6. Dev Agent Record

### Debug Log
- Gặp lỗi môi trường Alembic (DB host `db` không resolve được từ máy local) -> Fixed bằng cách override `DATABASE_URL` sang `localhost:5433`.
- Gặp lỗi missing `passlib` khi chạy test -> Fixed bằng cách install vào venv.
- Migration bị rối -> Đã dọn dẹp và tạo một migration duy nhất `58dc46872d17`.

### Implementation Plan
- Cập nhật models.py (Organization + FKs).
- Cập nhật deps.py (get_current_organization_id + apply_org_filter).
- Cập nhật toàn bộ Router Backend.
- Sửa lỗi security review.
- Tạo Unit Test.

### Completion Notes
- Tính năng Multi-Tenancy đã hoạt động ổn định.
- Data isolation được áp dụng cho: Campaigns, FB Pages, Videos, Tasks, Interactions, System Events.

## 7. File List
- `backend/app/models/models.py`
- `backend/app/api/deps.py`
- `backend/app/api/organizations.py`
- `backend/app/api/campaigns.py`
- `backend/app/api/facebook.py`
- `backend/app/api/system.py`
- `backend/app/api/users.py`
- `backend/app/api/auth.py`
- `backend/alembic/versions/58dc46872d17_feat_organizations_multi_tenancy.py`
- `backend/tests/test_data_isolation.py`
- `frontend/src/store/orgStore.js`
- `frontend/src/App.jsx`

## 8. Change Log
- 2026-05-06: Hoàn thiện tính năng Multi-Tenancy và Data Isolation. Vá 11 lỗi phát hiện qua Code Review.
