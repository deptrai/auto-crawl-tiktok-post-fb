# Story 9.2: Bộ Lọc Hashtag & Từ Khóa (Content Filter Rules)

Status: done

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

- [x] Task 1: Alembic migration — thêm keyword filter fields vào `campaigns` (AC: #1)
  - [x] 1.1: Thêm `filter_blocklist_keywords` (JSON, default=list), `filter_allowlist_hashtags` (JSON, default=list) vào `Campaign` model trong `models.py`
  - [x] 1.2: Tạo Alembic migration file `20260428_02_add_campaign_keyword_filter_fields.py`
  - [x] 1.3: Migration applied — existing campaigns không bị ảnh hưởng (server_default='[]')

- [x] Task 2: KeywordFilter class (AC: #2)
  - [x] 2.1: Thêm `KeywordFilter` class vào `content_filter.py`
  - [x] 2.2: Implement blocklist check — case-insensitive substring match trên caption
  - [x] 2.3: Implement allowlist check — hashtag matching trên caption
  - [x] 2.4: Helper `_extract_hashtags(text: str) -> set[str]` — extract tất cả #tags từ caption, lowercase

- [x] Task 3: Tích hợp vào filter pipeline (AC: #3)
  - [x] 3.1: `get_default_filters()` trả về `[QualityFilter(), KeywordFilter()]`
  - [x] 3.2: Track `filtered_by_quality` và `filtered_by_keyword` riêng biệt trong sync loop
  - [x] 3.3: Completion event report `filtered_by_quality`, `filtered_by_keyword`, `filtered_total`

- [x] Task 4: API + Frontend (AC: #4, #5)
  - [x] 4.1: Mở rộng `CampaignCreate` + `CampaignUpdate` Pydantic models
  - [x] 4.2: `POST /campaigns/` và `PATCH /campaigns/{id}` lưu keyword filter fields qua ALLOWED_FIELDS
  - [x] 4.3: `serialize_campaign()` trả về 2 fields mới
  - [x] 4.4: Frontend `App.jsx` — 2 textarea inputs (newline-separated), formData reset

- [x] Task 5: Unit tests (AC: #1-5)
  - [x] 5.1: Test `KeywordFilter` blocklist — 7 cases
  - [x] 5.2: Test `KeywordFilter` blocklist case-insensitive — 3 cases
  - [x] 5.3: Test `KeywordFilter` allowlist — 6 cases
  - [x] 5.4: Test `KeywordFilter` allowlist rỗng → always accepted — 3 cases
  - [x] 5.5: Test `KeywordFilter` priority (blocklist before allowlist) — 3 cases
  - [x] 5.6: Test `_extract_hashtags()` — 7 cases
  - [x] 5.7: Test full pipeline chain — 5 cases
  - [x] 5.8: Test API model fields — 6 cases

### Review Findings

- [x] [Review][Patch] AC5 violation — Thiếu summary event "X video bị lọc bởi từ khóa" khi `filtered_by_keyword > 0` [backend/app/services/campaign_jobs.py:243-256] — spec AC5 yêu cầu rõ
- [x] [Review][Patch] Phân loại filter dùng `reason.startswith()` rất giòn — nên dùng `filter_result.filter_name == "quality"` [backend/app/services/campaign_jobs.py:189-194]
- [x] [Review][Patch] DoS vector — `list[str]` filter fields không có max-length validation, có thể nhận list/string khổng lồ làm OOM [backend/app/api/campaigns.py:35-36, 48-49]
- [x] [Review][Patch] `allowlist_normalized` được tính lại mỗi entry trong loop — hoist ra trước loop để tối ưu [backend/app/services/content_filter.py:108-110]
- [x] [Review][Patch] Test gap — chưa cover scenarios tiếng Việt có dấu (`#nấuăn`), CJK (`#料理`), emoji, long caption (10KB+) [backend/tests/test_keyword_filter.py]
- [x] [Review][Patch] Test gap — chưa test allowlist `["   "]` (whitespace-only) gây reject all videos vì set rỗng sau normalize [backend/tests/test_keyword_filter.py]
- [x] [Review][Defer] Substring match không có word-boundary ("tea" block "steam", "cá độ" block "cá độc") [backend/app/services/content_filter.py:99] — deferred, spec MVP đồng ý dùng substring đơn giản
- [x] [Review][Defer] PATCH API cho phép gửi `null` để xóa filters [backend/app/api/campaigns.py:248-265] — deferred, hành vi PATCH chuẩn, không vi phạm spec
- [x] [Review][Defer] Race condition — admin đổi filter config giữa lúc sync (filter list thay đổi mid-iteration) [backend/app/services/campaign_jobs.py:162] — deferred, acceptable trade-off
- [x] [Review][Defer] `reason="blocklist_match:{keyword}"` chứa user-input có thể là XSS surface nếu UI render unescaped [backend/app/services/content_filter.py:101] — deferred, observability layer concern, escape ở UI
- [x] [Review][Defer] Hoisted filter chain `content_filters = get_default_filters()` ngoài loop sẽ rủi ro cho Story 9.3 (CrossCampaignDedup có state) — deferred, sẽ xử lý khi làm 9.3 [backend/app/services/campaign_jobs.py:158]

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
claude-opus-4-5 (bmad-dev-story workflow)

### Debug Log References
- 130/130 pytest passed (55s). 1 regression fixed: `test_content_filter.py` Story 9.1 test asserting old `filtered_count` key → updated to `filtered_total`/`filtered_by_quality`/`filtered_by_keyword`.
- Alembic migration `20260428_02` applied successfully.

### Completion Notes List
- `default=list` used (NOT `default=[]`) to avoid SQLAlchemy mutable default bug on JSON columns.
- `getattr(campaign, "filter_blocklist_keywords", None) or []` handles both None DB values and missing attrs on mock objects.
- Allowlist normalization: `h.lstrip("#").lower()` so admin can enter "#cooking" or "cooking" — both work.
- `keyword.strip()` in blocklist loop skips empty/whitespace-only strings.
- `get_default_filters()` hoisted outside sync loop in `campaign_jobs.py` to avoid re-instantiation per entry.

### Change Log
- `backend/app/models/models.py` — Added `filter_blocklist_keywords`, `filter_allowlist_hashtags` JSON columns to Campaign
- `backend/alembic/versions/20260428_02_add_campaign_keyword_filter_fields.py` — New migration (JSONB, server_default='[]')
- `backend/app/services/content_filter.py` — Added `_extract_hashtags()`, `KeywordFilter` class; updated `get_default_filters()`
- `backend/app/services/campaign_jobs.py` — Split `filtered_count` → `filtered_by_quality` + `filtered_by_keyword`; updated event details
- `backend/app/api/campaigns.py` — Extended `CampaignCreate`, `CampaignUpdate`, `serialize_campaign()`, `ALLOWED_FIELDS`
- `frontend/src/App.jsx` — Added 2 textarea inputs; updated `formData` state + reset
- `backend/tests/test_keyword_filter.py` — New (40 tests, 8 classes)
- `backend/tests/test_content_filter.py` — Fixed Story 9.1 regression: `filtered_count` → `filtered_total`/breakdown keys

### File List
- backend/app/models/models.py
- backend/alembic/versions/20260428_02_add_campaign_keyword_filter_fields.py
- backend/app/services/content_filter.py
- backend/app/services/campaign_jobs.py
- backend/app/api/campaigns.py
- frontend/src/App.jsx
- backend/tests/test_keyword_filter.py
- backend/tests/test_content_filter.py
