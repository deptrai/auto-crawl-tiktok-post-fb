---
project_name: 'auto-crawl-tiktok-post-fb'
user_name: 'Luisphan'
date: '2026-03-29'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
rule_count: 24
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

- **Backend:** Python, FastAPI (0.104.1), Uvicorn (0.24.0.post1), SQLAlchemy (2.0.43).
- **Database:** PostgreSQL (asyncpg 0.29.0), Alembic (1.16.4) cho database migrations.
- **Frontend:** React (19.2.4), Vite (8.0.1), Tailwind CSS v4 (4.2.2) với PostCSS.
- **Background Jobs:** APScheduler (3.10.4) cho dedicated worker role.
- **Infrastructure:** Docker & Docker Compose, Cloudflare Tunnel.

## Critical Implementation Rules

### Language-Specific Rules

- **Python Imports:** Sử dụng absolute imports từ root module (`from app.x import y`). KHÔNG dùng relative imports.
- **FastAPI Routing/Auth:** Quản lý bảo mật qua `dependencies=[Depends(...)]` ở mức router, không lặp lại auth logic trong từng handler.
- **Frontend ESLint:** Dự án dùng chuẩn Flat Config ESLint v9 (`eslint.config.js`). Cấm tự tạo `.eslintrc`.
- **Tailwind CSS v4:** Sử dụng cấu trúc `@theme` qua PostCSS, không dùng cấu hình v3 cũ.

### Framework-Specific Rules

- **Background Jobs:** Tách biệt triệt để API và Worker (`APP_ROLE=api` hoặc `worker`). Không chạy logic nặng/chặn luồng trên API.
- **SQLAlchemy Schema:** Alembic (`alembic upgrade head`) là nguồn chân lý cho migration production. `Base.metadata.create_all` ở `main.py` chỉ là fallback cục bộ.
- **Vite & React 19:** Không cài bundler config ngoài; mọi cấu hình đưa vào `vite.config.js`. Tối đa hóa việc dùng hooks nguyên bản của React 19.

### Testing Rules

- **Backend (Pytest):** Mọi file test vào `tests/` hoặc dùng prefix `test_*.py`. Database test phải tự động rollback (giao dịch an toàn).
- **Frontend Testing:** Chưa có setup báo sẵn. Chỉ tạo test nếu đã cấu hình Vitest.
- **Verification Scripts:** Luôn bảo trì/cập nhật `verification_*.py` khi đổi cấu trúc Webhook hoặc AI.
- **⚠️ Phase 3 backend test PHẢI dùng PostgreSQL thật + Alembic migration thật.** Phase 3 dùng Postgres-specific feature (schema namespace `phase3`, `search_path`, UUID, FK cross-schema, `server_default`). SQLite KHÔNG mô phỏng được — test SQLite cho Phase 3 = false confidence. Dùng testcontainers hoặc PG test DB; chạy `alembic upgrade head` thay vì `Base.metadata.create_all`. TUYỆT ĐỐI KHÔNG nhồi SQLite ATTACH/schema-translate logic vào production `app/core/database.py` để lách test — đó là production pollution. Test fidelity đạt qua test infra, không qua production hook.

### Code Quality & Style Rules

- **Code Organization:** Tuân thủ chuẩn chia lớp (Layered). Logic nghiệp vụ CHỈ nằm ở `services/`. Thư mục `api/` chỉ parse request/validate model rồi gọi service.
- **Linter Rules:** Backend code Python PEP8 kèm Type Hints bắt buộc cho arguments/return type. Frontend tuân thủ ESLint, cấm vô hiệu hóa linter rules trong React Hooks bừa bãi.
- **Naming Conventions:** `snake_case` cho Python vars/funcs, `PascalCase` cho Python Classes. `PascalCase` cho file React Components và hàm, `camelCase` cho biến cục bộ.

### Development Workflow Rules

- **Docker Compose:** Ưu tiên luồng Containerized (`docker-compose build`). Đừng lock các native packages vào môi trường OS mà không tính tới `Dockerfile`.
- **Commit Messages:** Dùng chuẩn Conventional Commits (`feat:`, `fix:`, `refactor:`).
- **Port & Tunnels:** Cloudflare Tunnel (`social_tunnel`) gắn liền với webhook callbacks. Cấm đổi cấu hình cổng proxy trừ khi có review.

### Critical Don't-Miss Rules

- **Ngoại lệ I/O Nghẽn (Anti-Pattern):** BẤT KỲ lệnh gọi API ngoại vi nào (TikTok, Facebook, curl, yt-dlp) ĐỀU PHẢI bọc trong `try-except`. Rate-Limit hay IP-Block có thể làm crash toàn worker nếu thiếu bắt lỗi.
- **Edge Case Webhooks:** API nghe sự kiện từ Meta/Facebook PHẢI return `HTTP 200` ngay lập tức trước khi phân bổ logic nặng (nếu không Meta sẽ dội bom retry spam).
- **Security & Tokens:** Mã hóa hoặc ẩn dữ liệu nhạy cảm bằng `TOKEN_ENCRYPTION_SECRET`. Bất cấm in log các access tokens của Facebook/TikTok ra console. Clean data token trước khi return REST API JSON.

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review quarterly for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-03-29
