# Story 11.1: Thu Thập Engagement Metrics (Metrics Collector)

## 1. Story Foundation (Requirements)

**User Story:**
As a Background Worker,
I want to định kỳ fetch metrics engagement từ Facebook Graph API cho mỗi video đã đăng,
So that có dữ liệu thực tế để đánh giá hiệu quả nội dung.

**Acceptance Criteria:**
- **Given** Dữ liệu bản ghi Video có trạng thái `posted` hoặc `published` và có `fb_post_id` hợp lệ
- **When** Metrics collector job (cron job) chạy mỗi 6 giờ trên APScheduler
- **Then** Job gọi Graph API `/{fb_post_id}?fields=likes.summary(true),comments.summary(true),shares,video_insights`
- **And** lưu metrics vào bảng database `video_metrics` (bao gồm: views, likes, comments, shares, reach) với cột timestamp `fetched_at`
- **And** hệ thống giới hạn an toàn max 200 API calls/giờ để bảo vệ tài nguyên Rate limit của Facebook.

## 2. Developer Context (Guardrails)

### Technical Requirements
- Tạo mới model/schema database `VideoMetrics`:
  - `id: UUID PK` 
  - `video_id: UUID FK -> videos.id`
  - `fb_post_id: String INDEX`
  - `views: Integer DEFAULT 0`
  - `likes: Integer DEFAULT 0`
  - `comments: Integer DEFAULT 0`
  - `shares: Integer DEFAULT 0`
  - `reach: Integer DEFAULT 0`
  - `fetched_at: DateTime`
  - `created_at: DateTime`
  - Khuyến nghị đánh INDEX combo: `(video_id, fetched_at)` phục vụ query chuỗi thời gian (time-series).
- Lớp Backend Worker: Xây dựng service scraper logic trong `metrics_collector.py`, chạy dưới background.
  - Job phải chạy mỗi 6h. 
  - Upsert hoặc Append liên tục dữ liệu vào `video_metrics` chứ **không ghi đè (không overwrite)** để lấy history time-series.
  - Thực hiện Batch calls thay vì single call nếu có thể (nhưng giới hạn batch tối đa của meta áp dụng). Phải có Time Sleep hoặc Backoff Token Bucket nếu số video cực lớn, đảm bảo max 200 reqs / hour.

### Architecture Compliance
- Sử dụng **Alembic migration** tạo bảng mới. Cấm dùng `Base.metadata.create_all()`.
- Error Handling: Nếu Meta trả lỗi token expire trong tiến trình này, bubble up lỗi và tắt cron fetching cho Page bị lỗi, lưu log `RATE_LIMITED` / `AUTH_FAILED` thay vì ném App Crash. Đi kèm Tenacity backoff wrapper.
- Nơi cấu hình Scheduler: Phải tách bạch tại thẻ khởi chạy cron/scheduler hiện có của Phase 1 thay vì chạy `asyncio.sleep` hoang dã.
- Tên bảng: `video_metrics`. Tên API call trong code dùng `snake_case`.

### File Structure Impacts
- `backend/alembic/versions/` => Thêm script để create table `video_metrics`.
- `backend/app/models/models.py` (hoặc `metrics.py`) => Declare `VideoMetrics` SQLAlchemy instance.
- `backend/app/services/metrics_collector.py` => Xây dựng file Service quản lý call Facebook.
- `backend/app/worker/cron.py` (hoặc module tương đương do Epic APScheduler define) => Thêm `metrics_job`.

## 3. Latest Tech Specifics
- Đối với Facebook Graph API, `video_insights` thay đổi tên parameter đôi lần qua các version v18-v20. Luôn chắc chắn đọc giá trị reach thông qua `post_video_views` hoặc `post_impressions_unique`. Gốc call lấy metrics likes/comments chuẩn là `/{fb_post_id}?fields=likes.summary(true),comments.summary(true),shares`.

## 4. Status
Status: `done`

## 5. Tasks / Subtasks

- [x] Task 1: Database Model & Schema
  - [x] 1.1: Tạo model `VideoMetrics` trong `backend/app/models/models.py`.
  - [x] 1.2: Viết script Alembic migration cho bảng `video_metrics`.
- [x] Task 2: Xây dựng Metrics Collector Service
  - [x] 2.1: Tạo `backend/app/services/metrics_collector.py` để gọi FB Graph API lấy metrics.
  - [x] 2.2: Implement logic rate limit (max 200 calls/hour) và lưu history time-series.
- [x] Task 3: Tích hợp Cron Job
  - [x] 3.1: Đăng ký `metrics_job` vào APScheduler trong `backend/app/worker/cron.py` chạy mỗi 6h.
- [x] Task 4: Kiểm thử
  - [x] 4.1: Thêm unit tests cho parser metrics và rate limiter.

## 6. Dev Agent Record
### Agent Model Used
Gemini 2.0 Flash

### Change Log
- 2026-05-03: Bắt đầu triển khai Story 11.1. Thêm tasks.

### Review Findings (2026-05-03)

- [x] [Review][Patch] Synchronous Thread Blocking (`time.sleep(18)`) blocks worker thread [backend/app/services/metrics_collector.py]
- [x] [Review][Patch] Missing Transaction Commit for System Events in job error handler [backend/app/worker/cron.py]
- [x] [Review][Patch] Missing Transaction Commit for Rate Limit error logging [backend/app/services/metrics_collector.py]
- [x] [Review][Patch] Integer Overflow Timebomb (`views`, `likes`, `reach` as `Integer` instead of `BigInteger`) [backend/app/models/models.py]
- [x] [Review][Patch] Useless tenacity retry for Facebook API RateLimitError [backend/app/services/metrics_collector.py]
- [x] [Review][Patch] Missing tests for parser logic and preventative rate limiter [backend/tests/test_metrics_collector.py]
- [x] [Review][Patch] Blind Exception Rollbacks affects shared session across pages [backend/app/services/metrics_collector.py]
- [x] [Review][Patch] Sloppy Chunk Iteration queries `None` key in response [backend/app/services/metrics_collector.py]
- [x] [Review][Patch] Inconsistent Timezone Handling (`fetched_at` vs `created_at`) [backend/app/models/models.py]
- [x] [Review][Patch] Unhandled ValueError if response is not valid JSON [backend/app/services/metrics_collector.py:27]
- [x] [Review][Patch] AttributeError if API returns error as string instead of object [backend/app/services/metrics_collector.py:30]
- [x] [Review][Patch] AttributeError if API returns explicit null for likes/comments/shares [backend/app/services/metrics_collector.py:86]
- [x] [Review][Patch] AttributeError if API returns explicit null for video_insights [backend/app/services/metrics_collector.py:90]
- [x] [Review][Patch] AttributeError if Insights values array contains null element [backend/app/services/metrics_collector.py:95]
- [x] [Review][Patch] Memory exhaustion if hundreds of thousands of videos exist [backend/app/worker/cron.py]
- [x] [Review][Patch] Deviation in Cron Job Naming (`scheduled_metrics_collection_job` instead of `metrics_job`) [backend/app/worker/cron.py]
- [x] [Review][Defer] Data Hoarding Without Pruning (inserts new row every 6 hours) [backend/app/models/models.py] — deferred, pre-existing
- [x] [Review][Defer] Job stalls on dead network [backend/app/services/metrics_collector.py:127] — deferred, pre-existing
