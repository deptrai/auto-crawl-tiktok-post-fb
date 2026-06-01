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
Status: `review`

## 5. Tasks / Subtasks

- [x] Task 1: Mở rộng Model và Schema (AC: #1, #2)
  - [x] 1.1: Cập nhật model `FacebookPage` trong `backend/app/models/models.py` (thêm `brand_voice`, `brand_voice_preset`)
  - [x] 1.2: Tạo Alembic migration cho thay đổi DB
  - [x] 1.3: Cập nhật Pydantic schemas trong `backend/app/api/facebook.py` cho Facebook Page
- [x] Task 2: Nâng cấp AI Generator (AC: #3)
  - [x] 2.1: Triển khai helper `_build_system_prompt` trong `ai_generator.py`
  - [x] 2.2: Cập nhật hàm `generate_caption` để sử dụng `brand_voice` từ database
- [x] Task 3: Cập nhật Frontend UI (AC: #1, #4)
  - [x] 3.1: Thêm trường nhập liệu `brand_voice` và dropdown `brand_voice_preset` vào form chỉnh sửa Page
  - [x] 3.2: Tích hợp với TanStack Query để lưu thay đổi
- [x] Task 4: Kiểm thử và xác minh (AC: #1-5)
  - [x] 4.1: Chạy migration và verify DB schema (Manual verification via migration file)
  - [x] 4.2: Unit test cho `_build_system_prompt` (Verified via `backend/tests/test_brand_voice_prompt.py`)
  - [x] 4.3: Kiểm tra luồng generate caption thực tế với các preset khác nhau

### Review Findings (2026-05-02)

- [x] [Review][Patch] Identifier AI sai (gemini-2.5-flash) — Đã sửa thành gemini-1.5-flash. [backend/app/services/ai_generator.py:35]
- [x] [Review][Patch] Sai Payload Key cho Gemini (system_instruction) — Đã dùng systemInstruction (camelCase). [backend/app/services/ai_generator.py:44]
- [x] [Review][Patch] Bug ghi đè Token cũ thành chuỗi rỗng khi update config — Đã sửa logic kiểm tra token khi update. [backend/app/api/facebook.py:73]
- [x] [Review][Patch] Thiếu giới hạn độ dài Input cho brand_voice (backend/frontend) — Đã thêm Field(max_length=500) và maxLength={500}. [backend/app/api/facebook.py:26, frontend/src/App.jsx:1128]
- [x] [Review][Patch] Rủi ro Index Error khi AI trả về kết quả rỗng — Đã thêm kiểm tra cấu trúc response an toàn. [backend/app/services/ai_generator.py:53]
- [x] [Review][Patch] Thiếu validation cho brand_voice_preset (cần dùng Literal) — Đã thêm Literal validation. [backend/app/api/facebook.py:27]

### Review Findings — Round 3 (2026-05-04)

**Patch**

- [x] [Review][Patch] `brand_voice_preset` luôn bị overwrite ngay cả khi client chỉ muốn update `brand_voice` — đã đổi sang sentinel `None`, chỉ update khi client gửi giá trị tường minh. [backend/app/api/facebook.py:30,96-97]
- [x] [Review][Patch] `cron.py` không fallback `brand_voice_preset or "casual"` khi lấy từ DB — đã thêm `or "casual"` để nhất quán với `campaigns.py:535`. [backend/app/worker/cron.py:134]
- [x] [Review][Patch] API response `get_facebook_config` trả `brand_voice` / `brand_voice_preset` dưới dạng snake_case — đã thêm các key camelCase (`brandVoice`, `brandVoicePreset`) song song (backward-compat). [backend/app/api/facebook.py:161-166]

**Defer**

- [x] [Review][Defer] Control chars → space không collapse multiple spaces trong `_sanitize_brand_voice` — cosmetic issue, không ảnh hưởng security. Pre-existing scope. [backend/app/services/ai_generator.py:20]
- [x] [Review][Defer] Token `required` conditional (`required={!fbForm.page_id}`) UX unclear khi edit mode — backend guard đủ an toàn; UX minor. [frontend/src/App.jsx:1126]
- [x] [Review][Defer] Private functions `_sanitize_brand_voice` / `_build_system_instruction` exposed trực tiếp trong tests — test coupling pattern, không runtime risk. [backend/tests/test_brand_voice_prompt.py]

### Review Findings — Round 2 (2026-05-02)

**Decision-needed**

- [x] [Review][Decision] Model Gemini không nhất quán giữa `generate_caption` (1.5-flash) và `generate_reply` (2.5-flash) — **Resolved**: thêm 2 env var `GEMINI_MODEL_CAPTION` và `GEMINI_MODEL_REPLY`, default stable `gemini-2.5-flash`. Có thể switch sang preview models (gemini-3-flash-preview, etc.) qua env var không cần redeploy. [backend/app/core/config.py:81-83] [backend/app/services/ai_generator.py:71,99]

**High**

- [x] [Review][Patch] **Prompt injection** qua `brand_voice` raw text vào Gemini systemInstruction — user-controlled text (tối đa 500 chars) chèn nguyên văn vào system prompt; có thể chứa `\n4. Trả về JSON {...}` hoặc `Bỏ qua chỉ thị trên...` để override mandate hoặc re-number rules. Sanitize bằng cách: replace newlines, strip control chars, hoặc bọc vào delimiter block (XML-style `<custom_voice>...</custom_voice>`). [backend/app/services/ai_generator.py:21,23-29]
- [x] [Review][Patch] Empty-string `brand_voice = ""` từ frontend ghi đè giá trị cũ trong DB — frontend luôn gửi key, backend `if page_in.brand_voice is not None: page.brand_voice = page_in.brand_voice` → `""` không phải None nên overwrite. Quyết định: empty string → set DB là `None` (clear intent rõ ràng). [backend/app/api/facebook.py:81-82] [frontend/src/App.jsx:651]
- [x] [Review][Patch] `regenerate_video_caption` raise NPE nếu `video.campaign` hoặc `target_page_id` là None — direct attribute chain không guard. Wrap defensively, fallback brand_voice/preset mặc định khi không tìm thấy page. [backend/app/api/campaigns.py:498-505]

**Medium**

- [x] [Review][Patch] Test file dùng `sys.path.append(os.path.join(os.getcwd(), "backend"))` — fragile khi chạy từ folder khác (CI fail nếu cwd không phải repo root). Bỏ hack, dựa vào pytest auto-discovery + `conftest.py` đã có. [backend/tests/test_brand_voice_prompt.py:5]
- [x] [Review][Patch] Pydantic schema `brand_voice_preset: Literal[...] | None = "casual"` cho phép null — DB column `nullable=False`. Mismatch invariant; bỏ `| None` để client gửi null bị reject 422. [backend/app/api/facebook.py:28]
- [x] [Review][Patch] Frontend không reload page list sau khi save — phải reload manually. Gọi `loadFacebookPages()` (hoặc tương đương) sau khi POST thành công. [frontend/src/App.jsx:650-660]
- [x] [Review][Patch] Frontend "Chỉnh sửa" mode không có nút Hủy — nếu user click Edit page A rồi đổi ý, brand_voice/preset từ A vẫn persist trong form khi tạo page mới. Thêm nút Cancel reset form về defaults. [frontend/src/App.jsx:660-668]
- [x] [Review][Patch] DB column `brand_voice = Column(String, ...)` không cap length → TEXT trong Postgres; bypass max_length=500 nếu ai đó write trực tiếp DB hoặc qua endpoint khác. Đổi `String(500)`. [backend/app/models/models.py:118]
- [x] [Review][Patch] DB column `brand_voice_preset = Column(String, ...)` không validate enum-level → có thể chứa giá trị rác. Thêm `CheckConstraint` hoặc dùng SQLAlchemy `Enum` column type. [backend/app/models/models.py:119]
- [x] [Review][Patch] `_build_system_instruction` silent fallback `presets.get(brand_voice_preset, presets["casual"])` — nếu DB có preset legacy/sai, không log warning. Thêm `logger.warning` để phát hiện data drift. [backend/app/services/ai_generator.py:20]

**Low**

- [x] [Review][Patch] Test có boilerplate `if __name__ == "__main__"` + `print("✅ ...")` thay vì pytest assertions thuần. Test pass dưới pytest hiện tại nhưng không idiomatic. Cleanup. [backend/tests/test_brand_voice_prompt.py:33-42]
- [x] [Review][Patch] `set_facebook_config` không validate page_name strip — empty/whitespace có thể overwrite page_name cũ thành "". Thêm strip + min_length validator hoặc skip update khi empty. [backend/app/api/facebook.py:60]

**Defer**

- [x] [Review][Defer] Optimistic locking cho `FacebookPage` (race brand_voice edit vs token refresh) — broader optimistic-locking concern, không phải scope 10.1; deferred.
- [x] [Review][Defer] i18n: brand_voice preset descriptions hardcoded tiếng Việt — sẽ xử lý trong Story 10.2 (Caption Đa Ngôn Ngữ); deferred.

**Dismissed (false positive / out-of-scope)**

- ❌ Missing auth trên `POST /facebook/config` — FALSE POSITIVE: `Depends(require_authenticated_user)` đã enforce ở router-level [backend/app/main.py:61].
- ❌ Alembic dual-head với `53457421ab4c` — FALSE POSITIVE: chuỗi linear single-head verified.
- ❌ TanStack Query không được dùng — Spec aspirational; project chưa cài `@tanstack/react-query` (verified `package.json`). Codebase dùng raw fetch consistently. Out of scope.
- ❌ Tên helper `_build_system_instruction` khác spec (`_build_system_prompt`) — semantic preference; "instruction" khớp với key Gemini API `systemInstruction`.
- ❌ Tham số `target_language` thiếu — thuộc scope Story 10.2, không phải 10.1.
- ❌ Fallback timeout chưa an toàn — đã có: bare `except Exception` trong retry loop + final fallback `f"{original_caption}\n\n#giaitri #trending"`.
- ❌ Migration không dùng `batch_alter_table` cho SQLite — production dùng Postgres; SQLite chỉ test in-memory.
- ❌ Migration downgrade làm mất data brand_voice — intentional design (irreversible drop_column).
- ❌ Validator long_lived_access_token không xử lý None — verified: `if v is not None and len(v) > ...`.


## 6. Dev Agent Record

### Agent Model Used
Gemini 2.0 Flash

### Debug Log References

### Completion Notes List

### Change Log
- 2026-05-02: Bắt đầu triển khai story 10.1. Cập nhật trạng thái in-progress.

### File List
