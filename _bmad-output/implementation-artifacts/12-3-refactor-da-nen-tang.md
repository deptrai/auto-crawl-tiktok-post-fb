# Story 12.3: Refactor Đăng Bài Đa Nền Tảng (Multi-Platform Refactor)

## 1. Story Foundation (Requirements)

**User Story:**
As a Campaign Manager,
I want to chọn nhiều nền tảng đích (Facebook, YouTube, Instagram) cho cùng một chiến dịch,
So that một video sau khi crawl về sẽ tự động được đăng lên tất cả các kênh đã chọn mà không cần tạo nhiều campaign.

**Acceptance Criteria:**
- **Given** Admin đang tạo hoặc sửa chiến dịch.
- **When** Admin chọn nhiều nền tảng trong phần "Nền tảng đích".
- **Then** Hệ thống phải lưu trữ danh sách nền tảng và các ID đích tương ứng.
- **And** Task Worker phải nhận diện và thực hiện đăng bài lên TẤT CẢ các nền tảng đã chọn cho mỗi video.
- **And** Trạng thái đăng bài (`posted`, `failed`) và ID bài đăng sau khi đăng (`fb_post_id`, `yt_video_id`, v.v.) phải được quản lý riêng biệt cho từng nền tảng trên mỗi video.

## 2. Developer Context (Guardrails)

### Technical Requirements
- **Database Schema Change (CRITICAL):**
  - Hiện tại bảng `videos` chỉ có `status` và `fb_post_id` (cho 1 platform).
  - Cần tạo bảng `video_posts`: `id`, `video_id`, `platform` (enum), `status`, `external_id` (thay cho `fb_post_id`), `last_error`, `created_at`, `updated_at`.
- **Campaign Model:**
  - `target_platforms`: JSON (ví dụ: `['facebook', 'youtube']`).
  - `platform_targets`: JSON (ví dụ: `{'facebook': 'page_id_123', 'youtube': 'channel_id_456'}`).
- **Worker Logic:**
  - `auto_post_job` sẽ lặp qua các `target_platforms` của campaign. Nếu một platform chưa có bản ghi `VideoPost` thành công cho video đó, tiến hành publish.

## 4. Status
Status: `done`

## 5. Tasks / Subtasks

- [x] Task 1: Tái cấu trúc Database
  - [x] 1.1: Cập nhật model `Campaign` (thêm `target_platforms`, `platform_targets`).
  - [x] 1.2: Tạo model `VideoPost`.
  - [x] 1.3: Tạo Alembic migration.
- [x] Task 2: Cập nhật Backend Core Logic
  - [x] 2.1: Refactor `auto_post_job` trong `cron.py` để hỗ trợ đa nền tảng.
  - [x] 2.2: Cập nhật logic `metrics_collector` để query từ `VideoPost`.
  - [x] 2.3: Cập nhật Campaigns API (Schemas & Endpoints).
- [x] Task 3: Cập nhật Frontend UI
  - [x] 3.1: Thay đổi UI chọn nền tảng sang Multi-checkbox.
  - [x] 3.2: Hiển thị trạng thái đăng bài chi tiết cho từng nền tảng trong Queue/Analytics.
- [x] Task 4: Kiểm thử
  - [x] 4.1: Chạy regression tests và bổ sung test case cho multi-platform.

## 6. Dev Agent Record
### Agent Model Used
Gemini 2.0 Flash

### Change Log
- 2026-05-06: Hoàn thành refactor đa nền tảng. Chuyển đổi sang bảng VideoPost và Checkboxes destinations.

