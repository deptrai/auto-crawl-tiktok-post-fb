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
- `backend/app/models/organization.py`: Định nghĩa model mới.
- `backend/alembic/versions/`: Tạo migration `add_organizations_table_and_relationships`.
- `backend/app/api/v1/*.py`: Cập nhật các câu truy vấn SQLAlchemy.
- `backend/app/api/deps.py`: Cập nhật logic get current user/organization.
- `frontend/src/features/organizations/`: Màn hình quản lý Organizations cho Super Admin.

## 3. Latest Tech Specifics
- SQLAlchemy 2.0: Có thể sử dụng cơ chế `with_loader_criteria` hoặc Base query builder để tự động gài `organization_id` vào mọi câu select, tránh lọt lưới query quên check org_id (Row Level Security ảo).

## 4. Status
Status: `done`
Note: Ultimate context engine analysis completed - comprehensive developer guide created.

## 5. Tasks / Subtasks

- [ ] Task 1: Thiết lập Database Schema cho Organizations
  - [ ] 1.1: Tạo model `Organization`.
  - [ ] 1.2: Thêm khoá ngoại `organization_id` vào các model: `User`, `Campaign`, `FacebookPage`.
  - [ ] 1.3: Sinh Alembic Migration và apply.
- [ ] Task 2: Cập nhật luồng Data Isolation (Backend)
  - [ ] 2.1: Sửa logic Router để tự động filter các query (VD: get_campaigns) theo `organization_id` lấy từ token.
  - [ ] 2.2: Hỗ trợ Super Admin pass header `X-Organization-Id` để ghi đè `organization_id` truy vấn.
  - [ ] 2.3: Thêm Endpoint quản trị Organizations (CRUD) dành riêng cho Super Admin.
- [ ] Task 3: Giao diện Workspace Switcher (Frontend)
  - [ ] 3.1: Dựng UI Organization Switcher trên Header cho Super Admin.
  - [ ] 3.2: Lưu Organization đang chọn vào Global State (Zustand) và đính kèm vào Axios Interceptor request headers.
  - [ ] 3.3: Màn hình Organization Management (danh sách orgs).
- [ ] Task 4: Viết Unit Tests
  - [ ] 4.1: Test Data Isolation: Đảm bảo User ở Org A không fetch được Campaign của Org B.

### Review Findings

- [ ] [Review][Patch] Bổ sung Unit Tests kiểm chứng Data Isolation cho Multi-Tenancy.
- [ ] [Review][Patch] Rò rỉ dữ liệu chéo (Cross-Tenant Data Leakage) do orphaned users — `ondelete='SET NULL'` trên bảng `users` kết hợp với logic bỏ qua filter khi `org_id is None` trong `apply_org_filter` cấp quyền truy cập toàn cục.
- [ ] [Review][Patch] Rò rỉ dữ liệu (Data Isolation Leakage) đối với Task, Event, Worker, InteractionLog, Video — `Video` không có cột `organization_id` làm `apply_org_filter` vô dụng, các Model khác thì chưa gọi filter.
- [ ] [Review][Patch] Lỗi Logic khóa quyền tự cập nhật Profile của `owner` — `update_data["role"] != UserRole.super_admin` ném 400 khi owner tự cập nhật profile mà truyền lại role "owner".
- [ ] [Review][Patch] Lỗi 500 (DoS) khi thêm trùng FB Page — Khi `page_id` trùng lặp giữa các tenant, API ném `IntegrityError` thay vì báo lỗi thân thiện.
- [ ] [Review][Patch] Lỗ hổng Token Substitution (Refresh Token dùng như Access Token) — `jwt.decode` chưa kiểm tra claims `type` là `access` hay `refresh`.
- [ ] [Review][Patch] API Validate FB Page ném NameError — Quên khai báo param `org_id` trong route `/config/{page_id}/validate`.
- [ ] [Review][Patch] Bỏ qua kiểm tra Must Change Password trong Auth flow — Đăng nhập vẫn cấp Access Token dù cờ `must_change_password` là True.
- [ ] [Review][Patch] Global Runtime Override — Bất kỳ Owner nào cũng có thể sửa Runtime Config chung của hệ thống ở `PUT /system/runtime-config`.
- [ ] [Review][Patch] Lệnh drop_table nguy hiểm trong migration cũ — Lệnh `op.drop_table('users')` và `DROP TYPE CASCADE` trong migration làm mất sạch dữ liệu nếu chạy lại.
- [ ] [Review][Patch] Rò rỉ trạng thái ở Frontend khi đăng xuất — Zustand `logout()` không dọn dẹp các list users, events, tasks, campaigns cũ trên UI.
- [x] [Review][Defer] Xóa bảo vệ chống Brute-Force trong API login — Cần khôi phục `check_login_rate_limit` nhưng hiện tại bị vô hiệu hoá do đang refactor. — deferred, pre-existing

## 6. Dev Agent Record

### Debug Log
- 

### Implementation Plan
- 

### Completion Notes
- 

## 7. File List
- 

## 8. Change Log
- 
