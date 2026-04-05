# Story 9.1: Chấm Điểm Chất Lượng Video Tự Động (Quality Score Filter)

Status: ready-for-dev

## Story

As a Campaign Manager,
I want to thiết lập ngưỡng tối thiểu về views/likes cho video được phép tải về,
so that chỉ những video viral/trending mới được đăng lên fanpage, tránh content rác.

## Bối Cảnh & Lý Do

### Phụ thuộc
- **KHÔNG có phụ thuộc cứng** — Story này có thể implement độc lập
- Tuy nhiên, Epic 7 (Token Lifecycle) và Epic 6 (Apify) nên hoàn thành trước theo roadmap

### Vấn đề cần giải quyết
- Hiện tại `sync_campaign_content()` tải TẤT CẢ video từ source → nhiều video view thấp, chất lượng kém
- Admin phải review và xóa video rác thủ công trên Dashboard
- Cần filter tự động ngay tại thời điểm sync để chỉ tải video đạt chất lượng

### Điểm quan trọng — Apify stats data
- **`extract_metadata_apify()` hiện tại DROP hết stats** (views, likes, shares) — chỉ trả `id`, `webpage_url`, `title`, `description`, `_apify_download_url`
- Apify actors (clockworks + kingscraper) CÓ trả stats trong response items
- Story này PHẢI bổ sung stats vào entry dict trước khi filter có thể hoạt động
- **yt-dlp** cũng trả `view_count`, `like_count` trong `extract_info()` — đã có sẵn

### Architecture Decision
Architecture D4 quy định **Chain of Responsibility pattern** cho content filtering. Story 9.1 implement filter đầu tiên (`QualityFilter`), đặt nền tảng cho Stories 9.2 (KeywordFilter) và 9.3 (CrossCampaignDedup).

## Acceptance Criteria

### AC1: Schema mở rộng Campaign — quality filter fields
**Given** Alembic migration chạy thành công
**When** hệ thống khởi động
**Then** bảng `campaigns` có thêm 2 columns mới:
- `filter_min_views`: Integer DEFAULT 0 (0 = không lọc)
- `filter_min_likes`: Integer DEFAULT 0 (0 = không lọc)
**And** tất cả campaigns hiện tại KHÔNG bị ảnh hưởng (default 0 = cho qua tất cả)

### AC2: Apify entries trả về stats data
**Given** `extract_metadata_apify()` xử lý response từ Apify actor
**When** trả về entries list
**Then** mỗi entry dict có thêm:
- `view_count`: int (từ `playCount` hoặc `videoMeta.playCount`)
- `like_count`: int (từ `diggCount` hoặc `videoMeta.diggCount`)
- `share_count`: int (từ `shareCount` hoặc `videoMeta.shareCount`)
- `comment_count`: int (từ `commentCount` hoặc `videoMeta.commentCount`)
**And** default 0 nếu field không có trong Apify response

### AC3: Content filter service — QualityFilter
**Given** `content_filter.py` với `ContentFilter` Protocol và `QualityFilter` class
**When** `QualityFilter.apply(entry, campaign)` được gọi
**Then** so sánh `entry["view_count"]` >= `campaign.filter_min_views` AND `entry["like_count"]` >= `campaign.filter_min_likes`
**And** trả `FilterResult(accepted=True)` nếu đạt cả hai ngưỡng
**And** trả `FilterResult(accepted=False, reason="min_views_not_met")` nếu views không đạt
**And** trả `FilterResult(accepted=False, reason="min_likes_not_met")` nếu likes không đạt
**And** nếu `filter_min_views = 0 AND filter_min_likes = 0` → luôn accepted (bypass filter)

### AC4: Tích hợp filter vào sync_campaign_content
**Given** `sync_campaign_content()` đang xử lý entries
**When** mỗi entry được iterate (trước khi tạo Video record)
**Then** chạy entry qua filter pipeline (hiện tại chỉ có QualityFilter)
**And** nếu entry bị filter → skip (không tạo DB record, không download)
**And** ghi log `record_event("filter", "info", "Video bị lọc: {reason}")` với details entry ID
**And** cuối sync → report tổng số filtered vs added trong event details

### AC5: API + UI cho phép cấu hình ngưỡng per campaign
**Given** Admin tạo hoặc sửa campaign
**When** gọi `POST /campaigns/` hoặc `PATCH /campaigns/{id}`
**Then** hỗ trợ fields: `filter_min_views` (int, >= 0), `filter_min_likes` (int, >= 0)
**And** `GET /campaigns/` response có thêm 2 fields trong mỗi campaign object
**And** Frontend hiển thị 2 input fields: "Lượt xem tối thiểu" + "Lượt thích tối thiểu" trên form tạo/sửa campaign

## Tasks / Subtasks

- [ ] Task 1: Alembic migration — thêm filter fields vào `campaigns` (AC: #1)
  - [ ] 1.1: Thêm `filter_min_views` (Integer, default=0), `filter_min_likes` (Integer, default=0) vào `Campaign` model trong `models.py`
  - [ ] 1.2: Tạo Alembic migration file
  - [ ] 1.3: Test migration up/down — existing campaigns không bị ảnh hưởng

- [ ] Task 2: Bổ sung stats vào Apify entry response (AC: #2)
  - [ ] 2.1: Mở rộng `extract_metadata_apify()` trong `apify_crawler.py` — thêm `view_count`, `like_count`, `share_count`, `comment_count` vào entry dict
  - [ ] 2.2: Map fields từ clockworks format: `item.get("playCount")` hoặc `(item.get("videoMeta") or {}).get("playCount", 0)`
  - [ ] 2.3: Map fields từ kingscraper format: `item.get("playCount", 0)` (same field names)
  - [ ] 2.4: Default 0 cho missing fields

- [ ] Task 3: Content filter service (AC: #3)
  - [ ] 3.1: Tạo `backend/app/services/content_filter.py`
  - [ ] 3.2: Implement `ContentFilter` Protocol với method `apply(entry: dict, campaign: Campaign) -> FilterResult`
  - [ ] 3.3: Implement `FilterResult` dataclass: `accepted: bool`, `reason: str | None`
  - [ ] 3.4: Implement `QualityFilter` class
  - [ ] 3.5: Implement `run_filters(entry: dict, campaign: Campaign, filters: list[ContentFilter]) -> FilterResult` helper

- [ ] Task 4: Tích hợp filter vào sync flow (AC: #4)
  - [ ] 4.1: Import `content_filter` vào `campaign_jobs.py`
  - [ ] 4.2: Thêm filter check SAU dedup check (line ~178) nhưng TRƯỚC `db_video = Video(...)` (line ~185)
  - [ ] 4.3: Track `filtered_count` và report trong sync completion event
  - [ ] 4.4: Truyền stats data từ entry vào filter (entry dict đã có từ Task 2)

- [ ] Task 5: API + Frontend (AC: #5)
  - [ ] 5.1: Mở rộng `CampaignCreate` Pydantic model — thêm `filter_min_views: int = 0`, `filter_min_likes: int = 0`
  - [ ] 5.2: Mở rộng `POST /campaigns/` — lưu filter fields
  - [ ] 5.3: Thêm `PATCH /campaigns/{id}` endpoint (nếu chưa có) hoặc mở rộng — update filter fields
  - [ ] 5.4: Mở rộng `serialize_campaign()` — thêm filter fields vào response
  - [ ] 5.5: Frontend `App.jsx` — thêm 2 input fields vào campaign create/edit form

- [ ] Task 6: Unit tests (AC: #1-5)
  - [ ] 6.1: Test `QualityFilter.apply()` — accepted khi đạt ngưỡng, rejected khi không đạt
  - [ ] 6.2: Test `QualityFilter` bypass khi min_views=0 AND min_likes=0
  - [ ] 6.3: Test `run_filters()` chain — multiple filters, stop on first reject
  - [ ] 6.4: Test Apify entry stats mapping — clockworks format + kingscraper format
  - [ ] 6.5: Test `sync_campaign_content` integration — video bị filter → không tạo DB record
  - [ ] 6.6: Test API — create campaign với filter fields, verify response

## Dev Notes

### Apify Actor Stats Fields Reference

**clockworks/tiktok-scraper** trả về:
```json
{
  "id": "7123456789",
  "text": "Video description...",
  "playCount": 1500000,
  "diggCount": 85000,
  "shareCount": 12000,
  "commentCount": 3200,
  "videoMeta": {
    "playCount": 1500000,
    "diggCount": 85000,
    "shareCount": 12000,
    "commentCount": 3200
  },
  "authorMeta": { "name": "username" },
  "mediaUrls": ["https://..."],
  "webVideoUrl": "https://www.tiktok.com/@user/video/123"
}
```

**kingscraper** trả về:
```json
{
  "id": "7123456789",
  "description": "Video description...",
  "playCount": 1500000,
  "diggCount": 85000,
  "shareCount": 12000,
  "commentCount": 3200,
  "noWatermarkHdUrl": "https://..."
}
```

Cả hai actors dùng **cùng field names** cho stats: `playCount`, `diggCount`, `shareCount`, `commentCount`. clockworks thêm `videoMeta` object nhưng top-level fields cũng có.

### Điểm chèn trong `apify_crawler.py` — extract_metadata_apify()

```python
# Dòng 152-158 hiện tại — THÊM stats vào entry dict:
entries.append({
    "id": video_id,
    "webpage_url": webpage_url,
    "title": description,
    "description": description,
    "_apify_download_url": download_url,
    # THÊM MỚI:
    "view_count": int(item.get("playCount") or (item.get("videoMeta") or {}).get("playCount") or 0),
    "like_count": int(item.get("diggCount") or (item.get("videoMeta") or {}).get("diggCount") or 0),
    "share_count": int(item.get("shareCount") or (item.get("videoMeta") or {}).get("shareCount") or 0),
    "comment_count": int(item.get("commentCount") or (item.get("videoMeta") or {}).get("commentCount") or 0),
})
```

### Content Filter Service — `content_filter.py`

```python
from __future__ import annotations
from dataclasses import dataclass
from typing import Protocol

from app.models.models import Campaign


@dataclass
class FilterResult:
    accepted: bool
    reason: str | None = None


class ContentFilter(Protocol):
    def apply(self, entry: dict, campaign: Campaign) -> FilterResult: ...


class QualityFilter:
    def apply(self, entry: dict, campaign: Campaign) -> FilterResult:
        min_views = campaign.filter_min_views or 0
        min_likes = campaign.filter_min_likes or 0

        if min_views == 0 and min_likes == 0:
            return FilterResult(accepted=True)

        views = entry.get("view_count", 0)
        likes = entry.get("like_count", 0)

        if min_views > 0 and views < min_views:
            return FilterResult(accepted=False, reason=f"min_views_not_met:{views}<{min_views}")
        if min_likes > 0 and likes < min_likes:
            return FilterResult(accepted=False, reason=f"min_likes_not_met:{likes}<{min_likes}")

        return FilterResult(accepted=True)


def run_filters(entry: dict, campaign: Campaign, filters: list[ContentFilter]) -> FilterResult:
    for f in filters:
        result = f.apply(entry, campaign)
        if not result.accepted:
            return result
    return FilterResult(accepted=True)
```

### Điểm chèn trong `campaign_jobs.py` — sync_campaign_content()

```python
# HIỆN TẠI (line ~172-194):
existing_vid = db.query(Video).filter(...).first()
if existing_vid:
    continue

# === THÊM FILTER Ở ĐÂY ===
from app.services.content_filter import QualityFilter, run_filters
filters = [QualityFilter()]
filter_result = run_filters(entry, campaign, filters)
if not filter_result.accepted:
    filtered_count += 1
    record_event("filter", "info", f"Video bị lọc: {filter_result.reason}",
        db=db, details={"campaign_id": campaign_id, "video_id": original_id,
                        "view_count": entry.get("view_count", 0),
                        "like_count": entry.get("like_count", 0)})
    continue
# === END FILTER ===

publish_time = start_time + ...
db_video = Video(...)
```

**QUAN TRỌNG:** Import `filters` list một lần trước loop, không import trong loop.

### Campaign API Mở Rộng

```python
# CampaignCreate model — thêm fields:
class CampaignCreate(BaseModel):
    name: str
    source_url: str
    auto_post: bool = False
    target_page_id: str | None = None
    schedule_interval: int = Field(default=0, ge=0)
    # THÊM MỚI:
    filter_min_views: int = Field(default=0, ge=0)
    filter_min_likes: int = Field(default=0, ge=0)

# serialize_campaign — thêm vào return dict:
"filter_min_views": campaign.filter_min_views or 0,
"filter_min_likes": campaign.filter_min_likes or 0,
```

### Frontend — Campaign Form Fields

```jsx
// Thêm vào campaign create/edit form trong App.jsx:
<label className="text-xs text-gray-400">Lượt xem tối thiểu</label>
<input
  type="number"
  min="0"
  className={FIELD_CLASS}
  value={filterMinViews}
  onChange={e => setFilterMinViews(parseInt(e.target.value) || 0)}
  placeholder="0 = không lọc"
/>
<label className="text-xs text-gray-400">Lượt thích tối thiểu</label>
<input
  type="number"
  min="0"
  className={FIELD_CLASS}
  value={filterMinLikes}
  onChange={e => setFilterMinLikes(parseInt(e.target.value) || 0)}
  placeholder="0 = không lọc"
/>
```

### yt-dlp Stats Compatibility

yt-dlp `extract_info()` (fallback crawler) đã trả `view_count`, `like_count` trong info dict. `extract_metadata()` trong `tiktok_crawler.py` cũng cần đảm bảo truyền qua stats (kiểm tra file trước khi code).

### Project Structure Notes

**Files mới:**
- `backend/app/services/content_filter.py` — ContentFilter Protocol + QualityFilter class
- `backend/alembic/versions/xxxx_add_campaign_filter_fields.py` — Migration
- `backend/tests/test_content_filter.py` — Unit tests

**Files sửa:**
- `backend/app/models/models.py` — Thêm `filter_min_views`, `filter_min_likes` vào `Campaign`
- `backend/app/services/apify_crawler.py` — Thêm stats fields vào entry dict (dòng ~152)
- `backend/app/services/campaign_jobs.py` — Thêm filter check trong `sync_campaign_content()` (dòng ~178)
- `backend/app/api/campaigns.py` — Mở rộng `CampaignCreate`, `serialize_campaign()`, thêm PATCH endpoint
- `frontend/src/App.jsx` — Thêm filter input fields vào campaign form

**KHÔNG SỬA:**
- `cron.py`, `facebook.py`, `security.py`, `fb_graph.py` — không liên quan
- `token_lifecycle.py` — Epic 7 scope

### Edge Cases & Error Handling

1. **Entry không có stats (yt-dlp fallback):** `entry.get("view_count", 0)` → default 0 → nếu `filter_min_views > 0` → bị filter. Đây là hành vi đúng — nếu không biết views thì không nên download
2. **filter_min_views = 0:** Bypass filter hoàn toàn — tương thích ngược với tất cả campaigns hiện tại
3. **Apify actor trả stats dạng string:** `int(item.get("playCount") or 0)` — cast an toàn
4. **Campaign update giữa sync:** `db.expire_all()` đã có (line 156) → filter values sẽ được refresh
5. **Large entry set:** Filter chạy in-memory, không query DB → performance OK
6. **Sync report:** Thêm `filtered_count` vào completion event details

### Anti-Patterns to Avoid

- **KHÔNG** lưu stats vào `Video` model — Story 9.1 chỉ filter, không persist stats (Stories sau có thể thêm)
- **KHÔNG** tạo endpoint riêng cho filter config — dùng chung `POST /campaigns/` và serialize trong `GET /campaigns/`
- **KHÔNG** filter video đã có trong DB — chỉ filter entries MỚI trong sync flow
- **KHÔNG** instantiate filters mới trong mỗi iteration — tạo list một lần trước loop
- **KHÔNG** ghi event cho TỪNG video bị filter (sẽ spam) — ghi summary 1 event cuối sync với `filtered_count`
- **KHÔNG** modify `extract_metadata()` trong `tiktok_crawler.py` — file đó là yt-dlp wrapper, yt-dlp đã trả stats

### References

- [Source: architecture.md#D4: Content Pipeline Architecture]
- [Source: epics.md#Epic 9, Story 9.1]
- [Source: backend/app/services/apify_crawler.py — extract_metadata_apify(), dòng 93-160]
- [Source: backend/app/services/campaign_jobs.py — sync_campaign_content(), dòng 122-246]
- [Source: backend/app/api/campaigns.py — CampaignCreate, serialize_campaign()]
- [Source: backend/app/models/models.py — Campaign model]
- [Source: Apify clockworks/tiktok-scraper docs — playCount, diggCount fields]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### Change Log

### File List
