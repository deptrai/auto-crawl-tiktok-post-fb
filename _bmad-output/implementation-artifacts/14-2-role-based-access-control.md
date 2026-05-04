# Story 14.2: Role-Based Access Control (RBAC)

## 1. Story Foundation (Requirements)

**User Story:**
As a Super Admin,
I want to phân quyền theo role (Owner / Editor / Viewer),
So that kiểm soát ai được phép thay đổi cấu hình nhạy cảm (token, proxy) và thực hiện các thao tác thay đổi chiến dịch.

**Acceptance Criteria:**
- **Given** User có role `Viewer`
- **When** user cố gắng truy cập endpoint thay đổi campaign hoặc xem access token
- **Then** API trả về `403 Forbidden`
- **And** `Editor` có thể tạo/sửa campaign nhưng không thể xóa hoặc xem token
- **And** `Owner` có toàn quyền.

## 2. Developer Context (Guardrails)

### Technical Requirements
- Triển khai Permission Matrix theo thiết kế:
  - **Owner**: View campaigns, Create/edit campaign, Delete campaign, View access tokens, Manage users, System settings.
  - **Editor**: View campaigns, Create/edit campaign.
  - **Viewer**: View campaigns.
- Backend:
  - Tạo FastAPI Dependency để check Role (VD: `RoleChecker(allowed_roles=["owner", "editor"])`).
  - Áp dụng dependency này vào các Routers: `campaigns.py`, `channels.py`, `users.py`, `organizations.py`.
  - Đảm bảo logic JWT token chứa thông tin `role` của user để giải mã nhanh chóng.
- Frontend:
  - Lấy `role` từ Auth context / JWT.
  - Xây dựng component `RoleGuard` để ẩn/hiện các nút bấm (như Nút Tạo Campaign, Nút Xóa) dựa trên role hiện tại.
  - Redirect trang nếu User truy cập vào route không có quyền.

### Architecture Compliance
- FastAPI Dependency Injection: RBAC phải được áp dụng qua cơ chế Dependency Injection của FastAPI tại tầng Router, KHÔNG viết if/else kiểm tra role phân tán rải rác bên trong logic Service.
- API Response Formatting: Trả về chuẩn HTTP 403 bọc trong format JSON thống nhất: `{"error": {"code": "HTTP_403", "message": "Bạn không có quyền thực hiện hành động này"}}`.

### File Structure Impacts
- `backend/app/api/deps.py`: Bổ sung class/function `RoleChecker`.
- `backend/app/api/v1/*.py`: Áp dụng `RoleChecker` cho tất cả endpoint thay đổi trạng thái (POST/PUT/DELETE).
- `frontend/src/features/auth/RoleGuard.tsx`: Thành phần bọc UI.

## 3. Latest Tech Specifics
- React: Nên tạo custom hook `usePermissions()` hoặc `useRole()` kết nối với Zustand auth store để tái sử dụng ở bất kỳ đâu.
- FastAPI: Dùng closure hoặc class-based dependency (VD: `def require_role(roles: list): def role_checker(...): ...`) để dễ dàng gắn vào route qua `Depends()`.

## 4. Status
Status: `ready-for-dev`
Note: Ultimate context engine analysis completed - comprehensive developer guide created.

## 5. Tasks / Subtasks

- [ ] Task 1: Backend - Xây dựng Role Checker Dependency
  - [ ] 1.1: Bổ sung logic trích xuất `role` từ JWT token tại file `security.py` / `deps.py`.
  - [ ] 1.2: Viết class/function `RoleChecker` nhận danh sách các role được phép và ném `403 Forbidden` nếu role không phù hợp.
- [ ] Task 2: Áp dụng RBAC cho Endpoints
  - [ ] 2.1: Bảo vệ các API nhạy cảm (quản lý user, token) chỉ cho `Owner`.
  - [ ] 2.2: Bảo vệ các API sửa/tạo chiến dịch cho `Owner` và `Editor`.
- [ ] Task 3: Frontend - Giao diện phân quyền
  - [ ] 3.1: Tạo hook `useRole()` và component `<RoleGuard allowedRoles={...}>`.
  - [ ] 3.2: Ẩn các nút "Delete", "Edit", "Settings" đối với User mang role `Viewer`.
  - [ ] 3.3: Ẩn menu "User Management" đối với User không phải `Owner`.
- [ ] Task 4: Viết Unit Tests
  - [ ] 4.1: Test `RoleChecker` dependency từ bỏ request 403 với JWT mock.

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
