# Story 13.1: Crawl Video Từ YouTube Shorts (YouTube Shorts Crawler)

## 1. Story Foundation (Requirements)

**User Story:**
As a Campaign Manager,
I want to thêm YouTube channel/playlist làm nguồn crawl,
So that nội dung YouTube Shorts cũng được đưa vào pipeline đăng tải kịch bản tự động, gia tăng thêm nguồn nguyên liệu nội dung thay vì chỉ phụ thuộc vào TikTok (Đa Nguồn Crawl).

**Acceptance Criteria:**
- **Given** Admin khai báo thông tin chiến dịch, truyền vào `source_url` là YouTube channel URL (ví dụ: `youtube.com/@channel/shorts`) hoặc một cụm playlist URL định dạng Shorts.
- **When** Background job định kỳ `sync_campaign_content` của chiến dịch chạy.
- **Then** Background job tự động điều hướng sang xử lý crawler engine nhận diện là module Youtube. Sử dụng thư viện gốc `yt-dlp` để extract list video.
- **And** metadata của video (title, description, views, thumbnail) được format mapping lại thành Schema chuẩn `Video` để lưu vào database (Tương thích 100% với Data Pipeline hiện có).

## 2. Developer Context (Guardrails)

### Technical Requirements
- Mở rộng Model `campaigns`:
  - Có thể thêm field nhận diện `source_platform: String DEFAULT "tiktok"` (Cho phép cấu hình là `youtube`, `instagram`).
- Tích hợp Crawler Engine:
  - Phase 1 đang dùng Apify (`ApifyTiktokScraper`) làm core logic crawl. Với YouTube, do không bị chặn nghiêm ngặt nhờ API ẩn của `yt-dlp`, không cần thiết phải dùng proxy API bên thứ 3 (Apify).
  - Khởi tạo thư viện mã nguồn mở `yt-dlp` làm implementation cho Backend worker. Gọi hàm trích xuất playlist flat list, filter các video Shorts (< 60 giây).
- Schema Mapping Interface:
  - Video gốc từ `yt-dlp` trả về cấu trúc dict phức tạp, developer phải mapping sang Schema chuẩn Pydantic `VideoCreate` (bao gồm title, original_url, download_url, cover_url).
- Downloader Handling: `yt-dlp` kiêm nhiệm luôn việc download trực tiếp file HD/MP4 tốt nhất về thư mục tmp/. Hãy skip bước dùng downloader Tiktok cũ đối với video của YT.

### Architecture Compliance
- Backend: Sử dụng **Strategy Pattern (Factory)** cho phần `Content Scraper / Crawler`.
  - Giống như Publisher Pattern bên Epic 12, Scraper hiện tại cần trừu tượng hóa: `BaseScraper` -> implement các lớp `TiktokScraper`, `YoutubeScraper`.
- Khi download qua yt-dlp, luôn config format string tuỳ chọn độ phân giải ổn ngang dọc phù hợp mobile (như `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]"`).
- Database Migration: Cần tạo Alembic script cho việc bổ sung tuỳ biến platform của Campaign nếu cần (ví dụ cột `source_platform`).
- Lưu ý vòng đời: Quản lý cache dọn rác tốt nếu video tải xuống thành công, vì file MP4 tải cục bộ sẽ tốn dung lượng ổ đĩa VM (Đã cover trong Epic 8, nhưng cần tuân thủ dọn file sau upload đối với YT Scraper).

### Previous Intelligence
- Background Job của module Crawler đang được kích hoạt thông qua Cron / Celery hay APScheduler bên trong lõi code gốc. Không sửa luồng Job Manager, chỉ sửa bên trong hàm execute task để switch logic Scraper.

### File Structure Impacts
- `backend/app/services/scrapers/base.py` => Interface định hình Scraper.
- `backend/app/services/scrapers/youtube.py` => Implement downloader và fetcher bằng `yt-dlp`.
- `backend/app/services/task_queue.py` => Switch logic dựa trên thông số URL / platform của Campaign.
- `backend/requirements.txt` => Bổ sung `yt-dlp[default]`.

## 3. Latest Tech Specifics
- `yt-dlp` liên tục phải update bản mới nhất theo patch của Youtube. Trong requirements nên cài version loosely bound `>=2024.xx.xx` hoặc setup Cron auto update library trên môi trường production, nếu không 1 ngày nào đó yt-dlp sẽ tạch signature fetching.
- Lọc Video Shorts thay vì Video Thường: Khi truyền parameter vào `yt-dlp`, dùng parameter `--match-filter "duration <= 60"` để loại bỏ các video dài nằm lộn xộn trong playlist hoặc channel.

## 4. Status
Status: `ready-for-dev`
Note: Ultimate context engine analysis completed - comprehensive developer guide created.
