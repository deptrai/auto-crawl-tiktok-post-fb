# Story 10.3: Tối Ưu Hashtag Tự Động (Auto Hashtag Optimization)

## 1. Story Foundation (Requirements)

**User Story:**
As a Campaign Manager,
I want to AI tự động thêm trending hashtag phù hợp vào caption,
So that reach của post được tối đa hóa mà không cần research hashtag thủ công.

**Acceptance Criteria:**
- **Given** AI caption đã được generate và `hashtag_optimization=enabled` (cấu hình của campaign)
- **When** Gemini hoàn thành caption generation
- **Then** hệ thống gọi AI để gợi ý thêm 3-5 trending hashtag phù hợp với nội dung video
- **And** hashtag từ original TikTok caption được giữ lại + merge với hashtag mới, deduplicate (loại bỏ hashtag trùng lặp)
- **And** tổng số hashtag không vượt quá 30 (theo khuyến nghị của Facebook).

## 2. Developer Context (Guardrails)

### Technical Requirements
- Cập nhật model `campaigns`:
  - Thêm cột `hashtag_optimization: Boolean DEFAULT false` cờ để bật/tắt (Sử dụng Pydantic DTO validation).
- Cập nhật `ai_generator.py`:
  - Mở rộng hàm `generate_caption` với tham số `optimize_hashtags: bool = False`.
  - Khuyến nghị tạo một hàm helper `_merge_hashtags(caption, original_caption, max_total=30)`. Trích xuất `#` từ caption gốc rồi merge bằng tính chất của tập hợp (Set).
- Frontend Update:
  - Trong `features/campaigns`, bổ sung tuỳ chọn Toggler / Switch component để thay đổi cờ `hashtag_optimization` (Auto Hashtags).
- Xử lý mảng (Array / Set) an toàn: Cả hai captions có thể không có hashtag nào, hàm `_merge_hashtags` phải xử lý Graceful và không lỗi regex / split.

### Architecture Compliance
- Thao tác DB (thêm flag `hashtag_optimization` vào DB Postgres) phải đi qua hệ thống Alembic migration scripts.
- Dữ liệu ở Back-end format `snake_case` (hashtag_optimization) và `camelCase` (hashtagOptimization) khi tương tác với dữ liệu JSON của React quy định từ các story trước.
- Không thay đổi các biến `brand_voice` và `caption_language` đang có, mà truyền đủ các biến cùng một lúc vào hàm tạo caption.

### Previous Intelligence (Liên kết tới Story 10.1 & 10.2)
- Các biến `brand_voice`, `brand_voice_preset`, và `target_language` kết hợp chung trong `_build_system_prompt`.
- Khi tính năng tạo hashtag được enable, bản thân system prompt có thể được modify thêm dòng "Ngoài việc viết lại/detect language, hãy append 3-5 hashtags trending ở cuối" HOẶC code Python có thể Regex bóc tách rồi Merge.

### File Structure Impacts
- `backend/alembic/versions/` => Thêm script (add column `hashtag_optimization`).
- `backend/app/models/models.py` (model `campaigns`) => Update entity.
- `backend/app/schemas/` => Add fields to CampaignDTO in backend.
- `backend/app/services/ai_generator.py` => Enhance logic `generate_caption` & add `_merge_hashtags`.
- `frontend/src/features/campaigns/` => Add Toggler Component / Form field.

## 3. Latest Tech Specifics
- Parsing hashtags an toàn: Hãy sử dụng Regex `re.findall(r'#\w+')` để bóc text. Sử dụng tập hợp `set()` để dedup. Cắt list hashtags bằng array slicing `list(hashtags)[:30]` để đảm bảo Facebook an toàn, rồi `.join(" ")` thay vì để AI tự do overgenerate.

## 4. Status
Status: `ready-for-dev`
Note: Ultimate context engine analysis completed - comprehensive developer guide created.
