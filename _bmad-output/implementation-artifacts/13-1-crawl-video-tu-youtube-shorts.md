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

Status: `done`
Note: Ultimate context engine analysis completed - comprehensive developer guide created.

## 5. Tasks / Subtasks

- [x] Task 1: Tạo Scraper Strategy Pattern
  - [x] 1.1: Tạo `backend/app/services/scrapers/__init__.py`
  - [x] 1.2: Tạo `backend/app/services/scrapers/base.py` — `BaseScraper` abstract interface
  - [x] 1.3: Tạo `backend/app/services/scrapers/tiktok.py` — wrap existing TikTok logic
  - [x] 1.4: Tạo `backend/app/services/scrapers/youtube.py` — YoutubeScraper dùng yt-dlp
  - [x] 1.5: Tạo `backend/app/services/scrapers/factory.py` — `get_scraper(source_url)` factory function

- [x] Task 2: Implement YoutubeScraper
  - [x] 2.1: `extract_metadata()` — dùng yt-dlp `extract_flat=True` để lấy danh sách Shorts từ channel/playlist URL
  - [x] 2.2: `download_video()` — dùng yt-dlp download trực tiếp với format string tối ưu mobile
  - [x] 2.3: Filter Shorts ≤60s và map sang schema chuẩn (id, title, description, webpage_url, view_count, duration)

- [x] Task 3: Tích hợp vào campaign_jobs.py
  - [x] 3.1: Thay `from app.services.tiktok_crawler import download_video, extract_metadata` bằng scraper factory
  - [x] 3.2: Cập nhật `sync_campaign_content` để dùng `get_scraper(source_url).extract_metadata()`
  - [x] 3.3: Cập nhật `retry_video_download` để dùng scraper factory

- [x] Task 4: Unit Tests
  - [x] 4.1: Test factory routing (youtube.com → YoutubeScraper, tiktok.com → TiktokScraper)
  - [x] 4.2: Test YoutubeScraper metadata mapping và Shorts filter
  - [x] 4.3: Test backward compat — TikTok sync vẫn hoạt động

## 6. Dev Agent Record

### Implementation Plan
- Strategy Pattern: `BaseScraper` → `TiktokScraper` (wrap hiện tại) + `YoutubeScraper` (yt-dlp mới)
- Factory detect URL: youtube.com/youtu.be → YoutubeScraper; còn lại → TiktokScraper
- Không thêm `source_platform` DB column (detect qua URL — simpler, backward-compatible)
- YoutubeScraper dùng `extract_flat` playlist rồi filter `duration <= 60`
- Download: yt-dlp với format `bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best`

### Completion Notes
- Triển khai Strategy Pattern hoàn chỉnh: `BaseScraper` abstract → `TiktokScraper` + `YoutubeScraper` + `factory.get_scraper()`
- `campaign_jobs.py` refactored từ direct `tiktok_crawler` import sang scraper factory — backward-compatible 100%
- `_normalize_channel_url()` tự động append `/shorts` cho bare channel URLs
- Duration filter ≤60s: entries không có duration (extract_flat) được chấp nhận (heuristic)
- 31 unit tests mới, 4 existing regression tests updated để match scraper factory architecture
- Full suite: **278 passed, 0 failed** (2026-05-04)

## 7. File List
- `backend/app/services/scrapers/__init__.py` (new)
- `backend/app/services/scrapers/base.py` (new)
- `backend/app/services/scrapers/tiktok.py` (new)
- `backend/app/services/scrapers/youtube.py` (new)
- `backend/app/services/scrapers/factory.py` (new)
- `backend/app/services/campaign_jobs.py` (modified)
- `backend/tests/test_youtube_scraper.py` (new)
- `backend/tests/test_apify_crawler.py` (modified — update backward-compat assertion)
- `backend/tests/test_content_filter.py` (modified — update mock targets)
- `backend/tests/test_cross_campaign_dedup.py` (modified — update mock targets)
- `backend/tests/test_brand_voice_prompt.py` (modified — update hashtag assertion)

## 8. Change Log
- 2026-05-04: Bắt đầu implement Story 13.1 — YouTube Shorts Scraper Strategy Pattern
- 2026-05-04: Hoàn tất Story 13.1 — 278 tests passed, 0 failed
- 2026-05-04: Code review hoàn tất — 3 patch, 3 defer, 5 dismissed
- 2026-05-04: Tất cả patches applied — 284 tests passed, 0 failed → Story DONE

### Review Findings

<!-- 3 decision-needed → 0 | 3 patch | 3 defer | 5 dismissed -->

#### Patch (cần fix)

- [x] [Review][Patch] yt-dlp outtmpl/extension mismatch — `out_path` cố định `.mp4` nhưng yt-dlp có thể output khác tên → `os.path.exists(out_path)` fail ngay cả khi download thành công. Cần glob tìm file thực sau khi download. [`youtube.py:download_video`] **FIXED**
- [x] [Review][Patch] `download_video` trả UUID thay vì YouTube video ID thực — `video_id` return là random UUID, không trace được về video gốc. Cần extract ID từ yt-dlp info trước khi download. [`youtube.py:download_video`] **FIXED**
- [x] [Review][Patch] `_normalize_channel_url` thiếu `youtube.com/channel/UCxxx` format — legacy channel URLs không được thêm `/shorts`, sẽ fetch tất cả videos kể cả long-form. [`youtube.py:_normalize_channel_url`] **FIXED**

#### Defer (pre-existing / low-risk / out-of-scope)

- [x] [Review][Defer] `DOWNLOAD_DIR` module-level constant stale trong tests — `settings.DOWNLOAD_DIR` evaluated lúc import, test overrides không phản ánh. [`youtube.py:34`] — deferred, cùng pattern với `ytdlp_crawler.py` hiện tại, fix trong Epic 14 cleanup
- [x] [Review][Defer] `factory.get_scraper()` không defensive với `source_url=None` — `urlparse(None)` raises TypeError. [`factory.py:_is_youtube_url`] — deferred, caller `campaign_jobs` luôn pass string từ DB, low risk
- [x] [Review][Defer] `YT_MAX_VIDEOS` env var không validate kiểu — non-integer string raise ValueError lúc build opts. [`youtube.py:extract_metadata:opts`] — deferred, ops-level concern, document trong deployment guide
