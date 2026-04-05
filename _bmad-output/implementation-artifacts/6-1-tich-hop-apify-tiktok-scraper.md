# Story 6.1: Tích Hợp Apify TikTok Scraper Thay Thế yt-dlp

Status: review

## Story

As an Admin,
I want to hệ thống sử dụng Apify TikTok Scraper để tải video thay vì yt-dlp,
so that việc crawl TikTok không còn bị block IP (datacenter lẫn residential) và hoạt động ổn định 24/7.

## Bối Cảnh & Lý Do

### Vấn đề hiện tại
- yt-dlp bị TikTok block IP ở tầng network — cả local IP lẫn datacenter proxy (`192.147.178.121`) đều trả lỗi "Your IP address is blocked"
- `extract_flat=True` vẫn lấy được danh sách URLs (884 videos từ `@tiktok`), nhưng khi download từng video → block
- curl_cffi impersonation + cookies không bypass được IP-level block
- Cần giải pháp bên thứ 3 handle anti-bot thay mình

### Giải pháp chọn: Apify
- **Actor**: `kingscraper/tiktok-video-and-thumbnail-downloader` — HD, no watermark, batch processing
- **Lý do chọn**: Apify tự quản lý residential proxy pool, anti-bot, browser fingerprinting. Không cần mua proxy riêng
- **Chi phí**: Free tier $5/tháng (~17K video metadata), Starter $49/tháng (dư sức 50-100 video/ngày)
- **Backup**: Giữ yt-dlp làm fallback cho non-TikTok sources hoặc khi Apify unavailable

## Acceptance Criteria

### AC1: Apify client tích hợp vào backend
**Given** biến `APIFY_API_TOKEN` được cấu hình trong `.env`
**When** hệ thống cần crawl video TikTok
**Then** sử dụng `apify-client` Python SDK gọi actor `kingscraper/tiktok-video-and-thumbnail-downloader`
**And** trả về danh sách video URLs (HD, no watermark) + metadata (title, description, views, likes)

### AC2: Download video từ Apify result URLs
**Given** Apify actor trả về `noWatermarkHdUrl` cho mỗi video
**When** worker xử lý campaign sync
**Then** download file MP4 từ URL trực tiếp vào `DOWNLOAD_DIR`
**And** lưu metadata (original_caption, original_id) vào DB đúng schema Video hiện tại

### AC3: Fallback về yt-dlp khi Apify fail
**Given** Apify actor gặp lỗi (timeout, quota hết, API down)
**When** download thất bại qua Apify
**Then** tự động retry bằng yt-dlp (giữ nguyên logic hiện tại với proxy + impersonation)
**And** ghi log rõ ràng nguồn download (apify vs yt-dlp) vào event system

### AC4: Cấu hình Apify qua environment variables
**Given** admin cấu hình hệ thống
**When** thiết lập Apify integration
**Then** hỗ trợ các biến: `APIFY_API_TOKEN`, `APIFY_ACTOR_ID` (default: `kingscraper/tiktok-video-and-thumbnail-downloader`), `TIKTOK_CRAWLER_MODE` (apify | ytdlp | auto)
**And** `auto` mode = thử Apify trước, fallback yt-dlp

### AC5: Campaign sync tương thích ngược
**Given** campaign sync flow hiện tại (`sync_campaign_content()`)
**When** chuyển sang Apify backend
**Then** không thay đổi API contract — frontend, worker cron, task queue đều hoạt động bình thường
**And** Video records được tạo với cùng schema (campaign_id, original_id, source_video_url, original_caption, status, file_path)

## Tasks / Subtasks

- [x] Task 1: Thêm `apify-client` vào `requirements.txt` (AC: #4)
  - [x] 1.1: `pip install apify-client` và pin version (apify-client==2.5.0)
  - [x] 1.2: Thêm config vars vào `Settings` class trong `config.py`

- [x] Task 2: Tạo module `backend/app/services/apify_crawler.py` (AC: #1, #2)
  - [x] 2.1: `extract_metadata_apify(source_url)` — gọi Apify actor, parse results
  - [x] 2.2: `download_video_apify(video_url, filename_prefix)` — download từ Apify HD URL
  - [x] 2.3: Handle Apify actor run (start → wait → get dataset items)

- [x] Task 3: Tạo module `backend/app/services/tiktok_crawler.py` — unified interface (AC: #3, #4)
  - [x] 3.1: `extract_metadata(source_url)` — router dựa trên `TIKTOK_CRAWLER_MODE`
  - [x] 3.2: `download_video(url, prefix)` — router với fallback logic
  - [x] 3.3: Logging nguồn download (apify/yt-dlp) vào observability

- [x] Task 4: Update `campaign_jobs.py` import (AC: #5)
  - [x] 4.1: Thay `from app.services.ytdlp_crawler import ...` → `from app.services.tiktok_crawler import ...`
  - [x] 4.2: Truyền `_apify_download_url` (CDN URL) thay `webpage_url` vào `download_video()`

- [x] Task 5: Update `.env` với Apify config vars (AC: #4)
  - [x] 5.1: Thêm `APIFY_API_TOKEN=`, `APIFY_ACTOR_ID=`, `TIKTOK_CRAWLER_MODE=auto`

- [x] Task 6: Test integration (AC: #1-5)
  - [x] 6.1: 17 unit tests cho `apify_crawler.py` và `tiktok_crawler.py` với mock Apify client — tất cả pass
  - [x] 6.2: Tests cover AC1-5: extract metadata, download, fallback, config, backward compat
  - [x] 6.3: Full regression suite 23 tests pass (không có breaking changes)

## Dev Notes

### Kiến trúc hiện tại cần hiểu

**File chính cần sửa/tạo:**
```
backend/
├── app/
│   ├── core/
│   │   └── config.py          # ← Thêm APIFY_API_TOKEN, APIFY_ACTOR_ID, TIKTOK_CRAWLER_MODE
│   ├── services/
│   │   ├── ytdlp_crawler.py   # ← GIỮ NGUYÊN (fallback)
│   │   ├── apify_crawler.py   # ← TẠO MỚI
│   │   ├── tiktok_crawler.py  # ← TẠO MỚI (unified interface)
│   │   └── campaign_jobs.py   # ← Update imports
│   └── worker/
│       └── cron.py            # Không cần sửa (dùng campaign_jobs)
├── requirements.txt           # ← Thêm apify-client
└── .env                       # ← Thêm APIFY vars
```

### Apify Actor: `kingscraper/tiktok-video-and-thumbnail-downloader`

**Input schema:**
```python
run_input = {
    "videoUrls": [
        "https://www.tiktok.com/@user/video/123456789"
    ]
}
```

**Output schema (mỗi item trong dataset):**
```json
{
    "id": "7388143856528467205",
    "noWatermarkHdUrl": "https://...",
    "noWatermarkSdUrl": "https://...",
    "watermarkUrl": "https://...",
    "thumbnailUrl": "https://...",
    "description": "Video caption text #hashtag",
    "author": {"name": "username", "profile": "https://..."},
    "views": 1000000,
    "likes": 50000,
    "comments": 1200,
    "shares": 5000,
    "duration": 30,
    "uploadTime": "2026-01-15T10:00:00Z"
}
```

**Python SDK usage:**
```python
from apify_client import ApifyClient

client = ApifyClient(os.getenv("APIFY_API_TOKEN"))
run_input = {"videoUrls": ["https://www.tiktok.com/@user/video/123"]}
run = client.actor("kingscraper/tiktok-video-and-thumbnail-downloader").call(run_input=run_input)
items = client.dataset(run["defaultDatasetId"]).list_items().items
# items[0]["noWatermarkHdUrl"] → direct MP4 download URL
```

### Mapping Apify output → Video model hiện tại

| Apify field | Video model field | Ghi chú |
|---|---|---|
| `id` | `original_id` | TikTok video ID |
| `noWatermarkHdUrl` | `source_video_url` | URL để download |
| `description` | `original_caption` | Caption gốc |
| downloaded file path | `file_path` | Sau khi download MP4 |
| — | `status` | `downloading` → `ready` / `failed` |

### Cảnh báo quan trọng cho Dev Agent

1. **KHÔNG sửa `ytdlp_crawler.py`** — giữ nguyên làm fallback
2. **KHÔNG thay đổi Video model/schema** — Apify data phải map vào model hiện tại
3. **KHÔNG thay đổi API endpoints** — campaign sync API giữ nguyên contract
4. **`tiktok_crawler.py` là facade pattern** — route giữa apify và yt-dlp dựa trên config
5. **Apify actor chạy synchronous** (`.call()` blocks) — OK cho worker thread nhưng thêm timeout
6. **Download video từ Apify URL** dùng `requests.get(url, stream=True)` — không cần proxy vì URL là CDN trực tiếp
7. **Profile/channel URL extraction**: Khi source_url là profile (e.g. `@tiktok`), cần extract video list trước rồi batch gọi Apify cho từng video. Apify actor nhận `videoUrls` array nên có thể batch.

### Xử lý profile URL vs single video URL

```python
# Nếu source_url là profile: dùng yt-dlp extract_flat=True lấy danh sách URLs
# (extract_flat không bị block vì chỉ lấy metadata nhẹ)
# Rồi batch gửi video URLs cho Apify download

# Nếu source_url là single video: gửi thẳng cho Apify
```

### Config vars mới trong Settings class

```python
APIFY_API_TOKEN: str = os.getenv("APIFY_API_TOKEN", "")
APIFY_ACTOR_ID: str = os.getenv("APIFY_ACTOR_ID", "kingscraper/tiktok-video-and-thumbnail-downloader")
TIKTOK_CRAWLER_MODE: str = os.getenv("TIKTOK_CRAWLER_MODE", "auto")  # apify | ytdlp | auto
```

### Pattern từ codebase hiện tại cần tuân thủ

- `from __future__ import annotations` ở đầu mọi file Python (Python 3.9 compat, dù đã upgrade 3.12)
- `record_event()` cho logging vào observability system
- Error handling: set `video.status = VideoStatus.failed`, `video.last_error = str(exc)`
- Download dir: `settings.DOWNLOAD_DIR`, tạo dir với `Path().mkdir(parents=True, exist_ok=True)`
- Video filename: `{prefix}_{uuid4()}.mp4`

### Dependencies

- `apify-client` — Apify Python SDK ([PyPI](https://pypi.org/project/apify-client/))
- `requests` — đã có trong requirements.txt (dùng để download video từ Apify URLs)

### Project Structure Notes

- Tạo file mới trong `backend/app/services/` — đúng vị trí cho business logic
- `tiktok_crawler.py` làm unified interface thay cho import trực tiếp `ytdlp_crawler`
- Giữ backward compatibility: nếu `APIFY_API_TOKEN` rỗng → tự động fallback yt-dlp

### References

- [Source: backend/app/services/ytdlp_crawler.py] — Logic crawl hiện tại, pattern download_video()
- [Source: backend/app/services/campaign_jobs.py#sync_campaign_content] — Consumer chính, import extract_metadata + download_video
- [Source: backend/app/core/config.py#Settings] — Class config, thêm vars mới ở đây
- [Source: backend/app/models/models.py#Video] — Video model schema cần map data vào
- [Source: backend/app/services/observability.py#record_event] — Logging system
- [Apify Actor](https://apify.com/kingscraper/tiktok-video-and-thumbnail-downloader/api/python) — API docs + Python SDK
- [Apify Python Client](https://pypi.org/project/apify-client/) — SDK PyPI page

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- ✅ AC1: `apify_crawler.extract_metadata_apify()` gọi actor `kingscraper/tiktok-video-and-thumbnail-downloader`, trả về entries với `_apify_download_url`
- ✅ AC2: `apify_crawler.download_video_apify()` stream MP4 từ CDN URL qua `requests.get(..., stream=True)` — không cần proxy
- ✅ AC3: `tiktok_crawler.py` facade pattern: auto mode thử Apify trước, fallback yt-dlp khi Apify fail hoặc token rỗng
- ✅ AC4: `Settings` class có 3 biến mới: `APIFY_API_TOKEN`, `APIFY_ACTOR_ID`, `TIKTOK_CRAWLER_MODE=auto`
- ✅ AC5: `campaign_jobs.py` chỉ đổi 1 dòng import + 1 dòng dùng `download_url` thay `video_url`. Contract giữ nguyên hoàn toàn.
- ✅ Profile URL detection: `_is_profile_url()` kiểm tra `/video/` trong URL; profile dùng yt-dlp `extract_flat=True` để lấy danh sách, sau đó Apify batch download
- ✅ 17 unit tests mới, 23 tests total pass — zero regression

### File List

- `backend/requirements.txt` — thêm `apify-client==2.5.0`
- `backend/app/core/config.py` — thêm `APIFY_API_TOKEN`, `APIFY_ACTOR_ID`, `TIKTOK_CRAWLER_MODE`
- `backend/app/services/apify_crawler.py` — tạo mới (extract_metadata_apify, download_video_apify)
- `backend/app/services/tiktok_crawler.py` — tạo mới (unified facade: extract_metadata, download_video)
- `backend/app/services/campaign_jobs.py` — đổi import + dùng `download_url`
- `backend/.env` — thêm Apify config vars (không commit)
- `backend/tests/test_apify_crawler.py` — tạo mới (17 unit tests)
