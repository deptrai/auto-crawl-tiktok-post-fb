# Story 9.3: Phát Hiện Nội Dung Trùng Lặp (Cross-Campaign Dedup)

Status: ready-for-dev

## Story

As a Background Worker,
I want to phát hiện và bỏ qua video đã được đăng bởi bất kỳ campaign nào khác trên cùng Facebook Page,
so that không đăng cùng một video 2 lần lên cùng một fanpage dù đến từ các nguồn khác nhau.

## Bối Cảnh & Lý Do

### Phụ thuộc
- **Story 9.1 PHẢI hoàn thành trước** — cần:
  - `content_filter.py` với `ContentFilter` Protocol, `FilterResult` dataclass, `run_filters()` helper
  - Filter pipeline đã integrated vào `sync_campaign_content()` trong `campaign_jobs.py`
- **Story 9.2 nên hoàn thành trước** (nhưng không bắt buộc) — `KeywordFilter` đã có trong chain

### Vấn đề cần giải quyết
- Hiện tại `campaign_jobs.py` chỉ dedup TRONG cùng campaign (`Video.campaign_id == campaign_uuid AND Video.original_id == original_id`)
- Nếu 2 campaigns khác nhau target cùng 1 Facebook Page VÀ crawl cùng 1 video → video bị đăng 2 lần lên cùng fanpage
- Ví dụ: Campaign A (source: @chef_a) và Campaign B (source: @chef_b) cả hai target Page "Food Lovers" — nếu cùng repost video #viral → đăng trùng

### Architecture Decision
Architecture D4: Chain of Responsibility — `CrossCampaignDedup` là filter thứ 3 (cuối cùng) trong pipeline:
```
QualityFilter → KeywordFilter → CrossCampaignDedup
```

### Đặc biệt — CrossCampaignDedup cần DB access
- `QualityFilter` và `KeywordFilter` chỉ dùng in-memory data (entry + campaign)
- `CrossCampaignDedup` cần query DB → nhận thêm `db: Session` parameter
- Architecture ghi: `CrossCampaignDedup(db)` — truyền `db` qua constructor, KHÔNG thay đổi Protocol signature

## Acceptance Criteria

### AC1: CrossCampaignDedup filter class
**Given** `CrossCampaignDedup` class implement `ContentFilter` Protocol (với `db` qua constructor)
**When** `CrossCampaignDedup.apply(entry, campaign)` được gọi
**Then** query `videos` table:
```sql
SELECT 1 FROM videos v
JOIN campaigns c ON v.campaign_id = c.id
WHERE c.target_page_id = :current_campaign_target_page_id
  AND v.original_id = :entry_original_id
  AND v.status = 'posted'
LIMIT 1
```
**And** nếu tìm thấy record `posted` → `FilterResult(accepted=False, reason="cross_campaign_duplicate:{campaign_name}")`
**And** nếu KHÔNG tìm thấy (hoặc chỉ có `failed`) → `FilterResult(accepted=True)`
**And** nếu campaign KHÔNG có `target_page_id` (chưa assign page) → bypass dedup, luôn accepted

### AC2: Tích hợp vào filter pipeline
**Given** `run_filters()` đã chạy `[QualityFilter(), KeywordFilter()]` (từ Story 9.1 + 9.2)
**When** sync_campaign_content xử lý entries
**Then** pipeline chain = `[QualityFilter(), KeywordFilter(), CrossCampaignDedup(db)]`
**And** `CrossCampaignDedup` nhận `db` qua constructor khi khởi tạo filters list
**And** entries bị reject bởi dedup → skip, ghi vào `filtered_by_dedup` count

### AC3: Dedup logic phân biệt status
**Given** video `original_id` X đã tồn tại trên cùng `target_page_id`
**When** check dedup
**Then** các trường hợp:
- Status `posted` → **REJECT** (đã đăng thành công, không đăng lại)
- Status `ready` → **REJECT** (đang chờ đăng, sẽ đăng sớm)
- Status `downloading` → **REJECT** (đang tải, sẽ sẵn sàng sớm)
- Status `pending` → **REJECT** (đã queue, sẽ xử lý)
- Status `failed` → **ACCEPT** (video cũ fail, cho phép campaign mới thử lại)

### AC4: Sync report bao gồm dedup count
**Given** sync_campaign_content hoàn tất
**When** ghi completion event
**Then** details chứa thêm: `filtered_by_dedup` count
**And** tổng `filtered_total = filtered_by_quality + filtered_by_keyword + filtered_by_dedup`

### AC5: Xử lý edge cases
**Given** dedup filter chạy
**When** campaign chưa có `target_page_id`
**Then** bypass dedup hoàn toàn (không query DB, luôn accepted)
**When** cùng campaign sync 2 entries trùng `original_id`
**Then** within-campaign dedup (existing code dòng 172-178) đã xử lý → CrossCampaignDedup chỉ check cross-campaign

## Tasks / Subtasks

- [ ] Task 1: CrossCampaignDedup filter class (AC: #1, #3)
  - [ ] 1.1: Thêm `CrossCampaignDedup` class vào `content_filter.py`
  - [ ] 1.2: Constructor nhận `db: Session`
  - [ ] 1.3: Implement `apply()` — query videos JOIN campaigns, filter by `target_page_id` + `original_id` + status NOT `failed`
  - [ ] 1.4: Bypass khi `campaign.target_page_id` is None

- [ ] Task 2: Tích hợp vào filter pipeline (AC: #2)
  - [ ] 2.1: Mở rộng filters list trong `campaign_jobs.py`: `[QualityFilter(), KeywordFilter(), CrossCampaignDedup(db)]`
  - [ ] 2.2: Khởi tạo `CrossCampaignDedup(db)` TRƯỚC loop (db session đã có)
  - [ ] 2.3: Track `filtered_by_dedup` riêng biệt trong sync loop

- [ ] Task 3: Sync report enhancement (AC: #4)
  - [ ] 3.1: Phân loại filter reason: quality / keyword / dedup dựa trên `filter_result.reason` prefix
  - [ ] 3.2: Thêm `filtered_by_dedup` vào completion event details

- [ ] Task 4: Unit tests (AC: #1-5)
  - [ ] 4.1: Test `CrossCampaignDedup` — video `posted` trên cùng page → rejected
  - [ ] 4.2: Test `CrossCampaignDedup` — video `failed` trên cùng page → accepted (cho retry)
  - [ ] 4.3: Test `CrossCampaignDedup` — video `ready`/`downloading`/`pending` trên cùng page → rejected
  - [ ] 4.4: Test `CrossCampaignDedup` — video trên KHÁC page → accepted (khác fanpage thì OK)
  - [ ] 4.5: Test `CrossCampaignDedup` — campaign không có `target_page_id` → bypass, accepted
  - [ ] 4.6: Test full pipeline chain — QualityFilter + KeywordFilter + CrossCampaignDedup
  - [ ] 4.7: Test sync report — verify `filtered_by_dedup` count

## Dev Notes

### Story 9.1 + 9.2 đã tạo (dùng lại, KHÔNG tạo mới)

**`content_filter.py` — đã có:**
```python
@dataclass
class FilterResult:
    accepted: bool
    reason: str | None = None

class ContentFilter(Protocol):
    def apply(self, entry: dict, campaign: Campaign) -> FilterResult: ...

class QualityFilter: ...     # Story 9.1
class KeywordFilter: ...     # Story 9.2

def run_filters(entry, campaign, filters) -> FilterResult: ...
```

**`campaign_jobs.py` — filter pipeline đã integrated:**
```python
filters = [QualityFilter(), KeywordFilter()]  # ← THÊM CrossCampaignDedup(db)
filter_result = run_filters(entry, campaign, filters)
```

### CrossCampaignDedup Implementation

```python
from sqlalchemy.orm import Session

class CrossCampaignDedup:
    """Filter thứ 3: phát hiện video đã tồn tại trên cùng Facebook Page từ campaign khác."""

    def __init__(self, db: Session):
        self._db = db

    def apply(self, entry: dict, campaign: Campaign) -> FilterResult:
        # Bypass nếu campaign chưa assign page
        if not campaign.target_page_id:
            return FilterResult(accepted=True)

        original_id = entry.get("id", "")
        if not original_id:
            return FilterResult(accepted=True)

        # Query: có video nào cùng original_id, cùng target_page, status != failed?
        existing = (
            self._db.query(Video.id, Video.status, Campaign.name)
            .join(Campaign, Video.campaign_id == Campaign.id)
            .filter(
                Campaign.target_page_id == campaign.target_page_id,
                Video.original_id == original_id,
                Video.campaign_id != campaign.id,  # exclude current campaign
                Video.status != VideoStatus.failed,
            )
            .first()
        )

        if existing:
            _, status, source_campaign = existing
            return FilterResult(
                accepted=False,
                reason=f"cross_campaign_duplicate:{source_campaign}"
            )

        return FilterResult(accepted=True)
```

### Điểm quan trọng — Khác với within-campaign dedup

**Within-campaign dedup (existing, dòng 172-178):**
- Query: `Video.campaign_id == campaign_uuid AND Video.original_id == original_id`
- Mục đích: tránh tải lại video đã sync trong cùng campaign
- Bất kể status → skip

**Cross-campaign dedup (Story 9.3 — MỚI):**
- Query: `Campaign.target_page_id == page_id AND Video.original_id == original_id AND Video.campaign_id != current`
- Mục đích: tránh đăng cùng video lên cùng fanpage từ campaigns khác nhau
- Status `failed` → cho phép retry (video cũ fail, campaign mới có thể thành công)

**Hai dedup này bổ sung cho nhau:**
1. Within-campaign dedup chạy TRƯỚC (dòng 172-178, giữ nguyên)
2. CrossCampaignDedup chạy trong filter pipeline (dòng ~180, sau dedup)

### Tích hợp trong campaign_jobs.py

```python
# TRƯỚC loop — khởi tạo filters MỘT LẦN:
from app.services.content_filter import QualityFilter, KeywordFilter, CrossCampaignDedup, run_filters
filters = [QualityFilter(), KeywordFilter(), CrossCampaignDedup(db)]

filtered_by_quality = 0
filtered_by_keyword = 0
filtered_by_dedup = 0

for entry in entries:
    # ... existing within-campaign dedup (line 172-178) ...

    # Filter pipeline (đã có từ Story 9.1, chỉ thêm CrossCampaignDedup):
    filter_result = run_filters(entry, campaign, filters)
    if not filter_result.accepted:
        reason = filter_result.reason or ""
        if reason.startswith(("min_views", "min_likes")):
            filtered_by_quality += 1
        elif reason.startswith(("blocklist", "allowlist")):
            filtered_by_keyword += 1
        elif reason.startswith("cross_campaign"):
            filtered_by_dedup += 1
        continue

    # ... create Video record ...
```

### DB Query Performance

- Query chạy mỗi entry trong sync loop → cần hiệu quả
- `videos.original_id` đã có INDEX (line 74 models.py: `original_id = Column(String, index=True)`)
- `campaigns.target_page_id` chưa có index — nhưng JOIN nhỏ (ít campaigns), chấp nhận được
- Nếu scale lên → có thể thêm composite index `(original_id, campaign_id)` sau, nhưng KHÔNG làm trong story này

### Reason Prefix Classification

Để phân loại filter reason trong sync report:
```python
QUALITY_PREFIXES = ("min_views", "min_likes")
KEYWORD_PREFIXES = ("blocklist", "allowlist")
DEDUP_PREFIXES = ("cross_campaign",)

def classify_filter_reason(reason: str | None) -> str:
    if not reason:
        return "unknown"
    if reason.startswith(QUALITY_PREFIXES):
        return "quality"
    if reason.startswith(KEYWORD_PREFIXES):
        return "keyword"
    if reason.startswith(DEDUP_PREFIXES):
        return "dedup"
    return "unknown"
```

### Project Structure Notes

**Files sửa (mở rộng từ Story 9.1 + 9.2):**
- `backend/app/services/content_filter.py` — Thêm `CrossCampaignDedup` class
- `backend/app/services/campaign_jobs.py` — Thêm `CrossCampaignDedup(db)` vào filters list + track dedup count

**Files mới:**
- `backend/tests/test_cross_campaign_dedup.py` — Unit tests

**KHÔNG SỬA:**
- `models.py` — KHÔNG cần thêm columns (dùng existing `original_id` + `target_page_id`)
- `campaigns.py` (API) — KHÔNG cần thêm endpoint
- `App.jsx` (Frontend) — KHÔNG cần UI changes (dedup tự động, không có config)
- `apify_crawler.py` — không liên quan

### Edge Cases & Error Handling

1. **Campaign chưa assign page:** `target_page_id = None` → bypass dedup hoàn toàn (không có page để so sánh)
2. **Cùng campaign sync 2 entries trùng ID:** Within-campaign dedup (line 172-178) đã handle → entry thứ 2 skip trước khi đến CrossCampaignDedup
3. **Video `failed` trên campaign khác:** Cho phép tải lại — campaign mới có thể dùng CDN URL khác hoặc config khác
4. **Video `ready` trên campaign khác:** REJECT — đang chờ đăng, sẽ đăng sớm, không cần duplicate
5. **Multiple pages, same video:** Video X posted trên Page A → Campaign targeting Page B VẪN cho phép tải video X (khác page = OK)
6. **DB session stale sau `db.expire_all()`:** Line 156 expire_all → CrossCampaignDedup query fresh data mỗi iteration
7. **original_id rỗng:** Entry không có `id` field → bypass dedup (cannot match)

### Anti-Patterns to Avoid

- **KHÔNG** thay đổi within-campaign dedup logic hiện tại (line 172-178) — giữ nguyên, CrossCampaignDedup bổ sung thêm
- **KHÔNG** thay đổi `ContentFilter` Protocol signature — `CrossCampaignDedup` nhận `db` qua constructor, `apply()` signature giữ nguyên
- **KHÔNG** cache dedup results trong memory — DB query đủ nhanh, cache có thể stale
- **KHÔNG** thêm UI config cho dedup — dedup là automatic, Admin không cần bật/tắt
- **KHÔNG** thêm migration — Story 9.3 không cần schema changes
- **KHÔNG** query ALL videos rồi filter in-memory — dùng DB query với JOIN + WHERE

### References

- [Source: architecture.md#D4: Content Pipeline Architecture — Cross-Campaign Dedup Logic]
- [Source: epics.md#Epic 9, Story 9.3]
- [Source: Story 9.1 — 9-1-cham-diem-chat-luong-video-tu-dong.md]
- [Source: Story 9.2 — 9-2-bo-loc-hashtag-tu-khoa.md]
- [Source: backend/app/services/campaign_jobs.py — sync_campaign_content(), within-campaign dedup dòng 172-178]
- [Source: backend/app/models/models.py — Video.original_id (indexed), Campaign.target_page_id]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### Change Log

### File List
