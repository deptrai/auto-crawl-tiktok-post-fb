# Story 12.1: Upload Lên YouTube Shorts (YouTube Shorts Publisher)

## 1. Story Foundation (Requirements)

**User Story:**
As a Campaign Manager,
I want to cấu hình campaign để đăng video lên YouTube Shorts channel,
So that nội dung được phân phối sang YouTube audience mà không cần upload thủ công (Đa nền tảng).

**Acceptance Criteria:**
- **Given** Admin thiết lập kết nối tới YouTube channel (thông qua luồng OAuth2 của Google Cloud) và cấu hình liên kết Campaign (hướng luồng TikTok sang YouTube Shorts).
- **When** Video trải qua các bước download, xử lý AI caption (chờ đợi ở trạng thái `ready` / `pending_publish`).
- **Then** Background worker sẽ upload file MP4 lên YouTube Shorts thông qua *YouTube Data API v3* (Yêu cầu video < 60 giây và tỷ lệ thường là 9:16).
- **And** tự động gán metadata gồm `category_id`, `description`, `tags` từ nội dung AI caption + original caption.

## 2. Developer Context (Guardrails)

### Technical Requirements
- Triển khai OAuth2 Integration cho Youtube:
  - Cần module mới để lưu trữ OAuth2 tokens (Access Token, Refresh Token) của hệ sinh thái Google/YouTube cho từng tenant hoặc system. Khuyến nghị tạo bảng `youtube_channels`.
- Refactor Publisher Service:
  - Kiến trúc hiện tại (Phase 1) có thể đang bind cứng luồng Publisher vào nền tảng Facebook. Cần áp dụng **Strategy Pattern (hoặc Factory)** cho module Publish để dễ dàng cắm rút đa nền tảng (`FacebookPublisher`, `YouTubePublisher`).
- API YouTube Shorts: 
  - YouTube Data API v3 xử lý file thông qua upload endpoint. Cần sử dụng Resumable Upload protocol cho video có dung lượng vài chục MBs thay vì Multipart Direct để tránh đứt gãy kết nối mạng.
- Xử lý Metadata YouTube:
  - YouTube bắt buộc phải có Title (tiêu đề). Nên bảo AI sinh riêng 1 dòng cho Youtube Title (< 100 characters), hoặc bóc từ đoạn đầu tiên của Caption.

### Architecture Compliance
- Backend: Sử dụng thư viện `google-api-python-client` hoặc `httpx` RAW HTTP theo tài liệu chuẩn của Google.
- Lưu ý vòng đời Access Token của Google hết hạn liên tục (1 giờ). Chắc chắn Code có luồng Auto-Refresh Token thông qua `refresh_token`.
- Xử lý MP4 Formats: Thông số kỹ thuật Shorts: Video dọc (9:16) và dưới 60s. Nếu TikTok bốc về video > 60s, YouTube API sẽ coi nó là video ngang bình thường (Standard Video) thay vì Shorts, do vậy nên warning log hoặc strict filter ngay từ lúc tải. Nên truyền hastag `#shorts` trong description / title để nền tảng nhận diện nhanh.
- Tuân thủ cấu trúc database: Dùng Alembic migration nếu sinh thêm bảng `youtube_channels` hoặc gộp thành `connected_platforms`.

### Previous Intelligence (Liên Kết Epic 3/5)
- Hệ thống Retry / Circuit Breaker (từ Epic 4 - Phanh Gấp) phải được áp dụng cả bên YouTube API để nếu Google Quota Limit Exception ném ra (Error 403 Rate Limit), system worker sẽ pause.

### File Structure Impacts
- `backend/alembic/versions/` => Migrations bảng youtube oauth if any.
- `backend/app/models/platforms.py` => Declare Youtube Models.
- `backend/app/services/publishers/base.py` => Base Interface Publisher.
- `backend/app/services/publishers/youtube.py` => Triển khai module upload Youtube Data API.
- `frontend/src/features/integrations/` => Giao diện bấm Nút Sign-in with Google OAuth.

## 3. Latest Tech Specifics
- Cơ chế upload API V3: Endpoint `/upload/youtube/v3/videos?uploadType=resumable`. Không dùng Endpoint insert thông thường vì tỷ lệ failed cao.  
- Quản lý Quota của Google rất khắt khe (10,000 unit/day default). Hàm upload tốn khoảng 1600 units/video => 1 project free chỉ upload được khoảng 6 videos/ngày. Cần hướng dẫn Document rõ cho User phải request tăng Quota.

## 4. Status
Status: `ready-for-dev`
Note: Ultimate context engine analysis completed - comprehensive developer guide created.
