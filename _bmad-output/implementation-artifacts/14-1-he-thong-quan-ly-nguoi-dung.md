# Story 14.1: Hệ Thống Quản Lý Người Dùng (User Management)

## 1. Story Foundation (Requirements)

**User Story:**
As a Super Admin,
I want to tạo và quản lý tài khoản cho các thành viên team (User CRUD),
So that nhiều người có thể truy cập và quản lý hệ thống cùng lúc với các credential đăng nhập riêng biệt thay vì dùng chung một admin account như hiện tại (Multi-Tenant Base).

**Acceptance Criteria:**
- **Given** Giao diện Super Admin: Có danh sách quản lý thành viên đăng nhập vào trang User Management.
- **When** Super Admin tạo user mới với thông tin: `email`, `password`, và `role`.
- **Then** Xây dựng Authentication Flow (JWT). User được khởi tạo trong Database (mật khẩu bị hash kỹ càng bằng thư viện `bcrypt`, tuyệt đối không lưu plaintext).
- **And** User mới có thể tiến hành login với JWT token và xem được profile cá nhân (tên, avatar URL tuỳ chọn, last login datetime). Cấu trúc Base API Router sẽ tự động pass user claim để nhận diện ai đang thao tác trong Database audit log.

## 2. Developer Context (Guardrails)

### Technical Requirements
- Mở rộng Model `Users`:
  - Hiện tại project có thể mới chỉ có cấu trúc single admin (hoặc hardcoded user). Bắt buộc phải khởi tạo Schema Database cho bảng quản lý User bài bản.
  - Các column cần thiết: `id` (UUID PK), `email` (Unique Index), `hashed_password` (String), `full_name` (String), `role` (Enum/String: Super Admin, Owner, Editor, Viewer), `is_active` (Boolean, default true), `last_login_at` (DateTime).
- Xây dựng Auth Flow (Tầng API):
  - Khởi tạo thư viện mã hoá mật khẩu qua `passlib[bcrypt]`.
  - Service `jwt.py` để generate token (`access_token` và `refresh_token`).
  - Lớp bảo vệ API: Xây dựng Dependency / Guard (ví dụ `get_current_user` với FastAPI Depends) để bảo vệ toàn bộ các Router API hiện có để không cho truy cập Public. Phán đoán Token (Bearer Token format). Đầu ra của dependency map 1-1 với model User hiện hành.
- Frontend Update:
  - Bổ sung Màn hình System Login Page (form login).
  - Setup UI Global State quản trị Context User (Authentication Token lưu trong Storage local/HTTPOnly cookie).
  - Component quản trị Users dành riêng cho Super Admin UI (table, create user modal, block/unblock action).

### Architecture Compliance
- Do bảo mật là tối quan trọng, Endpoint Login cần Rate Limit phòng ngừa Brute-Force attack hoặc dò password.
- Quản lý Migration: Bảng Model `Users` bắt buộc phải tạo thông qua script `alembic`. Khi tạo mới, seed trực tiếp 1 tài khoản Super Admin root (lấy qua env variable cấu hình `ROOT_ADMIN_EMAIL` và `ROOT_ADMIN_PASSWORD`) để có chốt vào hệ thống sau khi reset db.
- Tên biến: Phải đảm bảo DB đặt `snake_case`, API payload mapping qua Frontend `camelCase`.

### Previous Intelligence (Liên kết Epic Access Token)
- Trước mặt, Facebook Token và Proxy System đang được lưu trữ theo dạng Singletone (Của hệ thống/Tất cả user). User management ở bài toán này chưa phân lô. Tính năng Role Based Router sẽ được thiết kế ở Story 14.2, trong story này chỉ tập trung cấu trúc User Base Authentication và Login JWT để đóng khung truy cập.

### File Structure Impacts
- `backend/alembic/versions/` => Migrations tạo bảng `users` và seed root admin.
- `backend/app/models/users.py` => Define the Users table/entity.
- `backend/app/schemas/users.py` => Create/Update DTO schemas.
- `backend/app/api/v1/auth.py` => JWT login endpoint (`/login`, `/me`).
- `backend/app/api/v1/users.py` => Quản trị user endpoint (của root admin).
- `backend/app/core/security.py` => Logic Bcrypt hash và JWT validation.
- `frontend/src/features/auth/` => Add Auth Store Context và Login/Users UI pages.

## 3. Latest Tech Specifics
- FastAPI/Python hiện đại khuyến nghị `PyJWT` trên mức `python-jose` vì `python-jose` đã ngừng nhận maintain updates. 
- Mật khẩu nên có policy tối thiểu 8 ký tự, 1 số, 1 chữ hoa trên Front-end để giảm rủi ro bảo mật cơ bản. 

## 4. Status
Status: `ready-for-dev`
Note: Ultimate context engine analysis completed - comprehensive developer guide created.
