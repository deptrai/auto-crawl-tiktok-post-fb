---
stepsCompleted: ['step-01-init.md', 'step-02-context.md', 'step-03-starter.md', 'step-04-decisions.md', 'step-05-patterns.md', 'step-06-structure.md', 'step-07-validation.md', 'step-08-complete.md']
inputDocuments: ['_bmad-output/planning-artifacts/prd.md', '_bmad-output/project-context.md', '_bmad-output/planning-artifacts/epics.md']
workflowType: 'architecture'
project_name: 'auto-crawl-tiktok-post-fb'
user_name: 'luisphan'
lastStep: 8
status: 'complete'
completedAt: '2026-03-30'
phase2AddedAt: '2026-04-05'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
Hệ thống bao gồm 19 yêu cầu tính năng xoay quanh 6 quy trình: cấu hình nguồn/đích, tải video gốc, lập lịch đăng tự động, tự phục hồi lỗi, tương tác webhook Realtime và giám sát. Về mặt kiến trúc, dự án đòi hỏi năng lực xử lý bất đồng bộ cốt lõi (Asynchronous Processing) kết hợp Message/Task Queue đủ mạnh mẽ để vừa hứng sự kiện, vừa xử lý tải ngầm 24/7.

**Non-Functional Requirements:**
- **Reliability:** Đặc biệt khắt khe với MTTR < 5 phút và tự khởi động lại khi dính lỗi Memory (OOM). Yêu cầu thiết kế Container Orchestration tĩnh và Process Management cực kỳ vững chắc.
- **Scalability:** Phải Decouple tuyệt đối luồng Webhook và luồng Worker, cho phép mở rộng ngang (Horizontal Scaling) lên mức tải 1000 requests/phút.
- **Performance:** Bắt buộc phải trả về Webhook Challenge (HTTP 200) dưới 100ms. Load 10.000 log records tại giao diện Admin dưới 2s.
- **Security:** Quản lý nghiêm ngặt Token Meta/Cookie Tiktok tại ổ cứng bằng thuật toán Mã hóa đối xứng (Symmetric Encryption).

**Scale & Complexity:**
- Ngành chính (Primary domain): Backend Data Pipeline & Web Automation.
- Độ phức tạp (Complexity level): Medium-High (Phức tạp về kiến trúc xử lý luồng sự kiện phân tán và quản lý IP/Rate limit).
- Ước tính Components: API Gateway (Webhook Receiver), Task Scheduler/Queue, Worker Nodes, Database, Frontend Admin.

### Technical Constraints & Dependencies

- Giao tiếp Webhook qua **Cloudflare Tunnels**.
- Phụ thuộc sâu vào **Meta Graph API (v18+)** và thư viện cào **yt-dlp** (cùng cơ chế backup `curl-cffi`).
- Giới hạn nghiêm ngặt từ Meta API Rate Limits, bắt buộc áp dụng thuật toán Exponential Backoff và thuật toán Token Bucket phân luồng cho các Worker.

### Cross-Cutting Concerns Identified

- **Error Handling & State Recovery:** Đảm bảo tính nhất quán dữ liệu (Consistency) khi luồng xử lý bị đứt gãy giữa chừng (fail HTTP/Proxy), cho phép Resume không thất thoát Data.
- **Secret Decoupling:** Luồng Worker phải có khả năng lấy và giải mã (decrypt) nhanh chóng Access Token để upload mà không tạo Nút cổ chai (Bottleneck) giật lag CSDL.
- **Resource Management (OOM Prevention):** Quản lý tiến trình (Process) triệt để tránh rò rỉ bộ nhớ từ việc gọi thư viện download video liên tục.

## Starter Template Evaluation

### Primary Technology Domain

Full-stack System (FastAPI Backend + React/Vite Frontend Data Pipeline) dựa trên nhu cầu của một dự án Brownfield.

### Starter Options Considered

Đây là dự án **Brownfield**. Không yêu cầu một cú pháp CLI Starter từ vạch xuất phát. Bộ khung hạ tầng (Baseline Stack) đã được chốt và chứng minh hiệu quả cho luồng tải dữ liệu khốc liệt:
- Luồng Backend Pipeline: **FastAPI + PostgreSQL + Background Worker riêng biệt**
- Luồng Frontend Admin: **React 19 + Vite SPA + Tailwind v4**

### Selected Starter: Existing Brownfield Stack

**Rationale for Selection:**
Vì dự án đang trong quá trình chuẩn hóa (Refactoring) thay vì đập đi xây lại, sự kế thừa khối Backend bất đồng bộ chuyên biệt này (Python Async/APScheduler) là quyết định chính xác nhất. Nó đáp ứng trọn vẹn yêu cầu tách biệt điểm rơi luồng Webhook Meta khỏi luồng tải/trích xuất Video nặng từ TikTok (chống crash dây chuyền).

**Architectural Decisions Provided by Starter:**

**Language & Runtime:**
- Backend: Python 3.10+ (ưu tiên Asyncio Native).
- Frontend: TypeScript/Node.js môi trường ES6+.

**Styling Solution:**
- Web Tailwind CSS v4 (Sử dụng cấu trúc config cực mỏng trên Vite).

**Build Tooling & Infrastructure:**
- Trình đóng gói Frontend: **Vite** mang tới Hot Module Replacement cực căng.
- Container hóa: Sử dụng **Docker Compose** phân rã làm các Service độc lập: `db`, `backend` (API), `worker` (Scheduler), và `frontend`. 

**Testing Framework:**
- Backend: `pytest` chuẩn chỉnh theo hệ sinh thái Python.
- Kiểm thử tích hợp (E2E): Có thể thiết lập cơ bản qua các HTTP Client mô phỏng Meta API Request.

**Code Organization:**
- FastAPI: Quy hoạch theo cấu trúc Module (Routers, Services, Schemas/DTOs, Models tương tác DB, Worker Tasks).
- React: Tính năng bóc tách theo Pages & Components.

**Development Experience:**
- Tự động sinh tài liệu Swagger UI (OpenAPI) từ FastAPI.
- Tunnel Webhook: Cloudflare Tunnels (cloudflared) tích hợp giả lập Meta API webhook ngay trên máy tính local.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Data Layer: PostgreSQL với SQLAlchemy ORM & Alembic migrations
- Asynchronous Engine: APScheduler (v3.11.x) cho background tasks

**Important Decisions (Shape Architecture):**
- API Framework: FastAPI (v0.135.x) cho router và webhook receiver
- Security: Stateless Authentication Protocol (AES-256 Symmetric Encryption cho Tokens)
- Infrastructure: Docker Compose để cô lập Webhook vs Worker

**Deferred Decisions (Post-MVP):**
- Redis/Message Queue chuyên sâu: Hiện tại dùng APScheduler in-memory/DB store để giữ kiến trúc đơn giản, có thể chuyển sang Celery + Redis nếu tải vượt quá 5000 req/min.

### Data Architecture
- **Database:** PostgreSQL (Mã nguồn mở, hỗ trợ JSONB mạnh, tương thích tốt với luồng data bất đồng bộ).
- **ORM & Migrations:** SQLAlchemy (v2.0+) đi kèm Alembic. Hỗ trợ Async driver (`asyncpg`).
- **Data Model:** Chia tách bảng "Users/Accounts" và bảng "Tasks/Scheduled Posts". Trạng thái luồng xử lý (Pending/Success/Error) phải được track theo từng record.

### Authentication & Security
- **Meta Token Storage:** Access Tokens và Tiktok Session Cookies không bao giờ lưu Plaintext. Sử dụng `cryptography` library của Python (Fernet/AES) để mã hóa (Symmetric Encryption).
- **API Security:** Áp dụng JWT hoặc Bearer Token Stateless để chặn các Endpoint trigger crawl thủ công.

### API & Communication Patterns
- **Webhook Receiver:** FastAPI định nghĩa POST endpoints, phản hồi ngay lập tức (Sync/Async return 200 OK) thông qua cơ chế chạy ngầm (BackgroundTasks) trước khi queue.
- **Rate Limit Resilience:** Tích hợp `Tenacity` cho Python để xử lý cấu trúc Exponential Backoff Handling khi gặp HTTP 429 từ Meta API.

### Frontend Architecture
- **Framework:** React 19 + Vite.
- **State Management:** Zustand (quản lý Auth/Settings) + TanStack Query (quản lý Server logic, polling Trạng thái luồng video từ API).
- **Styling:** Tailwind CSS v4.

### Infrastructure & Deployment
- **Local Dev:** Cloudflare Tunnels (`cloudflared`) để public cổng Local cho Meta Webhook bắn Event.
- **Containerization:** Dùng `docker-compose` tách riêng service `api` và `worker`. Hai service này tương tác chung 1 CSDL Postgres.

### Decision Impact Analysis
**Implementation Sequence:**
1. Khởi tạo Database Schema và Migrations & Security Cryptography layer.
2. Xây dựng lõi Webhook Receiver (FastAPI) và Cloudflare config (Mock Meta Event).
3. Thiết lập APScheduler Worker service + Tích hợp `yt-dlp` download logic.
4. Xây dựng Frontend Admin Dashboard (React/Vite) giám sát luồng log.

**Cross-Component Dependencies:**
- Việc Worker giải mã Token sẽ phụ thuộc vào Secret Key (Env Var) đặt chung trên Docker. Cả API/Worker phải đồng nhất Key này. Trang quản trị Frontend sẽ call Webhook API API để trigger các tiến trình. Khối Worker sẽ nhận lệnh này qua CSDL và trả config về CSDL để Frontend hiển thị tiến trình.

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:**
Có 4 điểm nóng lớn nhất dễ làm AI Agent tạo code rác/xung đột: Naming Convention (đặt tên), Response Wrapper (bọc dữ liệu trả về API), DTO Validation (kiểm tra chuẩn Data), và Error Handling (Bắt lỗi luồng Event).

### Naming Patterns

**Database Naming Conventions:**
- **Table names:** Viết chữ thường, định dạng số nhiều (snake_case plural). VD: `users`, `tiktok_channels`, `scheduled_tasks`.
- **Column names:** Viết chữ thường, định dạng snake_case. VD: `user_id`, `created_at`, `video_url`.
- **Foreign Keys:** Luôn mang hậu tố `_id`. VD: `channel_id`.

**API Naming Conventions:**
- **REST endpoints:** Kebab-case, danh từ số nhiều. VD: `GET /api/v1/tiktok-channels`, `POST /api/v1/tasks/{task_id}/retry`.
- **API File Router:** Đặt theo tài nguyên gốc, snake_case. VD: `channel_router.py`.

**Code Naming Conventions:**
- Python (FastAPI): `snake_case` cho variables/functions. `PascalCase` cho Classes (Pydantic Models/SQLAlchemy Models).
- TypeScript (React): `camelCase` cho variable/functions. `PascalCase` cho Components/Interfaces. Đuôi file React component phải là `.tsx`.

### Structure Patterns

**Project Organization:**
- FastAPI: Code chia theo `Routers`, `Services`, `Schemas` (DTOs), và `Models`.
- React: Code chia theo `features/` pattern. Thay vì gom hết file actions vào 1 rổ, ta gom theo luồng (VD: `src/features/dashboard/components/`).

### Format Patterns

**API Response Formats:**
Toàn bộ API trả về từ Backend bọc trong chuẩn sau:
- Thành công: `{"data": <payload>, "message": "Success", "meta": {...}}`
- Thất bại: Cấm ném lỗi Error thuần. Phải bọc trong `{"error": {"code": "HTTP_XXX", "message": "Chi tiết lỗi"}}`.

**Data Exchange Formats:**
- Backend thao tác Database bằng `snake_case`, nhưng khi Pydantic serialize ném ra ngoài JSON Client, tự động alias sang `camelCase` để JS/TS Frontend tiêu thụ mượt mà.

### Communication Patterns

**Webhook Events:**
- Endpoint nhận Webhook luôn chốt cứng ở `/api/v1/webhooks/{provider}`. 
- Ngay khi vào Router, Validation chạy xong là lập tức trả `return {"status": "received"}` (HTTP 200) trước, sau đó đẩy data vào BackgroundTasks để xử lý thật.

**State Management (Frontend):**
- Quản lý Server State (Network data): Tuyệt đối dùng hook `useQuery` và `useMutation` từ TanStack Query, không dùng `useEffect` kết hợp `useState` thuần.

### Process Patterns

**Error Handling & Retry:**
- Lỗi từ Meta API (Rate limit HTTP 429): Sử dụng thư viện `tenacity` với decoractor `@retry(wait=wait_exponential(multiplier=1, max=10))`.
- Bất kì lỗi OOM Exception nào cũng phải được bubble-up ra log file mà không Crash container (nhờ container restart policy tĩnh).

### Enforcement Guidelines

**All AI Agents MUST:**
- KHÔNG BAO GIỜ tự sáng tạo ra định dạng Schema JSON API riêng.
- LUÔN chạy Validation dữ liệu ngay tại rìa (Pydantic cho Backend, Zod cho Frontend).
- Đọc file `database/models.py` trước khi thực hiện thêm logic vào service files để hiểu cấu trúc quan hệ.

### Pattern Examples

**Good Examples (React API Call):**
```typescript
const { data: channels } = useQuery({ queryKey: ['channels'], queryFn: fetchChannels });
```

**Anti-Patterns (Avoid):**
```python
# SAI: Agent trả thẳng Data List không bọc (Anti-pattern)
@router.get("/channels")
def get_channels():
    return [{"id": 1, "name": "Tiktok 1"}]
```

## Project Structure & Boundaries

### Complete Project Directory Structure

```text
auto-crawl-tiktok-post-fb/
├── docker-compose.yml
├── .env.example
├── README.md
├── backend/
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/
│   │   └── ...
│   ├── app/
│   │   ├── main.py (FastAPI Lifespan logic - Điểm khởi chạy)
│   │   ├── core/
│   │   │   ├── config.py
│   │   │   └── security.py (Lõi giải mã token Symmetric Encryption AES-256)
│   │   ├── api/
│   │   │   └── v1/
│   │   │       ├── webhooks.py (Endpoints hứng Pings từ Meta)
│   │   │       ├── channels.py (Admin API)
│   │   │       └── tasks.py
│   │   ├── models/ (SQLAlchemy Declarative Base)
│   │   │   ├── channel.py
│   │   │   └── video_task.py
│   │   ├── schemas/ (Pydantic DTOs để Validation hai chiều)
│   │   ├── services/
│   │   │   └── meta_graph_service.py (Chứa Retry/Exponential Backoff logic)
│   │   └── worker/
│   │       ├── scheduler.py (Nơi thiết lập APScheduler)
│   │       └── jobs/
│   │           └── downloader.py (Wrapper thực thi yt-dlp down clip)
│   └── tests/
│       └── api/
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── core/
        │   ├── api.ts (Cấu hình Axios + Interceptors)
        │   └── queryClient.ts (Cấu hình bộ nhớ đệm TanStack Query)
        ├── features/
        │   ├── channels/
        │   │   ├── components/
        │   │   └── api/ (TanStack Hooks để call API)
        │   └── tasks-dashboard/
        └── components/
            └── ui/ (Shadcn/Tailwind component tái sử dụng)
```

### Architectural Boundaries

**API Boundaries:**
- **External Boundaries:** Endpoint `/api/v1/webhooks/meta` sẽ hoàn toàn mở (chạy qua Cloudflare Tunnels), chỉ xác thực bằng thuật toán `Meta Hub Signature` nội bộ.
- **Internal Admin Boundaries:** Mọi route còn lại (Frontend gọi), phải đính kèm Stateless Token trong Request Header.

**Component Boundaries (Frontend):**
- Thư mục thuộc module `features/channels` cấm không được import trực tiếp Component của `features/tasks-dashboard`. Nếu dùng chung, chúng phải được chắt xuất và thả vào `src/components/ui`.

**Service Boundaries (Backend - Critical):**
- **Webhook vs Worker:** Webhook Receiver tuyệt đối KHÔNG ĐƯỢC gọi code chạy task của hệ Worker trực tiếp (gây Crash Router). Webhook hoặc API chỉ chèn/thay đổi trạng thái Database thành `Pending`. Worker tự động tick (polling) CSDL và nhấc công việc lên xử lý ẩn.

### Requirements to Structure Mapping

**Feature Mapping:**
- **FR1, FR2, FR3 (Cấu hình Nguồn/Đích):**
  - Backend: `backend/app/api/v1/channels.py`, `backend/app/models/channel.py`
  - Frontend: `frontend/src/features/channels/`
- **FR4 - FR10 (Cào dữ liệu & Phân phối):** 
  - Backend Task: `backend/app/worker/jobs/downloader.py`
- **FR15 - FR16 (Giao tiếp Thời gian thực):**
  - Backend: `backend/app/api/v1/webhooks.py`

**Cross-Cutting Concerns:**
- **Bảo mật Secret Token (Encryption at Rest):** Toàn bộ logic giải/mã hóa được bọc độc quyền tại `backend/app/core/security.py`. Cả Webhook lẫn Worker khi cần thao tác Meta Token (lên cơ sở dữ liệu) đều phải chạy qua hàm trong thư mục này.

### File Organization Patterns

**Configuration Files:**
- Biến môi trường hệ thống bọc gọn tại file `.env` ở root dir, sau đó `docker-compose.yml` sẽ truyền (passthrough) vào trong từng Container tương ứng.

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
Toàn bộ Stack công nghệ (FastAPI, React 19, PostgreSQL, APScheduler) tương thích chéo 100%. Không có nút thắt cổ chai nào xuất hiện nhờ thiết kế Decoupled Architecture phân tách rành mạch khối xử lý I/O Webhook và khối CPU-bound Worker.

**Pattern Consistency:**
Các quy chuẩn Naming (đặt tên), Response Formatting (bọc API), Error Handling (bắt lỗi) được định nghĩa đủ khắt khe nhưng không gây cản trở tốc độ code. Logic giải nén Token Meta được quy hoạch vào đúng một nốt thắt (`core.security`) để chống phân mảnh mã nguồn.

**Structure Alignment:**
Sơ đồ hệ thống thư mục (Project Structure) phản ánh đúng ranh giới của các luồng tính năng, tuân thủ đúng kiến trúc Module của FastAPI và Feature-Sliced của React.

### Requirements Coverage Validation ✅

**Feature Coverage:**
19 FRs được rải đều và kiểm soát toàn diện:
- FR1-FR3 (Admin/Dashboard): Nằm gọn trong khối Backend API & Frontend UI.
- FR4-FR10 (Cào data/Lập lịch): Do khối APScheduler Worker bao thầu.
- FR15-FR16 (Giao tiếp Facebook Realtime): Đã cấu hình Cloudflare Tunnels hứng ping webhook.

**Non-Functional Requirements Coverage:**
- **Reliability:** Chốt cứng Restart Policy và Rate Limit Resilience qua kịch bản Exponential Backoff.
- **Security:** Token bọc Fernet mã hóa đối xứng trước khi cho vào Database.

### Implementation Readiness Validation ✅

**Decision Completeness:**
Đã chốt phiên bản cụ thể của các hệ sinh thái (FastAPI v0.135+, APScheduler v3.11+, React 19). Không có quyết định cốt lõi nào bị trì hoãn (Blocked) hay thiếu chi tiết thực thi.

**Structure & Pattern Completeness:**
Tài liệu cung cấp cả ví dụ (Examples) và cảnh báo code rác (Anti-patterns) cho các Agents làm việc phía sau.

### Gap Analysis Results
- **Minor Gap:** Không có module Logging tập trung (VD: ELK hoặc Datadog). 
- **Resolution:** Tạm hoãn. Đã chốt ở MVPs rằng ghi Log thẳng ra File/Console và tận dụng luồng UI Read Database là đủ cho quy quy mô B2B Automation này.

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**✅ Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**✅ Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**✅ Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION
**Confidence Level:** HIGH

**Key Strengths:**
- Mô hình decoupled hoàn hảo giúp chặn đứng hiệu ứng Domino (khi 1 Video chết làm chết chùm hệ thống).
- Luồng bảo mật mã hóa Access Token tích hợp sẵn.
- Trải nghiệm code (DX) cao với FastAPI Swagger tự động hoá.

**Areas for Future Enhancement:**
- Bổ sung Message Queue cồng kềnh hơn (Celery/Redis) nếu luồng Worker tăng từ hàng nghìn lên hàng chục nghìn.

### Implementation Handoff

**AI Agent Guidelines:**
- Tuân thủ chính xác các Quy chuẩn Kiến trúc tại văn bản này. Không tự ý sáng tạo.
- Giữ vững các đường biên (Component boundaries) và cách thức bọc dữ liệu (Data formats).
- Nếu gặp khúc mắc, đối chiếu lại quyết định Kiến trúc này trước khi code lụi.

**First Implementation Priority:**
Cấu hình Docker Compose để thông các luồng Services và dựng Backend Schema DB (SQLAlchemy) kết nối Alembic Migration.

## Phase 2 Architecture Addendum

_Bổ sung ngày 2026-04-05. Mở rộng kiến trúc Phase 1 cho Epic 7-14._

### Phase 2 Context & Scope

**Bài học từ Phase 1 vận hành thực tế:**
- Token Facebook Graph API Explorer hết hạn sau ~2 giờ — gây gián đoạn liên tục (Gap G1)
- Video lưu local disk mất khi container restart (Gap G3)
- Không có lớp lọc nội dung — tải cả video spam/chất lượng thấp (Gap G4)
- yt-dlp bị TikTok block IP → đã giải quyết bằng Apify (Epic 6)
- Single-admin, không phân quyền chi tiết

**Nguyên tắc mở rộng Phase 2:**
1. **Backward Compatible** — Mọi thay đổi phải tương thích ngược, không break Phase 1 flow
2. **Strategy Pattern** — Abstract hóa các điểm mở rộng (storage, publisher, crawler) bằng interface
3. **Progressive Enhancement** — Mỗi epic có thể deploy độc lập, không phụ thuộc epic khác
4. **Config-Driven** — Tính năng mới bật/tắt qua environment variables hoặc RuntimeSetting

### D1: Crawler Architecture (Epic 6 — Đã Implement)

**Quyết định:** Dual-mode crawler với auto-fallback.

**Pattern: Strategy + Fallback Chain**
```python
# tiktok_crawler.py — Unified interface
def extract_metadata(url: str) -> dict:
    mode = settings.TIKTOK_CRAWLER_MODE  # "auto" | "apify" | "ytdlp"
    if mode == "auto" and settings.APIFY_API_TOKEN:
        try: return _extract_via_apify(url)
        except: return _extract_via_ytdlp(url)  # fallback
    elif mode == "apify": return _extract_via_apify(url)
    else: return _extract_via_ytdlp(url)
```

**Apify Actor Support:**
- `clockworks/tiktok-scraper` — profile, hashtag, postURLs; `shouldDownloadVideos=True` trả `mediaUrls[]` (Apify KV store URLs cần Bearer auth)
- `kingscraper/tiktok-video-and-thumbnail-downloader` — videoUrls array; trả `noWatermarkHdUrl`
- Auto-detect actor type qua `_is_clockworks_actor()` helper

**Config vars:** `APIFY_API_TOKEN`, `APIFY_ACTOR_ID`, `TIKTOK_CRAWLER_MODE`

### D2: Token Lifecycle Architecture (Epic 7)

**Vấn đề:** Facebook token có 3 loại với lifecycle khác nhau:
- **Short-lived User Token** (~2h) — Graph API Explorer, KHÔNG dùng cho production
- **Long-lived User Token** (~60 ngày) — Có thể auto-refresh
- **System User Token** (không hết hạn) — Khuyên dùng cho production

**Quyết định kiến trúc:**

**Schema mở rộng — `facebook_pages` table:**
```
+ token_type: Enum("short_lived", "long_lived", "system_user") DEFAULT "long_lived"
+ token_expires_at: DateTime NULLABLE
+ token_last_refreshed_at: DateTime NULLABLE
+ token_refresh_error: String NULLABLE
```

**Token Monitor Service — `token_lifecycle_service.py`:**
```
Responsibility:
  - check_token_health(page_id) → TokenStatus (valid/expiring_soon/expired/unknown)
  - refresh_long_lived_token(page_id) → bool
  - get_token_expiry_info(page_id) → {type, expires_at, days_remaining}

Trigger:
  - APScheduler cron job mỗi 24h gọi check_all_tokens()
  - Nếu token_type="long_lived" AND expires_in < 7 ngày → auto refresh
  - Nếu refresh fail HOẶC token đã hết hạn → ghi SystemEvent(level="warning")
  - Nếu token hết hạn → auto-pause campaigns dùng page đó
```

**Graph API refresh endpoint:**
```
GET /oauth/access_token?grant_type=fb_exchange_token
  &client_id={APP_ID}
  &client_secret={APP_SECRET}
  &fb_exchange_token={CURRENT_TOKEN}
→ Trả về token mới (60 ngày nữa)
```

**UI Integration:**
- Badge trên FacebookPage card: xanh Valid | vàng Expiring Soon (< 14 ngày) | đỏ Expired
- Banner alert toàn dashboard khi có page token hết hạn
- Hướng dẫn in-app tạo System User Token (link Business Manager)

**Config vars mới:** `FB_APP_ID`, `FB_APP_SECRET` (cần cho token refresh flow)

### D3: Storage Abstraction Architecture (Epic 8)

**Quyết định:** Strategy Pattern cho storage backend, default = local (backward compatible).

**Interface:**
```python
# storage_backend.py
class StorageBackend(Protocol):
    def save(self, local_path: str, remote_key: str) -> str: ...  # returns stored URL/path
    def delete(self, stored_path: str) -> bool: ...
    def exists(self, stored_path: str) -> bool: ...
    def get_url(self, stored_path: str) -> str: ...  # presigned URL hoặc local path

class LocalStorage(StorageBackend): ...      # Hiện tại, giữ nguyên logic
class S3Storage(StorageBackend): ...          # boto3 — S3/R2/MinIO compatible
```

**Factory:**
```python
def get_storage() -> StorageBackend:
    if settings.STORAGE_BACKEND == "s3":
        return S3Storage(bucket=settings.S3_BUCKET, ...)
    return LocalStorage(download_dir=settings.DOWNLOAD_DIR)
```

**Video file_path convention:**
- Local: `./downloads/tiktok_abc123.mp4` (giữ nguyên Phase 1)
- S3: `s3://bucket/videos/2026/04/tiktok_abc123.mp4` (key có date prefix)

**Cleanup Job:**
- APScheduler cron mỗi 6h
- Query: `Video.status IN (posted, published) AND publish_time < now - 24h AND file_path IS NOT NULL`
- Gọi `storage.delete(file_path)`, set `file_path = NULL`
- Không xóa nếu video đang trong retry queue

**Config vars mới:** `STORAGE_BACKEND` (local|s3), `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT_URL` (cho R2/MinIO)

### D4: Content Pipeline Architecture (Epic 9)

**Quyết định:** Chain of Responsibility pattern cho content filtering.

**Pipeline Flow:**
```
Apify/yt-dlp entries
  → QualityFilter (min_views, min_likes)
  → KeywordFilter (blocklist, allowlist)
  → DeduplicationFilter (cross-campaign per page)
  → Accepted entries → tạo Video record
```

**Schema mở rộng — `campaigns` table:**
```
+ filter_min_views: Integer DEFAULT 0         (0 = không lọc)
+ filter_min_likes: Integer DEFAULT 0
+ filter_blocklist_keywords: JSON DEFAULT []   (array of strings)
+ filter_allowlist_hashtags: JSON DEFAULT []   (array of strings, rỗng = cho phép tất cả)
```

**Filter Service — `content_filter.py`:**
```python
class ContentFilter(Protocol):
    def apply(self, entry: dict, campaign: Campaign) -> FilterResult: ...

class FilterResult:
    accepted: bool
    reason: str | None  # "min_views_not_met", "blocklist_match:spam", etc.

# Chain execution
filters = [QualityFilter(), KeywordFilter(), CrossCampaignDedup(db)]
for f in filters:
    result = f.apply(entry, campaign)
    if not result.accepted:
        log_filtered(entry, result.reason)
        break
```

**Cross-Campaign Dedup Logic:**
```sql
-- Kiểm tra video đã posted trên cùng target_page
SELECT 1 FROM videos v
JOIN campaigns c ON v.campaign_id = c.id
WHERE c.target_page_id = :page_id
  AND v.original_id = :original_id
  AND v.status = 'posted'
LIMIT 1
```

### D5: AI Caption Architecture (Epic 10)

**Quyết định:** Mở rộng Gemini integration hiện tại, không thay thế.

**Schema mở rộng:**
```
facebook_pages:
  + brand_voice: String NULLABLE          # Custom prompt cho Gemini
  + brand_voice_preset: String DEFAULT "casual"  # professional|casual|gen-z|corporate|viral

campaigns:
  + caption_language: String DEFAULT "auto"  # vi|en|auto
  + hashtag_optimization: Boolean DEFAULT false
```

**AI Generator Enhancement — `ai_generator.py`:**
```python
def generate_caption(
    original_caption: str,
    brand_voice: str | None = None,
    brand_voice_preset: str = "casual",
    target_language: str = "auto",
    optimize_hashtags: bool = False,
) -> str:
    system_prompt = _build_system_prompt(brand_voice, brand_voice_preset, target_language)
    caption = gemini_response
    if optimize_hashtags:
        caption = _merge_hashtags(caption, original_caption, max_total=30)
    return caption
```

**Brand Voice Presets:**

| Preset | System Prompt Direction |
|--------|----------------------|
| professional | Formal, informative, dùng từ ngữ chuyên nghiệp |
| casual | Thân thiện, gần gũi, dùng ngôn ngữ đời thường |
| gen-z | Trendy, dùng emoji, slang, ngôn ngữ Gen Z |
| corporate | Doanh nghiệp, chỉn chu, tập trung giá trị thương hiệu |
| viral | Gây tò mò, hook mạnh, CTA rõ ràng |

### D6: Multi-Platform Publisher Architecture (Epic 12)

**Quyết định:** Publisher Interface với Strategy Pattern.

**Interface:**
```python
# publisher_interface.py
class VideoPublisher(Protocol):
    platform: str
    def upload(self, video: Video, access_token: str, caption: str) -> PublishResult: ...
    def get_post_url(self, post_id: str) -> str: ...

class PublishResult:
    success: bool
    post_id: str | None
    platform: str
    error: str | None

class FacebookReelsPublisher(VideoPublisher): ...   # Hiện tại — fb_graph.py
class YouTubeShortsPublisher(VideoPublisher): ...    # YouTube Data API v3
class InstagramReelsPublisher(VideoPublisher): ...   # Instagram Graph API
```

**Schema mở rộng — Hỗ trợ multi-platform mapping:**
```
campaigns:
  + target_platforms: JSON DEFAULT ["facebook"]   # ["facebook", "youtube", "instagram"]

-- Bảng mới cho YouTube/Instagram credentials (tương tự facebook_pages)
platform_accounts:
  id: UUID PK
  platform: Enum("youtube", "instagram")
  account_id: String UNIQUE
  account_name: String
  access_token: String (encrypted)
  refresh_token: String NULLABLE (encrypted)
  token_expires_at: DateTime NULLABLE
  created_at, updated_at
```

**Dispatcher:**
```python
def publish_video(video: Video, campaign: Campaign):
    for platform in campaign.target_platforms:
        publisher = get_publisher(platform)  # Factory
        credentials = get_credentials(platform, campaign)
        result = publisher.upload(video, credentials.token, caption)
        save_publish_result(video, result)
```

### D7: Multi-Source Crawler Architecture (Epic 13)

**Quyết định:** Mở rộng Strategy Pattern từ D1 cho nhiều source platforms.

**Interface:**
```python
# crawler_interface.py
class ContentCrawler(Protocol):
    platform: str
    def extract_metadata(self, source_url: str) -> dict: ...
    def download_video(self, url: str, prefix: str) -> tuple[str|None, str|None]: ...

class TikTokCrawler(ContentCrawler): ...     # Hiện tại — tiktok_crawler.py (Apify + yt-dlp)
class YouTubeCrawler(ContentCrawler): ...     # yt-dlp (YouTube không block)
class InstagramCrawler(ContentCrawler): ...   # Apify Instagram Scraper actor
```

**Auto-detect source platform:**
```python
def detect_platform(url: str) -> str:
    if "tiktok.com" in url: return "tiktok"
    if "youtube.com" in url or "youtu.be" in url: return "youtube"
    if "instagram.com" in url: return "instagram"
    raise ValueError(f"Unsupported source URL: {url}")
```

### D8: RBAC & Multi-Tenant Architecture (Epic 14)

**Quyết định:** Mở rộng User model hiện tại, thêm Organization layer.

**Schema mở rộng:**
```
-- Bảng mới
organizations:
  id: UUID PK
  name: String
  slug: String UNIQUE     # URL-safe identifier
  created_at, updated_at

-- Mở rộng users table
users:
  + organization_id: UUID FK → organizations.id NULLABLE
  + role: Enum("owner", "editor", "viewer")  # Mở rộng từ admin/operator

-- Thêm org_id vào các bảng chính
campaigns:      + organization_id: UUID FK
facebook_pages: + organization_id: UUID FK
```

**Permission Matrix:**

| Action | Owner | Editor | Viewer |
|--------|-------|--------|--------|
| View campaigns | Yes | Yes | Yes |
| Create/edit campaign | Yes | Yes | No |
| Delete campaign | Yes | No | No |
| View access tokens | Yes | No | No |
| Manage users | Yes | No | No |
| System settings | Yes | No | No |

**Data Isolation:**
- Mọi query phải filter theo `organization_id` từ JWT claims
- Middleware inject `current_org_id` vào request context
- Super Admin (organization_id = NULL) có thể switch organizations

### D9: Analytics Data Model (Epic 11)

**Schema mới:**
```
video_metrics:
  id: UUID PK
  video_id: UUID FK → videos.id
  fb_post_id: String INDEX
  views: Integer DEFAULT 0
  likes: Integer DEFAULT 0
  comments: Integer DEFAULT 0
  shares: Integer DEFAULT 0
  reach: Integer DEFAULT 0
  fetched_at: DateTime     # Timestamp khi fetch metrics
  created_at: DateTime

  INDEX: (video_id, fetched_at)  # Time-series queries
```

**Metrics Collector Job:**
```
APScheduler cron mỗi 6h:
  1. Query videos WHERE status = 'posted' AND fb_post_id IS NOT NULL
  2. Batch Graph API calls: GET /{fb_post_id}?fields=likes.summary(true),comments.summary(true),shares
  3. Upsert vào video_metrics (append, không overwrite — time-series)
  4. Rate limit: max 200 API calls/hour (Graph API limit)
```

**Dashboard Aggregation Queries:**
```sql
-- Campaign performance summary
SELECT c.name, COUNT(v.id) as total_videos,
  SUM(vm.views) as total_views, SUM(vm.likes) as total_likes,
  AVG(vm.likes::float / NULLIF(vm.views, 0)) as avg_engagement_rate
FROM campaigns c
JOIN videos v ON v.campaign_id = c.id
JOIN LATERAL (
  SELECT * FROM video_metrics WHERE video_id = v.id ORDER BY fetched_at DESC LIMIT 1
) vm ON true
GROUP BY c.id
```

### Phase 2 Project Structure Updates

```text
backend/app/
├── services/
│   ├── token_lifecycle.py        # NEW — Epic 7
│   ├── storage_backend.py        # NEW — Epic 8
│   ├── content_filter.py         # NEW — Epic 9
│   ├── crawler_interface.py      # NEW — Epic 13 (refactor tiktok_crawler)
│   ├── publisher_interface.py    # NEW — Epic 12 (refactor fb_graph)
│   ├── youtube_publisher.py      # NEW — Epic 12
│   ├── instagram_publisher.py    # NEW — Epic 12
│   ├── youtube_crawler.py        # NEW — Epic 13
│   ├── instagram_crawler.py      # NEW — Epic 13
│   ├── metrics_collector.py      # NEW — Epic 11
│   └── (existing services unchanged)
├── models/
│   └── models.py                 # EXTEND — thêm Organization, PlatformAccount, VideoMetrics
├── api/
│   ├── analytics.py              # NEW — Epic 11
│   ├── organizations.py          # NEW — Epic 14
│   └── (existing routers unchanged)
└── worker/
    └── cron.py                   # EXTEND — thêm token_check_job, cleanup_job, metrics_job
```

### Phase 2 Implementation Sequence

```
Sprint 1 (Epic 7): Token Lifecycle
  → Alembic migration: facebook_pages + token fields
  → token_lifecycle_service.py
  → APScheduler cron: token_check_job
  → UI: token status badges + alert banner

Sprint 2 (Epic 9): Content Curation
  → Alembic migration: campaigns + filter fields
  → content_filter.py (3 filter classes)
  → Integrate vào sync_campaign_content()
  → UI: filter config per campaign

Sprint 3 (Epic 8 + 10): Storage + AI Caption
  → storage_backend.py + S3Storage class
  → Alembic migration: facebook_pages + brand_voice; campaigns + caption_language
  → Enhance ai_generator.py
  → APScheduler cron: cleanup_job

Sprint 4 (Epic 11): Analytics
  → Alembic migration: video_metrics table
  → metrics_collector.py
  → analytics.py router
  → UI: analytics dashboard tab

Sprint 5 (Epic 12 + 13): Multi-Platform
  → publisher_interface.py + youtube/instagram publishers
  → crawler_interface.py + youtube/instagram crawlers
  → Alembic migration: platform_accounts, campaigns.target_platforms

Sprint 6 (Epic 14): Multi-Tenant
  → Alembic migration: organizations table, FK additions
  → RBAC middleware
  → organizations.py router
  → Data isolation layer
```

### Phase 2 Validation Checklist

- [x] Backward compatible — tất cả tính năng Phase 1 không bị ảnh hưởng
- [x] Progressive enhancement — mỗi epic deploy độc lập
- [x] Config-driven — tính năng mới bật/tắt qua env vars
- [x] Strategy Pattern — storage, publisher, crawler đều có interface rõ ràng
- [x] Database migrations — mọi schema change qua Alembic, không break existing data
- [x] Security maintained — token mới mã hóa AES-256, RBAC check mọi endpoint
