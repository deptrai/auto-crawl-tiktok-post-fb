# Story 10.1: Cấu Hình Brand Voice Profile (Brand Voice Config)

## 1. Story Foundation (Requirements)

**User Story:**
As an Admin,
I want to định nghĩa profile giọng văn thương hiệu cho từng Facebook Page,
So that AI caption phản ánh đúng tông/phong cách giao tiếp của page thay vì generic.

**Acceptance Criteria:**
- **Given** Admin vào trang cấu hình Facebook Page
- **When** Admin nhập `brand_voice` prompt (VD: "Viết theo phong cách trẻ trung, dùng emoji, ngôn ngữ Gen Z")
- **Then** Gemini nhận brand_voice prompt như system instruction khi generate caption
- **And** có 5 template preset (professional, casual, gen-z, corporate, viral) để chọn nhanh.

## 2. Developer Context (Guardrails)

### Technical Requirements
- Mở rộng model `facebook_pages`:
  - Thêm trường `brand_voice: String NULLABLE`
  - Thêm trường `brand_voice_preset: String DEFAULT "casual"`
- Preset options: `professional | casual | gen-z | corporate | viral`.
- Backend Schema: Cập nhật Pydantic DTO (schema) của phần `Facebook Page` (GET, POST, PUT) để cho phép nhận/trả 2 biến mới.
- Service `ai_generator.py`: Nâng cấp hàm `generate_caption` để ghép giá trị `brand_voice` hoặc dựa theo `brand_voice_preset` thành `system_prompt` cho Gemini.
- Frontend: Cập nhật giao diện quản lý / chỉnh sửa Facebook Page `features/channels` để cho phép chọn preset và điền `brand_voice`.

### Architecture Compliance
- Sử dụng **Alembic migration** thay vì sửa trực tiếp vào DB cứng để đảm bảo tính nhất quán (không làm đứt gãy data phase 1). Cấm dùng raw SQL.
- Pattern Strategy ở `ai_generator.py`:
  - `brand_voice` được truyền vào dưới dạng Custom System Prompt. 
  - Khuyến khích tạo một helper: `_build_system_prompt(brand_voice, brand_voice_preset, target_language)` để tạo prompt hoàn chỉnh đưa vào `gemini_response`.
- Tách bạch cấu trúc: Cập nhật `models.py` hoặc schema liên quan trong thư mục tương ứng theo tài liệu Architecture. Phải bảo đảm `brand_voice_preset` mặc định là "casual".
- Frontend call API qua **TanStack Query** để sửa/lưu dữ liệu page.

### Best Practices & Patterns (Từ Architecture)
- Backend phải dùng `snake_case` nhưng Pydantic xuất data sang Client dưới dạng `camelCase` (brandVoice, brandVoicePreset).
- FastAPI return value phải bọc trong chuẩn: `{"data": <payload>, "message": "Success"}`.
- Không để OOM Exception đứt nhánh: Gemini API call phải nằm trong khối `try-catch` an toàn và ghi log nếu Gemini rate limit/auth fail.

### File Structure Impacts
- `backend/alembic/versions/` => thêm file migration
- `backend/app/models/models.py` (hoặc model chứa facebook_pages) => thêm fields
- `backend/app/schemas/` => update Facebook Page DTO
- `backend/app/services/ai_generator.py` => logic GenAI Prompt
- `frontend/src/features/channels/` => update forms

## 3. Latest Tech Specifics
- **Google Generative AI (Gemini SDK)**: Đảm bảo sử dụng property `system_instruction` trong config (cho các phiên bản SDK mới nhất) thay vì chèn system prompt thủ công vào messages/history nếu SDK đang áp dụng hỗ trợ native `system_instruction`. 
- Ghi đè fallback an toàn để chống lỗi 500 do timeout call AI Model.

## 4. Status
Status: `ready-for-dev`
Note: Ultimate context engine analysis completed - comprehensive developer guide created.
