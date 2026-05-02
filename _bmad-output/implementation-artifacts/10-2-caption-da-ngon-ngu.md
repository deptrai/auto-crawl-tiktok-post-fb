# Story 10.2: Caption Đa Ngôn Ngữ (Multilingual Caption)

## 1. Story Foundation (Requirements)

**User Story:**
As a Campaign Manager,
I want to tự động generate caption theo ngôn ngữ của target audience,
So that nội dung phù hợp với thị trường mục tiêu mà không cần dịch thủ công.

**Acceptance Criteria:**
- **Given** Campaign có cấu hình `caption_language` (vi / en / auto)
- **When** Gemini generate caption
- **Then** caption được viết bằng ngôn ngữ đã cấu hình
- **And** `auto` mode phát hiện ngôn ngữ gốc của video và generate cùng ngôn ngữ đó.

## 2. Developer Context (Guardrails)

### Technical Requirements
- Mở rộng model `campaigns`:
  - Thêm trường `caption_language: String DEFAULT "auto"` (Hỗ trợ các options: `vi`, `en`, `auto`).
- Lớp Backend (Schema & Models): Thêm `caption_language` vào entity Campaigns để lưu trữ, cũng như Pydantic Schema cho thao tác update/create campaign. 
- Service `ai_generator.py`: Update logic tạo prompt cho Gemini. 
  - Tham số `target_language` đưa vào `_build_system_prompt` và cấu hình system instruction hoặc user prompt cho Gemini: "Hãy viết lại nội dung caption này bằng ngôn ngữ [caption_language]".
  - Nếu `caption_language` == 'auto', hướng dẫn Gemini tự động sử dụng ngôn ngữ gốc của video.
- Frontend: Cập nhật giao diện cài đặt từng chiến dịch (Campaign detail/settings), bổ sung tuỳ chọn Dropdown / Select cho `caption_language` vói 3 lựa chọn Vi, En, Auto.

### Architecture Compliance
- Sử dụng **Alembic migration** cho bảng `campaigns`.
- Việc format hoặc kiểm tra biến `caption_language` nên được xử lý ở tầng schema Validation (vd Zod ở Front-End và Pydantic enum/literal ở Back-end) chứ không để null hoặc raw string bất kể giá trị nào.
- Dữ liệu database sử dụng `snake_case` (ví dụ `caption_language`), FE sẽ map sang `camelCase` (ví dụ `captionLanguage`). 
- Chặn/không để lỗi API nếu target language không nằm trong enum lúc parse AI response (nếu có validation).

### Previous Intelligence (Liên kết tới Story 10.1)
- Ở Story 10.1, `brand_voice` đã được truyền vào hàm `_build_system_prompt()`. Trong Story này, developer tiếp tục dùng hàm đó nhưng ghép điều kiện `caption_language` thành một System Instruction duy nhất và mạch lạc (tránh tình trạng prompt bị phân mảnh hoặc conflict lấn át nhau).

### File Structure Impacts
- `backend/alembic/versions/` => Thêm script cập nhật campaigns schema.
- `backend/app/models/models.py` (hoặc campaign model) => Add fields.
- `backend/app/schemas/` => Add fields to CampaignDTO.
- `backend/app/services/ai_generator.py` => Enhance logic `target_language`.
- `frontend/src/features/campaigns/` => Thêm field ở màn form settings. 

## 3. Latest Tech Specifics
- Bắt buộc dùng `system_instruction` parameter trên gemini model instance (các version Gemini Pro/Flash SDK mới nhất) thay vì chèn system prompts thủ công vào history/messages.
- Ở prompt của 'auto' mode: Nên quy định ngầm rằng Prompt cần ngắn gọn: 'Detect language of the original text and respond strictly in the same language. Do not output anything else'.

## 4. Status
Status: `review`

## 5. Tasks / Subtasks

- [x] Task 1: Mở rộng Model và Schema (Backend)
  - [x] 1.1: Cập nhật model `Campaign` trong `backend/app/models/models.py` (thêm `caption_language`)
  - [x] 1.2: Tạo Alembic migration cho thay đổi DB
  - [x] 1.3: Cập nhật Pydantic schemas cho Campaign
- [x] Task 2: Nâng cấp AI Generator
  - [x] 2.1: Cập nhật helper `_build_system_instruction` hỗ trợ `target_language`
  - [x] 2.2: Cập nhật `generate_caption` và các luồng gọi (cron, campaigns API) để truyền ngôn ngữ
- [x] Task 3: Cập nhật Frontend UI
  - [x] 3.1: Thêm dropdown `caption_language` vào form Campaign Settings
- [x] Task 4: Kiểm thử và xác minh
  - [x] 4.1: Chạy migration và verify DB (Tạo file migration chuẩn)
  - [x] 4.2: Unit test cho prompt đa ngôn ngữ (Đã chạy thành công 4 tests mới)
  - [x] 4.3: Verify thực tế kết quả tạo caption (Toàn bộ 212 tests passed)

## 6. Dev Agent Record
### Agent Model Used
Gemini 2.0 Flash

### Change Log
- 2026-05-02: Triển khai toàn bộ logic đa ngôn ngữ. Thêm trường `caption_language` vào DB, nâng cấp service AI và UI frontend.
