# Story 9.2: Bộ Lọc Hashtag & Từ Khóa (Content Filter Rules)

Status: ready-for-dev

## Story

As an Admin,
I want to khai báo danh sách hashtag/từ khóa cần chặn hoặc chỉ cho phép per campaign,
so that tránh đăng nội dung không phù hợp với thương hiệu hoặc vi phạm chính sách.

## Bối Cảnh & Lý Do

### Phụ thuộc
- **Story 9.1 PHẢI hoàn thành trước** — cần:
  - `content_filter.py` với `ContentFilter` Protocol, `FilterResult` dataclass, `run_filters()` helper
  - `QualityFilter` class (Story 9.2 thêm `KeywordFilter` vào cùng chain)
  - Filter pipeline đã integrated vào `sync_campaign_content()` trong `campaign_jobs.py`
  - `CampaignCreate` Pydantic model đã mở rộng với filter fields

### Vấn đề cần giải quyết
- Story 9.1 lọc theo số liệu (views/likes) nhưng KHÔNG lọc theo nội dung
- Video có content spam, từ khóa nhạy cảm, hoặc không phù hợp thương hiệu vẫn lọt qua
- Admin cần 2 cơ chế:
  - **Blocklist**: chặn video có chứa từ khóa/hashtag cấm (ví dụ: "casino", "18+", "#ad")
  - **Allowlist**: CHỈ cho phép video có chứa hashtag cụ thể (ví dụ: "#cooking", "#recipe") — allowlist rỗng = cho phép tất cả

### Architecture Decision
Architecture D4: Chain of Responsibility — `KeywordFilter` là filter thứ 2 trong pipeline:
```
QualityFilter → KeywordFilter → [CrossCampaignDedup (Story 9.3)]
```

## Acceptance Criteria

### AC1: Schema mở rộng Campaign — keyword filter fields
**Given** Alembic migration chạy thành công
**When** hệ thống khởi động
**Then** bảng `campaigns` có thêm 2 columns mới:
- `filter_blocklist_keywords`: JSON DEFAULT [] (array of strings, case-insensitive match)
- `filter_allowlist_hashtags`: JSON DEFAULT [] (array of strings, rỗng = cho phép tất cả)
**And** tất cả campaigns hiện tại KHÔNG bị ảnh hưởng (default [] = không lọc)

### AC2: KeywordFilter class trong content_filter.py
**Given** `KeywordFilter` class implement `ContentFilter` Protocol
**When** `KeywordFilter.apply(entry, campaign)` được gọi
**Then** kiểm tra `entry["description"]` (= `original_caption`) theo logic:

**Blocklist check:**
- Nếu `filter_blocklist_keywords` rỗng → skip blocklist check
- Nếu bất kỳ keyword nào trong blocklist xuất hiện trong caption (case-insensitive, substring match) → `FilterResult(accepted=False, reason="blocklist_match:{keyword}")`
- Match cả plain text VÀ hashtag format (ví dụ: "casino" match cả "casino" và "#casino")

**Allowlist check:**
- Nếu `filter_allowlist_hashtags` rỗng → skip allowlist check (cho phép tất cả)
- Nếu KHÔNG có bất kỳ hashtag nào trong allowlist xuất hiện trong caption → `FilterResult(accepted=False, reason="allowlist_no_match")`
- Match hashtag format: so sánh `#tag` trong caption với list (case-insensitive)

**Both pass:** → `FilterResult(accepted=True)`

### AC3: Tích hợp vào filter pipeline
**Given** `run_filters()` trong `campaign_jobs.py` đã chạy `QualityFilter` (từ Story 9.1)
**When** sync_campaign_content xử lý entries
**Then** pipeline chain = `[QualityFilter(), KeywordFilter()]`
**And** entries bị reject bởi KeywordFilter → skip, ghi vào filtered_count
**And** event log cuối sync report `filtered_count` bao gồm cả quality + keyword filters

### AC4: API + UI cho phép cấu hình keyword filters per campaign
**Given** Admin tạo hoặc sửa campaign
**When** gọi `POST /campaigns/` hoặc `PATCH /campaigns/{id}`
**Then** hỗ trợ fields:
- `filter_blocklist_keywords`: list[str] (optional, default [])
- `filter_allowlist_hashtags`: list[str] (optional, default [])
**And** `GET /campaigns/` response có thêm 2 fields trong mỗi campaign object
**And** Frontend hiển thị 2 textarea fields:
- "Từ khóa chặn (mỗi dòng 1 từ)" — textarea, parse by newline
- "Hashtag cho phép (mỗi dòng 1 hashtag)" — textarea, parse by newline
**And** hiển thị hint: "Để trống = không lọc"

### AC5: Sync report thống kê chi tiết
**Given** sync_campaign_content hoàn tất
**When** ghi completion event
**Then** details chứa: `videos_added`, `filtered_by_quality`, `filtered_by_keyword`, `filtered_total`
**And** nếu có video bị keyword filter → ghi 1 summary event "X video bị lọc bởi từ khóa" (không ghi từng video)

## Tasks / Subtasks

- [ ] Task 1: Alembic migration — thêm keyword filter fields vào `campaigns` (AC: #1)
  - [ ] 1.1: Thêm `filter_blocklist_keywords` (JSON, default=[]), `filter_allowlist_hashtags` (JSON, default=[]) vào `Campaign` model trong `models.py`
  - [ ] 1.2: Tạo Alembic migration file
  - [ ] 1.3: Test migration up/down — existing campaigns không bị ảnh hưởng

- [ ] Task 2: KeywordFilter class (AC: #2)
  - [ ] 2.1: Thêm `KeywordFilter` class vào `content_filter.py` (file đã có từ Story 9.1)
  - [ ] 2.2: Implement blocklist check — case-insensitive substring match trên `entry["description"]`
  - [ ] 2.3: Implement allowlist check — hashtag matching trên caption
  - [ ] 2.4: Helper `_extract_hashtags(text: str) -> set[str]` — extract tất cả #tags từ caption, lowercase

- [ ] Task 3: Tích hợp vào filter pipeline (AC: #3)
  - [ ] 3.1: Mở rộng filters list trong `campaign_jobs.py`: `[QualityFilter(), KeywordFilter()]`
  - [ ] 3.2: Track `filtered_by_quality` và `filtered_by_keyword` riêng biệt trong sync loop
  - [ ] 3.3: Report chi tiết trong completion event

- [ ] Task 4: API + Frontend (AC: #4, #5)
  - [ ] 4.1: Mở rộng `CampaignCreate` Pydantic model — thêm `filter_blocklist_keywords: list[str] = []`, `filter_allowlist_hashtags: list[str] = []`
  - [ ] 4.2: Mở rộng `POST /campaigns/` và `PATCH /campaigns/{id}` — lưu keyword filter fields
  - [ ] 4.3: Mở rộng `serialize_campaign()` — thêm 2 fields vào response
  - [ ] 4.4: Frontend `App.jsx` — thêm 2 textarea inputs vào campaign form, parse newline-separated

- [ ] Task 5: Unit tests (AC: #1-5)
  - [ ] 5.1: Test `KeywordFilter` blocklist — match keyword → rejected, no match → accepted
  - [ ] 5.2: Test `KeywordFilter` blocklist case-insensitive — "Casino" matches "casino"
  - [ ] 5.3: Test `KeywordFilter` allowlist — has matching hashtag → accepted, no match → rejected
  - [ ] 5.4: Test `KeywordFilter` allowlist rỗng → always accepted (bypass)
  - [ ] 5.5: Test `KeywordFilter` both blocklist + allowlist — blocklist checked FIRST
  - [ ] 5.6: Test `_extract_hashtags()` — "#food #cooking text #123" → {"#food", "#cooking", "#123"}
  - [ ] 5.7: Test full pipeline chain — QualityFilter + KeywordFilter together
  - [ ] 5.8: Test API — create campaign với keyword filter fields, verify response

## Dev Notes

### Story 9.1 đã tạo (dùng lại, KHÔNG tạo mới)

**`content_filter.py` — đã có:**
```python
from dataclasses import dataclass
from typing import Protocol

@dataclass
class FilterResult:
    accepted: bool
    reason: str | None = None

class ContentFilter(Protocol):
    def apply(self, entry: dict, campaign: Campaign) -> FilterResult: ...

class QualityFilter:
    def apply(self, entry: dict, campaign: Campaign) -> FilterResult: ...

def run_filters(entry: dict, campaign: Campaign, filters: list[ContentFilter]) -> FilterResult: ...
```

**`campaign_jobs.py` — filter đã integrated (dòng ~178):**
```python
filters = [QualityFilter()]  # ← THÊM KeywordFilter() vào đây
filter_result = run_filters(entry, campaign, filters)
if not filter_result.accepted:
    filtered_count += 1
    continue
```

### KeywordFilter Implementation

```python
import re

class KeywordFilter:
    def apply(self, entry: dict, campaign: Campaign) -> FilterResult:
        blocklist = campaign.filter_blocklist_keywords or []
        allowlist = campaign.filter_allowlist_hashtags or []

        if not blocklist and not allowlist:
            return FilterResult(accepted=True)

        caption = (entry.get("description") or entry.get("title") or "").lower()

        # Blocklist check FIRST
        for keyword in blocklist:
            if keyword.lower() in caption:
                return FilterResult(accepted=False, reason=f"blocklist_match:{keyword}")

        # Allowlist check (only if allowlist is non-empty)
        if allowlist:
            caption_hashtags = _extract_hashtags(caption)
            allowlist_normalized = {h.lower().lstrip("#") for h in allowlist}
            if not caption_hashtags.intersection(allowlist_normalized):
                return FilterResult(accepted=False, reason="allowlist_no_match")

        return FilterResult(accepted=True)


def _extract_hashtags(text: str) -> set[str]:
    """Extract tất cả hashtags từ text, trả về set lowercase không có #."""
    return {tag.lower() for tag in re.findall(r"#(\w+)", text)}
```

### Hashtag Matching Logic — Chi tiết

**Blocklist** dùng **substring match** (không chỉ hashtag):
- `"casino"` match: "I love casino games", "#casino", "casinoonline"
- Ưu tiên simplicity — Admin muốn chặn "casino" thì chặn hết mọi context

**Allowlist** dùng **hashtag match** (chỉ #tags):
- `"cooking"` match: "#cooking tips", "#COOKING"
- Allowlist normalize: strip `#` prefix nếu Admin nhập `#cooking` → lưu `"cooking"`
- So sánh: `_extract_hashtags(caption)` ∩ `allowlist_normalized` → phải có ít nhất 1 match

### Entry data flow

Entry dict từ Apify (Story 9.1 đã bổ sung):
```python
{
    "id": "7123456789",
    "webpage_url": "https://...",
    "title": "Video description with #hashtag",
    "description": "Video description with #hashtag",  # = original_caption
    "_apify_download_url": "https://...",
    "view_count": 1500000,   # Story 9.1
    "like_count": 85000,     # Story 9.1
}
```

`KeywordFilter` dùng `entry["description"]` — cùng field mà `campaign_jobs.py` lưu vào `Video.original_caption`.

### Campaign API Mở Rộng

```python
# CampaignCreate — Story 9.1 đã thêm filter_min_views/likes, Story 9.2 thêm:
class CampaignCreate(BaseModel):
    # ... existing fields ...
    filter_min_views: int = Field(default=0, ge=0)       # Story 9.1
    filter_min_likes: int = Field(default=0, ge=0)       # Story 9.1
    filter_blocklist_keywords: list[str] = []             # Story 9.2
    filter_allowlist_hashtags: list[str] = []             # Story 9.2

# serialize_campaign — thêm:
"filter_blocklist_keywords": campaign.filter_blocklist_keywords or [],
"filter_allowlist_hashtags": campaign.filter_allowlist_hashtags or [],
```

### Frontend — Textarea Pattern

```jsx
// Campaign form — thêm sau filter_min_views/likes inputs:
<label className="text-xs text-gray-400">Từ khóa chặn (mỗi dòng 1 từ)</label>
<textarea
  className={FIELD_CLASS}
  rows={3}
  value={(filterBlocklist || []).join('\n')}
  onChange={e => setFilterBlocklist(e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
  placeholder="casino&#10;18+&#10;spam"
/>
<span className="text-xs text-gray-500">Để trống = không chặn</span>

<label className="text-xs text-gray-400">Hashtag cho phép (mỗi dòng 1 hashtag)</label>
<textarea
  className={FIELD_CLASS}
  rows={3}
  value={(filterAllowlist || []).join('\n')}
  onChange={e => setFilterAllowlist(e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
  placeholder="cooking&#10;recipe&#10;food"
/>
<span className="text-xs text-gray-500">Để trống = cho phép tất cả</span>
```

### Sync Report Enhancement

```python
# Trong sync_campaign_content() — track chi tiết:
filtered_by_quality = 0
filtered_by_keyword = 0

for entry in entries:
    # ... dedup check ...
    filter_result = run_filters(entry, campaign, filters)
    if not filter_result.accepted:
        if filter_result.reason and filter_result.reason.startswith(("min_views", "min_likes")):
            filtered_by_quality += 1
        else:
            filtered_by_keyword += 1
        continue
    # ... create Video ...

# Completion event:
record_event("campaign", "info", "Đồng bộ chiến dịch hoàn tất.", db=db,
    details={
        "campaign_id": campaign_id,
        "videos_added": added_count,
        "filtered_by_quality": filtered_by_quality,
        "filtered_by_keyword": filtered_by_keyword,
        "filtered_total": filtered_by_quality + filtered_by_keyword,
    })
```

### JSON Column Pattern — SQLAlchemy

```python
# Campaign model — dùng JSON_TYPE đã define (line 12 models.py):
# JSON_TYPE = JSON().with_variant(JSONB, "postgresql")

filter_blocklist_keywords = Column(JSON_TYPE, default=list)
filter_allowlist_hashtags = Column(JSON_TYPE, default=list)
```

**QUAN TRỌNG:** Dùng `JSON_TYPE` (đã defined trong `models.py` line 12), KHÔNG import thêm JSON type.

### Project Structure Notes

**Files sửa (mở rộng từ Story 9.1):**
- `backend/app/models/models.py` — Thêm 2 JSON columns vào `Campaign`
- `backend/app/services/content_filter.py` — Thêm `KeywordFilter` class + `_extract_hashtags()` helper
- `backend/app/services/campaign_jobs.py` — Thêm `KeywordFilter()` vào filters list + detailed tracking
- `backend/app/api/campaigns.py` — Mở rộng `CampaignCreate`, `serialize_campaign()`
- `frontend/src/App.jsx` — Thêm 2 textarea inputs vào campaign form

**Files mới:**
- `backend/alembic/versions/xxxx_add_campaign_keyword_filter_fields.py` — Migration
- `backend/tests/test_keyword_filter.py` — Unit tests

**KHÔNG SỬA:**
- `apify_crawler.py` — Story 9.1 đã bổ sung stats, Story 9.2 không cần sửa thêm
- `cron.py`, `facebook.py`, `security.py` — không liên quan

### Edge Cases & Error Handling

1. **Blocklist keyword rỗng string:** `["", "casino"]` → filter bỏ empty strings khi apply: `[k for k in blocklist if k.strip()]`
2. **Caption rỗng/null:** `entry.get("description") or ""` → empty string → blocklist không match, allowlist (nếu có) → reject
3. **Unicode keywords:** `"café"` match `"CAFÉ"` nhờ `.lower()` — OK cho Latin, KHÔNG OK cho CJK. Accept tradeoff cho MVP
4. **Hashtag format không nhất quán:** Admin có thể nhập `"#cooking"` hoặc `"cooking"` → normalize strip `#` trước khi lưu
5. **Allowlist + Blocklist cùng lúc:** Blocklist check TRƯỚC. Video chứa blocklist keyword bị reject ngay, không cần check allowlist
6. **Very long blocklist (100+ keywords):** Loop substring check O(n*m) — acceptable cho typical use case. Nếu cần optimize sau dùng regex compiled pattern
7. **JSON column default:** SQLAlchemy `default=list` tạo new list mỗi row, KHÔNG dùng `default=[]` (mutable default bug)

### Anti-Patterns to Avoid

- **KHÔNG** dùng regex cho blocklist match — substring `in` operator đủ tốt, regex over-engineering cho MVP
- **KHÔNG** normalize blocklist/allowlist khi lưu vào DB — normalize khi apply filter (giữ nguyên input của Admin)
- **KHÔNG** tạo file `keyword_filter.py` riêng — thêm vào `content_filter.py` theo architecture D4 (1 file, N filter classes)
- **KHÔNG** ghi event cho TỪNG video bị keyword filter — chỉ ghi summary cuối sync
- **KHÔNG** validate blocklist/allowlist length trong API — Admin tự chịu trách nhiệm, không cần limit
- **KHÔNG** persist filter reason vào Video model — video bị filter thì KHÔNG tạo record

### References

- [Source: architecture.md#D4: Content Pipeline Architecture]
- [Source: epics.md#Epic 9, Story 9.2]
- [Source: Story 9.1 — 9-1-cham-diem-chat-luong-video-tu-dong.md]
- [Source: backend/app/services/content_filter.py — ContentFilter Protocol, QualityFilter (Story 9.1 output)]
- [Source: backend/app/services/campaign_jobs.py — sync_campaign_content(), filter integration point]
- [Source: backend/app/api/campaigns.py — CampaignCreate, serialize_campaign()]
- [Source: backend/app/models/models.py — Campaign model, JSON_TYPE definition]
- [Source: frontend/src/App.jsx — campaign form patterns, FIELD_CLASS]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### Change Log

### File List
