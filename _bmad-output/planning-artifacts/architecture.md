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
phase3AddedAt: '2026-06-01'
phase3StepsCompleted: ['step-02-context.md', 'step-03-starter.md', 'step-04-decisions.md', 'step-05-patterns.md', 'step-06-structure.md', 'step-07-validation.md', 'step-08-complete.md']
phase3Status: 'complete'
phase3CompletedAt: '2026-06-01'
phase3ReadinessStatus: 'READY_FOR_IMPLEMENTATION'
phase3Status: 'in-progress'
phase3Model: 'desktop-first-electron'
checkpointSolverAddedAt: '2026-06-04'
checkpointSolverStatus: 'documented'
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

---

## Phase 3 Architecture Addendum — Facebook Cookie-Based Automation

> **Status:** Draft in progress (step-02 complete) — Desktop-First Distribution Model
> **Created:** 2026-06-01
> **Scope:** Port functionality of `automation-facebook/SST_TOOL_FB` C# tool + extend với mass comment/react/share/friend request. Distribute as licensed Electron desktop app.

### Phase 3 Context & Scope

#### Distribution Model Decision

Phase 3 KHÔNG phải SaaS như Phase 1+2. Phase 3 là **desktop application + thin cloud companion**, distributed theo model **time-based license key** (admin set N ngày).

**Lý do (first principles validated 2026-06-01):**
- Industry validation: AdsPower, MultiLogin, GoLogin, Dolphin{anty}, tool C# nguồn đều dùng model này
- Compliance liability shift: user là operator, bạn là tool vendor (giống Adobe/JetBrains)
- Stealth quality cao hơn: fingerprint thật của user + residential IP thật
- Infra cost: từ $230-1100/tháng (SaaS model) → $5-20/tháng (license server only)
- Phase 1+2 SaaS được bảo vệ — không bị liability spillover

#### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│ User's Desktop                                       │
│ ┌─────────────────────────────────────────────────┐│
│ │ Electron App (Phase 3 Client)                    ││
│ │ ├─ React UI (manage profiles, plan campaigns)    ││
│ │ ├─ Local DB (SQLite encrypted + safeStorage)     ││
│ │ ├─ Playwright + stealth (Node)                   ││
│ │ ├─ Bundled Chromium                              ││
│ │ ├─ Proxy client (3 provider)                     ││
│ │ ├─ State machine (automation_jobs local)         ││
│ │ ├─ Scheduler (local cron)                        ││
│ │ └─ Telemetry agent (mandatory beacon + opt-in)   ││
│ └─────────────────┬───────────────────────────────┘│
└───────────────────┼─────────────────────────────────┘
                    │ HTTPS
                    ▼
        ┌────────────────────────────────┐
        │ Thin Cloud Companion           │
        │ (FastAPI backend extension)    │
        │ ├─ License management          │
        │ │  - Admin tạo key + set days  │
        │ │  - User activate, HWID bind  │
        │ │  - Per-action token (tier 2+)│
        │ ├─ Selector config push (Ed25519 signed)│
        │ ├─ Auto-update (electron-updater)│
        │ ├─ Account portal (web)        │
        │ └─ Telemetry sink              │
        └────────────────────────────────┘

Phase 1+2 (SaaS TikTok→FB Reels Graph API) chạy SONG SONG, độc lập.
Share: backend auth + user table.
Tách: business logic, deployment, billing entity.
```

#### Requirements Overview

**Target user:** Cá nhân (affiliate marketer, content creator, small operator). KHÔNG phải agency/enterprise.

**Functional Requirements:**

| FR-ID | Capability | Sub-phase |
|---|---|---|
| FR-P3-01 | Profile CRUD local + import bulk format `uid\|pass\|2fa\|cookie\|token\|hotmail\|passmail` | 3.0 |
| FR-P3-02 | License activate qua key, HWID bind, expire theo days admin set | 3.0 |
| FR-P3-03 | Selector config pull từ cloud (Ed25519 signed) + canary client-side | 3.0 |
| FR-P3-04 | Auto-update Electron với forced update channel | 3.0 |
| FR-P3-05 | Cookie-based login + 2FA bypass qua Playwright stealth | 3.0 |
| FR-P3-06 | Token extraction (`fb_dtsg/lsd/jazoest`) qua HTTP | 3.0 |
| FR-P3-07 | Self-comment trên post của chính profile (validate stack write) | 3.0 |
| FR-P3-08 | Proxy rotation 1 provider (proxyfb) | 3.0 |
| FR-P3-09 | Local canary profile + drift detection alert | 3.0 |
| FR-P3-10 | Mass post lên timeline profile + warmup | 3.1 |
| FR-P3-11 | Mass comment 3rd party post + mass react | 3.2 |
| FR-P3-12 | Share + friend request | 3.3 |
| FR-P3-13 | Feed scrape *(optional, defer)* | 3.4 |

**Non-Functional Requirements:**

- **NFR-P3-Compliance:** Tool vendor model (không operator). EULA + ToS user chịu trách nhiệm. Phase 1+2 và Phase 3 split thành 2 sản phẩm distinct trên website, billing tách.
- **NFR-P3-Stealth-Quality:** Tận dụng user fingerprint thật + residential IP thật. `playwright-extra` + stealth plugin bundle.
- **NFR-P3-Reliability:** Adapt Time SLO — selector regression detect < 24h (telemetry-driven), hot config push fix < 1h (không cần user update app).
- **NFR-P3-Security:** Cookie at rest = Electron `safeStorage` (OS keychain), KHÔNG plaintext SQLite. License key + HWID hash qua TLS pinning. Anti-tamper binary code sign.
- **NFR-P3-License-Online-Check:** Periodic check 4h; fail soft (offline grace 24h sau check success cuối). Tier 2+ action (post, comment, share) MUST get short-lived server-side action token mỗi request.
- **NFR-P3-Update-Forced:** Version < min_supported_version → block toàn bộ action. Mitigation cho selector skew.
- **NFR-P3-Observability:** Mandatory anonymous health beacon (count-only) + opt-in detailed telemetry. Privacy first, không bao giờ gửi cookie/UID/content.
- **NFR-P3-Agent-Velocity:** Module boundary rõ, contract đầy đủ, test coverage cao cho AI agent (Claude/Codex) tự verify.

**Out of scope Phase 3:**
- Multi-tenant org/team feature (defer — target cá nhân)
- Cross-device sync
- Server-side Chromium farm, Vault, separate FB Business Manager
- LLC con (downgraded từ SaaS model — không cần thiết với desktop vendor)

#### Technical Constraints & Dependencies

**MUST reuse từ Phase 1+2:**
- FastAPI backend cho license + selector config endpoints
- Postgres cho `licenses`, `license_activations`, `selector_configs`, `app_versions`, `telemetry_events`
- Auth từ `app/api/auth.py` (user table share)
- Frontend React cho account portal page

**NEW dependencies:**
- **Electron** + **electron-builder** (Mac/Win/Linux installer)
- **Playwright** + **playwright-extra** + **puppeteer-extra-plugin-stealth**
- Bundled Chromium (Playwright managed)
- **electron-updater** (Squirrel.Mac / NSIS)
- **better-sqlite3** + **better-sqlite3-multiple-ciphers** (encrypted SQLite local)
- Code signing: Apple Developer ($99/year) + Windows EV cert ($200-400/year)

**FORBIDDEN:**
- Cookie plaintext anywhere
- License check disabled trong build production
- SQLite không encryption
- Auto-update bỏ code signing verify
- Single Apple Developer entity share với Phase 1+2

#### Cross-Cutting Concerns

1. License lifecycle: tạo key → activate (HWID bind) → online check periodic → expire → renew
2. HWID determinism: MAC + machine UUID + CPU ID; reinstall = same HWID; thay máy = revoke + rebind
3. Selector hot config: Ed25519 signed JSON, pull mỗi launch + 1h refresh, client canary 5% trước rollout 95%
4. Anti-piracy realistic: chấp nhận ~10% crack rate, focus tăng giá trị thật
5. Update channel: 3 channel (stable/beta/canary); forced update flag
6. Telemetry privacy: mandatory beacon anonymous count + opt-in detail
7. Code sign + notarization: Mac bắt buộc Gatekeeper + Windows SmartScreen recommend
8. **Tool vendor identity isolation**: separate Apple Developer entity cho Phase 3

#### Phase 3 Risk Mitigation Anchors

**R-D1 License Integrity**
Key validate online + HWID binding; expire theo server clock (chống client clock manipulation). Periodic check 4h; offline grace 24h. Duplicate HWID activate → flag manual review.

**R-D2 Selector Drift Recovery via Hot Config**
Selector 4-tier (ARIA → testid → text → visual) bundle trong app. Tier rotation + fallback chain qua hot config từ server. Telemetry detect drift trong 24h. Push fix qua hot config → user áp dụng trong 1h, không cần update app.

**R-D3 Cookie & Secret Hygiene (local)**
Cookie + 2FA seed CHỈ trong Electron `safeStorage`. Type-based secret marker `Secret<Cookie>` TypeScript (no toString). Log redaction middleware. Bảo vệ chống F-A insider — không thể access vì secret ở máy user.

**R-D4 Auto-Update + Forced Update**
Min supported version server-side; client < min → block action. Forced update channel cho selector-critical fix. Code sign + notarization bắt buộc.

**R-D5 Anti-Tamper Realistic**
electron-builder + ASAR pack + checksum verify on launch. License key obfuscation. Chấp nhận ~10% crack rate.

**R-D6 Telemetry Privacy & SLO**
Opt-in detailed + mandatory anonymous beacon (count only). KHÔNG bao giờ gửi cookie/UID/content/password. SLO derived từ beacon aggregate.

**R-D7 Compliance Posture (Tool Vendor)**
EULA: user acknowledge FB ToS risk. Privacy policy minimal telemetry. Pricing page tách Phase 1+2 (Graph API SaaS) và Phase 3 (Automation Desktop) làm 2 sản phẩm distinct.

**R-D8 First Principles Discipline**
Mỗi decision phải list assumption + cite uncertainty. Reject path dependency.

**R-D9 License Server-Side Action Validation** (Pre-mortem v2 derived)
Client mỗi action tier 2+ (post/comment/share) MUST get short-lived action token từ server. Server verify license + HWID + rate before issue token. Action token có nonce, không reuse. Crack purely client-side không work nữa.

**R-D10 Code Sign Resilience**
Separate Apple Developer entity cho Phase 3 (không share Phase 1+2). 2 cert active (primary + backup). Fallback distribution: direct download .tar.gz cho Mac khi cert event.

**R-D11 Signed Hot Config + Client Canary**
Hot config Ed25519 signed bằng key offline. Client verify signature → fail = fallback bundled. Client canary 5% trước 95% rollout; 1h monitor auto rollback nếu success rate sụt. Dry-run mode cho selector mới.

**R-D12 Update Supply Chain Hardening**
Update package double-sign: code-sign cert + Ed25519 nội bộ. Cert pinning với update endpoint. Renovate bot monitor Electron CVE. Update opt-in delay 24h cho non-critical.

**R-D13 Mandatory Anonymous Health Beacon**
Tách mandatory ping (anonymous count) khỏi opt-in detail (event). Mandatory: `{version, action_outcome_category, timestamp}` — không identity. Privacy policy nêu rõ; reject = block app. SLO source = beacon aggregate (100% coverage).

**R-D14 Self-Service License Portal**
Web portal: extend days (in-portal payment), HWID rebind (2 free/năm), pause (extend expiry không pay). Refund SOP: < 7 ngày + < 5 actions = auto refund. HWID rebind tự động nếu MAC change + machine UUID giữ nguyên (Windows reinstall).

**R-D15 Fingerprint Diversification + Canary Cohort**
Mỗi user có fingerprint profile unique (UA, viewport, timezone, font, WebGL noise) khi activate. Chromium pinned nhưng fingerprint layer trên diversify. Canary cohort 5% user nhận Chromium version mới sớm 1 tuần.

#### Component Failure Mode Catalog (10 components — compact)

| Component | Failure mode chính | Detection | Recovery |
|---|---|---|---|
| Electron app | OOM, crash, ASAR tamper | Heartbeat beacon | Auto-restart, checksum verify |
| safeStorage | OS keychain unavailable | API error | Fallback prompt user re-enter |
| Local SQLite | Corruption, key loss | Integrity check on open | Backup before each migration; re-import profile |
| Playwright + stealth | Plugin patch break, stealth detected | Canary metric | Hot config rollback; bundled fallback |
| Bundled Chromium | Hang, sandbox escape, version skew | Heartbeat + canary | Hard timeout + restart; hot config selector adjust |
| electron-updater | CVE, signature bypass | CVE monitor | 24h opt-in delay; double-sign verify |
| License server | DDoS, validation logic bug | Endpoint SLO | CDN cache token; offline grace 24h |
| Hot config endpoint | Compromise, signature break | Client signature verify | Bundled fallback; alert |
| Code sign cert | Revocation, expiry | Apple/MS notification | 2 cert active; fallback unsigned distribution |
| Proxy provider | Down, banned IP | Per-provider success metric | Multi-provider failover |

#### Phase 3 Pre-mortem v2 Findings

7 failure scenarios identified (full detail trong elicitation log 2026-06-01):
1. License crack tràn lan → R-D9 server-side action token
2. Code signing cert revoked → R-D10 separate entity + fallback distribution
3. Hot config compromise → R-D11 Ed25519 + client canary
4. Electron auto-updater 0-day → R-D12 double-sign + cert pinning
5. Telemetry opt-in too low → R-D13 mandatory anonymous beacon
6. Day-based license support burden → R-D14 self-service portal
7. Chromium pinned → cohort fingerprint mass-detect → R-D15 fingerprint diversification

#### Phase 3 Sub-phase Rollout

| Sub-phase | Capability | Ship gate |
|---|---|---|
| **3.0 MVP** | License + profile + self-comment + canary + telemetry + hot config + auto-update | 6 tuần SLO stability |
| **3.1** | Mass post + warmup + proxy provider thứ 2 | 6 tuần SLO stability |
| **3.2** | Mass comment 3rd party + react | 6 tuần |
| **3.3** | Share + friend request | 6 tuần |
| **3.4** *(optional)* | Feed scrape | Only if specific use case |

#### Decisions Pending → resolve in step-04

| ADR | Topic | Pre-decided direction |
|---|---|---|
| ADR-P3-D1 | Desktop framework | Electron (confirmed by Luisphan 2026-06-01) |
| ADR-P3-D2 | License model | Time-based key, admin set days, HWID bind, periodic online check + per-action token tier 2+ |
| ADR-P3-D3 | Local storage encryption | Electron safeStorage + SQLCipher (better-sqlite3-multiple-ciphers) |
| ADR-P3-D4 | Hot selector config delivery | Server JSON Ed25519 signed, 1h cache, client canary 5% |
| ADR-P3-D5 | Update channel | electron-updater + Squirrel; 3 channel; forced update flag; double-sign; opt-in delay 24h non-critical |
| ADR-P3-D6 | Telemetry stack | Mandatory anonymous beacon + opt-in detail → FastAPI → Postgres → Grafana |

#### Pending Business Actions (require Luisphan confirm)

1. **Separate Apple Developer entity** cho Phase 3 (~ $99/year + setup) — block ADR-P3-D5 implementation
2. **EULA + ToS Phase 3 độc lập** với Phase 1+2 (legal draft) — block public release
3. **Pricing decision**: day-based license pricing tier (vd 30/90/180/365 ngày) — block self-service portal

### Phase 3 Starter Template Evaluation

#### Primary Technology Domain

**Desktop application** — Electron confirmed by Luisphan 2026-06-01.

Stack target:
- **Language**: TypeScript strict
- **UI**: React 19 (consistent với Phase 1+2 frontend)
- **Build**: Vite (modern HMR, ecosystem 2026)
- **Test**: `@playwright/test` cho cả unit + E2E (Vitest deferred)
- **Browser automation runtime**: Playwright + playwright-extra + stealth plugin (Node dep, KHÔNG dùng Playwright `electron` namespace — namespace đó để test Electron app)
- **Updater**: electron-updater (double-sign + cert pinning + 24h opt-in delay non-critical)
- **Packager**: electron-builder
- **Local DB**: better-sqlite3 + better-sqlite3-multiple-ciphers (SQLCipher)
- **Secret storage**: Electron safeStorage (OS keychain) + adapter layer
- **Anti-tamper**: bytenode (sensitive logic only) + ASAR + checksum verify on launch

#### Starter Options Considered

3 candidates evaluated qua web research 2026-06-01:

| Starter | Stars | Build | Verdict |
|---|---|---|---|
| **electron-vite scaffold** ([electron-vite.org](https://electron-vite.org/)) | ~5k | Vite native | **SELECTED** — bytecode protection built-in, AI-friendly, plain folder |
| **electron-react-boilerplate** ([GitHub](https://github.com/electron-react-boilerplate/electron-react-boilerplate)) | ~16k | Vite (migrated 2025) | Loại sau Thesis Defense — no bytecode, sandbox: false default, AI-hostile `.erb/` magic, 11 năm legacy IPC pattern không match modern TypedIPC |
| **Electron Forge** ([electronjs.org](https://www.electronjs.org/docs/latest/tutorial/boilerplates-and-clis)) | Official | Vite plugin | Loại — opinionated end-to-end toolchain, ít flex cho custom Chromium bundle |

**Tauri** evaluated separately ở step-02 (Comparative Analysis Matrix) — loại vì cross-language Rust↔Node IPC tăng complexity, không giải quyết FB anti-bot root cause (automation Chromium identical regardless of UI framework).

#### Selected Starter: **electron-vite scaffold (hand-crafted minimal)**

**Rationale:**

Lựa chọn này đến sau 3 vòng refinement:

1. **Thesis Defense Simulation** (2026-06-01) — initial choice ERB defeated bởi committee 3 chuyên gia:
   - Marcus (Senior Electron dev): ERB `.erb/` config fight default cho custom Chromium bundle; legacy IPC patterns AI-hostile
   - Priya (Security): ERB không bytecode (R-D5 fail); sandbox: false default; no cert pinning out-of-box
   - Jin (Solo founder): 16k stars là survivorship bias cho webapp Electron, không reflect production automation tool với stealth+Chromium bundle (<100 user worldwide)
   - **Result**: electron-vite scaffold +162 điểm trên cùng matrix sau re-score

2. **Occam's Razor Application** — confirm scaffold đã near-minimal sufficient:
   - 13 component core đều defensible (mỗi removal mất essential capability)
   - 4 component defer Phase 3.0 → Phase 3.1+ (React Router, state mgmt lib, Form lib, separate Vitest)
   - Tauri & Python alternative loại lần cuối

3. **What If Scenarios** — confirm Electron commit OK + adapter abstraction đủ escape hatch:
   - Scenario 1 FB block Chromium: Tauri swap irrelevant (Chromium identical)
   - Scenario 2 Electron CVE: patch Electron nhanh hơn swap
   - Scenario 3 platform deprecation: low probability + 6-12 tháng migration window
   - Scenario 4 installer size: delta update + lazy Chromium download non-swap fix
   - **Net**: R-D16 adapter layer đủ option mở cho swap nếu cần (4-6 tuần)

#### Initialization Command

```bash
npm create @quick-start/electron@latest automation-desktop -- --template react-ts

cd automation-desktop
# Verify dev server
npm install
npm run dev
```

#### Architectural Decisions Provided by Starter

**Language & Runtime:**
- TypeScript strict mode default
- Node 20 LTS minimum
- Electron 33+ latest stable

**UI Framework:**
- React 19 (electron-vite scaffold default 2026)
- Vite HMR cho main + preload + renderer (3 layer)
- ESLint Flat Config v9 (override theo project-context Phase 1+2)

**Build Tooling:**
- electron-vite (Vite plugin cho Electron) → fastest HMR
- bytenode bundled qua electron-vite source code protection cho sensitive module
- electron-rebuild postinstall cho better-sqlite3 native binding

**Testing Framework:**
- `@playwright/test` cho cả unit + E2E (single test runner)
- Electron app test qua Playwright's `electron` namespace (đây mới đúng usecase namespace)

**Packaging & CI:**
- electron-builder (Mac dmg, Win nsis, Linux AppImage)
- GitHub Actions workflow — copy reference từ ERB MIT-licensed (no vendor lock-in)
- Code signing: Apple Developer ($99/year) + Windows EV cert ($200-400/year)
- Notarization Mac (Gatekeeper) bắt buộc

#### Security Baseline (mandatory từ Sprint 1)

Override mặc định electron-vite scaffold:
- `sandbox: true` cho mọi BrowserWindow (chống Priya's CVE concern)
- `contextIsolation: true` (Electron 12+ default)
- `nodeIntegration: false`
- CSP headers strict cho renderer
- Cert pinning custom 30-50 LOC trong main process cho update endpoint
- bytenode compile cho: license check logic, action token signing logic, secret marshalling — KHÔNG entire codebase

#### Phase 3.0 Minimal Dep List

**Core (must-have Sprint 1):**

```json
{
  "electron": "^33.x",
  "electron-vite": "^2.x",
  "electron-builder": "^25.x",
  "electron-updater": "^6.x",
  "react": "^19.x",
  "react-dom": "^19.x",
  "typescript": "^5.x",
  "vite": "^5.x",
  "tailwindcss": "^4.x",
  "better-sqlite3": "^11.x",
  "better-sqlite3-multiple-ciphers": "^11.x",
  "playwright": "^1.x",
  "playwright-extra": "^4.x",
  "puppeteer-extra-plugin-stealth": "^2.x",
  "bytenode": "^1.x",
  "@playwright/test": "^1.x",
  "node-machine-id": "^1.x"
}
```

**Deferred Phase 3.1+** (anti-creep rule: KHÔNG thêm trừ khi pass trigger):

| Dep | Trigger condition để thêm |
|---|---|
| React Router | View count > 8 |
| State management lib (Zustand) | Deep prop drilling pain trong ≥ 3 component tree |
| React Hook Form + Zod | Form 15+ field hoặc complex validation |
| Vitest | Pure unit test logic phức tạp tách khỏi integration test |

#### Folder Structure (mandatory cho R-D16)

```
automation-desktop/
├── electron.vite.config.ts
├── electron-builder.yml
├── src/
│   ├── adapters/              # R-D16 framework decoupling
│   │   ├── ipc.ts             # IpcBridge interface + ElectronIpcBridge impl
│   │   ├── secure-storage.ts  # SecureStorage interface + ElectronSafeStorage impl
│   │   ├── updater.ts         # AutoUpdater interface + ElectronUpdater impl
│   │   └── window.ts          # WindowManager interface + ElectronWindow impl
│   ├── main/                  # Electron main process
│   │   ├── license/           # License client + HWID + per-action token
│   │   ├── automation/        # State machine + scheduler + Playwright orchestration
│   │   ├── proxy/             # Provider integration
│   │   ├── hot-config/        # Ed25519 verify + canary
│   │   └── telemetry/         # Mandatory beacon + opt-in detail
│   ├── preload/               # IPC bridge typed (uses adapters/ipc)
│   └── renderer/              # React 19 UI
│       ├── views/             # Phase 3.0: Profiles, License, Settings, Logs, Dashboard
│       ├── components/
│       └── api/               # Renderer-side IPC client
├── resources/                 # Icons, splash
├── build/                     # entitlements, signing
└── .github/workflows/         # CI release pipeline (ERB pattern reference)
```

#### Framework Migration Posture

- **Commit Electron cho Phase 3.0+**
- 4 What-If scenarios analyzed — none require swap; mitigation built-in cover all
- R-D16 Framework Decoupling Layer = optional escape hatch (4-6 tuần migration nếu unforeseen catastrophe)
- KHÔNG pre-optimize swap; chỉ discipline qua adapter import

**Note:** Project initialization với `npm create @quick-start/electron@latest automation-desktop -- --template react-ts` + folder restructure (adapters/) + security baseline override sẽ là **story đầu tiên của Phase 3.0 Sprint 1**.

### Phase 3 Core Architectural Decisions

#### Summary table (10 ADR-D)

| ADR | Category | Decision |
|---|---|---|
| P3-D1 | Platform | Electron + electron-vite scaffold (hand-crafted minimal) |
| P3-D2 | Auth/Security | Time-based license + HWID bind + per-action token tier 2+ |
| P3-D3 | Data (local) | SQLCipher + Electron safeStorage qua adapter layer |
| P3-D4 | API/Communication | Hot config Ed25519 signed, 1h cache, client canary 5% |
| P3-D5 | Infrastructure | electron-updater + double-sign + cert pinning + 3 channel + opt-in delay 24h |
| P3-D6 | Observability | Mandatory anonymous beacon + opt-in detail → FastAPI → Postgres → Grafana |
| P3-D7 | Data (server) | Postgres schema `phase3` + client SQLite (SQLCipher) |
| P3-D8 | API/IPC | Typed IPC adapter + Zod schema 2-way validation |
| P3-D9 | Infrastructure | Extend Phase 1+2 FastAPI với router `/api/v1/automation/*` |
| P3-D10 | Distribution | GitHub Releases (private + public) + S3 mirror fallback |

#### ADR-P3-D1 — Desktop Framework

**Context:** Phase 3 cần desktop runtime cho cá nhân user trên Windows + Mac (Linux Phase 3.1+). Cookie automation đòi hỏi bundled Chromium + Playwright + stealth ecosystem mạnh nhất.

**Decision:** **Electron + electron-vite scaffold (hand-crafted minimal)**

**Rationale (validated qua Thesis Defense + Occam + What If):**
- Stealth ecosystem `playwright-extra` + plugin gold standard
- React 19 + Vite consistency Phase 1+2
- Tauri swap không giải quyết FB anti-bot root (automation Chromium identical regardless UI)
- R-D16 adapter layer escape hatch (4-6 tuần swap nếu cần)

**Consequences:**
- ✅ Stealth quality cao nhất khả thi + AI productivity tối đa
- ⚠️ Installer 200MB → mitigate qua delta update electron-updater
- ⚠️ V8 không deterministic wipe → mitigate qua process restart sau N session

#### ADR-P3-D2 — License Model

**Context:** Sell as licensed desktop tool cá nhân. Admin tạo key set days. Chống share + offline crack + per-action validation.

**Decision:** **Online activate + HWID + periodic check 4h + per-action token tier 2+**

**Implementation:**
- HWID = MAC + machine UUID + CPU ID qua `node-machine-id`
- Periodic check 4h background; fail soft offline grace 24h cho tier 1 action
- **Tier 2+ action (post, comment, react, share, friend) MUST online** — server issue action token (jti, nonce, 60s TTL)
- Tier 1 action (profile CRUD, settings, view logs) offline grace 24h
- Self-service portal (R-D14): extend days, HWID rebind 2 free/năm, pause expiry

**Rationale (R-D9 derived):**
- Per-action server token gate cho high-risk action — crack purely client-side không work
- Anti-crack realistic ~5-10% (vs 30-50% pure client-side check)

**Consequences:**
- ✅ Anti-crack mạnh nhất khả thi cho desktop tool
- ✅ Revenue protection: action token gate sinh tiền
- ⚠️ Offline UX yếu cho write action — phải online; mitigate qua CDN cache + retry logic
- ⚠️ License server SPOF cho write action — mitigate qua multi-region + circuit breaker

#### ADR-P3-D3 — Local Storage Encryption

**Context:** Cookie + 2FA seed + password + license token lưu local. Tool C# nguồn raw SQLite — phải tránh.

**Decision:** **SQLCipher (better-sqlite3-multiple-ciphers) cho DB + Electron safeStorage cho crown jewel**

**Layering:**
- **safeStorage** (OS keychain): cookie, 2FA seed, license private, action token cache — KHÔNG vào SQLite
- **SQLCipher SQLite**: profile metadata, automation_jobs, telemetry buffer — encrypted với key derived từ safeStorage master key
- Adapter qua `src/adapters/secure-storage.ts` (R-D16)

**Rationale (R-D3 derived):**
- Defense in depth: nếu SQLite extract, cookie vẫn locked OS keychain
- macOS Keychain / Windows Credential Manager / Linux libsecret backed

**Consequences:**
- ✅ Cookie at rest strongest cho Electron
- ⚠️ SQLCipher fork — track CVE riêng
- ⚠️ Master key migration khi thay máy = re-import profile (R-D14 rebind flow)

#### ADR-P3-D4 — Hot Selector Config Delivery

**Context:** Selector phải update < 1h khi FB đổi DOM (R-D2). Cần signature verify chống MITM (R-D11).

**Decision:** **Ed25519 signed config + client canary 5% + bundled fallback**

**Pattern:**
- Config JSON ký với Ed25519 private key **offline** (không bao giờ trên server runtime)
- Endpoint: `GET /api/v1/automation/selector-config?version=N` (CDN cache 1h)
- Client verify signature; fail = fallback bundled selector + telemetry alert
- Canary 5% user nhận config mới sớm 1h; auto rollback nếu success rate sụt > 10%
- Dry-run mode lần đầu apply: verify element existed, không click

**Consequences:**
- ✅ R-D2 SLO < 1h fix push khả thi
- ✅ Defense in depth chống config attack
- ⚠️ Ed25519 private key vault management offline — operational discipline

#### ADR-P3-D5 — Update Channel

**Context:** Auto-update bắt buộc (R-D4). Cần resilience chống CVE Electron + supply chain (R-D12).

**Decision:** **electron-updater hardened với double-sign + cert pinning + 3 channel + 24h opt-in delay**

**Setup:**
- Distribution: GitHub Releases (private cho beta/canary, public cho stable)
- Code sign: Apple Developer ($99/year, separate entity per R-D10) + Windows EV cert ($200-400/year)
- **Double-sign**: update package thêm Ed25519 signature ngoài code sign cert
- Cert pinning với update endpoint (không trust public CA chain)
- 3 channel: `stable` (default), `beta` (opt-in), `canary` (5% cohort)
- **Opt-in delay 24h** cho non-critical update
- **Forced update** khi version < `min_supported_version` server config

**Consequences:**
- ✅ Strongest update supply chain posture
- ✅ Tier 1 forced update cho critical fix
- ⚠️ Ed25519 key management thêm
- ⚠️ Beta/canary cohort cần selective release infrastructure

#### ADR-P3-D6 — Telemetry & Observability Stack

**Context:** NFR-Observability + R-D6 + R-D13. Cần SLO measurable, privacy first.

**Decision:** **Mandatory anonymous beacon + opt-in detailed telemetry**

**Schema:**
- **Mandatory beacon** (block app nếu reject EULA): `{version, hwid_hash, action_outcome_category, timestamp}` — KHÔNG cookie/UID/content
  - `action_outcome_category`: enum `success | checkpoint | selector_miss | proxy_error | timeout`
- **Opt-in detailed** (default OFF): full event log + error stack + per-selector tier breakdown

**Stack:**
- Client: agent batch send mỗi 5 phút + offline buffer
- Backend: extend FastAPI với `/api/v1/automation/telemetry/beacon` + `/api/v1/automation/telemetry/detail`
- Storage: Postgres `phase3.telemetry_events` partitioned by month
- Dashboards: **Grafana** new instance (Loki cho log)
- Alert: SLO < 85% trong 1h → Telegram/email

**Consequences:**
- ✅ R-D2 SLO measurable thực với 100% coverage
- ✅ Privacy posture cho cá nhân
- ⚠️ Beacon mandatory phải nêu rõ EULA

#### ADR-P3-D7 — Data Model (Server + Client)

**Decision:** **Postgres schema `phase3` + client SQLite (SQLCipher)**

**Server schema `phase3`:**
```sql
phase3.licenses                  -- key, days_total, created_at, created_by_admin
phase3.license_activations       -- license_id, hwid_hash, activated_at, expires_at, rebind_count
phase3.action_tokens             -- jti, license_activation_id, issued_at, expires_at, used_at, action_type
phase3.selector_configs          -- version, signed_payload (Ed25519), published_at, canary_pct
phase3.app_versions              -- version, min_supported, channel, release_notes
phase3.telemetry_events          -- beacon | detail (partitioned by month)
```

**Client SQLite (SQLCipher):**
```sql
profiles                  -- id, uid, name, status, created_at
profile_metadata          -- profile_id, key, value (proxy, fingerprint)
automation_jobs           -- id, profile_id, type, state, started_at, completed_at, result
job_actions               -- job_id, action_type, target, action_token, executed_at, outcome
canary_state              -- profile_id, last_success, success_rate_24h
telemetry_buffer          -- pending beacon + detail events
```

**Cookie + 2FA seed**: KHÔNG trong SQLite, chỉ Electron safeStorage

**Migration:** server qua Alembic; client qua versioned SQLite migrations với checksum verify

**Consequences:**
- ✅ Backend operational đơn giản (1 Postgres)
- ✅ Client offline-capable
- ⚠️ Cross-schema query cần GRANT chính xác

#### ADR-P3-D8 — IPC Contract Pattern

**Context:** Sandbox: true + adapter layer R-D16 đòi hỏi disciplined IPC.

**Decision:** **Typed IPC adapter + Zod schema 2-way validation**

**Pattern:**
- `src/adapters/ipc.ts` định nghĩa `IpcBridge` interface với channel → request/response Zod schema
- Main: `ipcMain.handle(channel, (e, payload) => { schema.request.parse(payload); ... })`
- Renderer: `await ipcBridge.call(channel, payload)` — runtime validate + TS typed
- Channel naming: `phase3:<domain>:<verb>` (vd `phase3:profile:create`)
- Secret field marked `Secret<T>` brand type — preload bridge KHÔNG bao giờ truyền raw secret tới renderer

**Consequences:**
- ✅ Type safety + runtime guard chống compromised renderer
- ✅ Adapter swap path mở
- ⚠️ Schema maintenance — AI agent hỗ trợ tốt

#### ADR-P3-D9 — Backend Deployment

**Decision:** **Extend Phase 1+2 FastAPI với router `/api/v1/automation/*`**

**Implementation:**
- `backend/app/api/automation.py` router với endpoints:
  - `POST /api/v1/automation/license/activate`
  - `POST /api/v1/automation/license/check`
  - `POST /api/v1/automation/action/token`
  - `GET /api/v1/automation/selector-config`
  - `GET /api/v1/automation/app-version`
  - `POST /api/v1/automation/telemetry/beacon`
  - `POST /api/v1/automation/telemetry/detail`
  - `POST /api/v1/automation/admin/license` (create key, set days)
- Service: `backend/app/services/automation/{license,token,selector_config,telemetry}.py`
- Reuse `app/api/deps.py` auth + RBAC

**Rationale:**
- Compliance liability đã shift (tool vendor) → không cần infra isolation cứng
- Solo dev: 1 codebase 1 deploy = đơn giản
- Phase 1+2 down không ảnh hưởng desktop (offline grace 24h cover)

**Consequences:**
- ✅ Operational đơn giản
- ✅ Reuse auth, RBAC, runtime_settings
- ⚠️ Coupling soft — feature flag `automation_api_enabled` + contract test mitigate

#### ADR-P3-D10 — Distribution Channel

**Decision:** **GitHub Releases (private + public mix) + S3 mirror fallback**

**Setup:**
- Private repo cho beta/canary (license-gated signed URL)
- Public repo cho stable release page (manual download fallback)
- electron-updater config GitHub provider
- **S3 mirror** parallel cho artifact (chống DMCA takedown F-D3 pre-mortem)
- Hot config có thể switch update URL sang S3 mirror runtime

**Consequences:**
- ✅ Cost gần như zero
- ✅ Standard ecosystem
- ⚠️ GitHub policy risk → S3 mirror plan
- ⚠️ Repo public/private mix decide sớm

#### Decision Impact Analysis

**Critical (block implementation):** D1, D2, D3, D7, D9 (Sprint 1)

**Important (shape architecture):** D4, D5, D6, D8, D10 (Sprint 2-3)

**Implementation Sequence:**

```
Sprint 1 (Foundation):
- D1 scaffold + adapter layer + D8 IPC contract + Zod schema
- D3 SQLCipher + safeStorage adapter
- D7 server schema migration (Alembic) + client SQLite schema
- D9 FastAPI router skeleton

Sprint 2 (License + Automation Core):
- D2 license activate + HWID + per-action token
- D6 telemetry beacon + opt-in detail
- D4 hot config signed delivery + canary

Sprint 3 (Release Prep):
- D5 electron-updater + double-sign + cert pinning
- D10 GitHub Releases + S3 mirror + fallback distribution
- Code sign + notarization pipeline
```

**Cross-Component Dependencies:**
- D2 depends on D9 (license endpoints) + D8 (IPC for license UI)
- D4 depends on D8 (config validation IPC) + D6 (telemetry alert hot config canary failure)
- D5 depends on D10 (distribution channel) + D6 (force update telemetry)
- D7 depends on Phase 1+2 user table (auth share)

### Phase 3 Implementation Patterns & Consistency Rules

7 cluster conflict point cần rule chính (polyglot Python + TS main + TS renderer):

1. IPC channel naming + Zod schema location
2. Adapter import discipline (R-D16 enforcement)
3. Secret type marker (R-D3, R-D5 log leak chống F-A insider)
4. State machine state names + transition guards (`automation_jobs`)
5. Postgres schema `phase3.*` vs Phase 1+2 namespace
6. Telemetry event taxonomy (beacon vs detail schema khác)
7. Error shape cross-boundary (Python API → HTTP → Electron main → IPC → React renderer)

#### Naming Patterns

**Database (Postgres server-side)**:
- Schema prefix `phase3.*` BẮT BUỘC
- Column: snake_case
- FK: `<table>_id` singular
- Index: `idx_<table>_<column(s)>`
- Constraint: `ck_<table>_<rule>` / `uq_<table>_<column>`
- Migration MUST set `search_path = phase3, public`

**Database (SQLite client-side)**:
- Prefix `local_` cho state-only client tables (`local_canary_state`, `local_telemetry_buffer`)
- Canonical entity tables KHÔNG prefix (`profiles`, `automation_jobs`)
- Naming consistency với server: snake_case

**API endpoints (FastAPI)**:
- Namespace `/api/v1/automation/*`
- Verb cuối cho action endpoint (`/check`, `/activate`, `/token`)
- Resource plural khi list (`/licenses`), singular cho action (`/license/activate`)
- Query param snake_case

**IPC channels (Electron main ↔ renderer)**:
- Format: `phase3:<domain>:<verb>` kebab verb
- Mỗi channel = 1 Zod schema pair (`<Channel>RequestSchema`, `<Channel>ResponseSchema`)
- Chỉ `invoke/handle` (request-response), KHÔNG `dispatch/emit`

**TypeScript code**:
- Files: kebab-case non-component, PascalCase React component
- Types: PascalCase; Functions: camelCase; Constants: SCREAMING_SNAKE_CASE
- Zod schemas: `<Name>Schema` suffix

**State machine states (automation_jobs)**:
- SCREAMING_SNAKE_CASE: `PENDING | ACQUIRING_PROXY | LOGGING_IN | SOLVING_CHECKPOINT | WARMING_UP | EXECUTING | DONE | CHECKPOINT_BLOCKED | FAILED | CANCELLED`
- Transition guard: `canTransition<From>To<To>(job, ctx): boolean`

**Telemetry event categories**:
- Beacon (mandatory) — flat enum: `success | checkpoint | selector_miss | proxy_error | timeout | rate_limited`
- Detail (opt-in) — namespaced: `phase3.<domain>.<event>` (vd `phase3.selector.tier_fallback`)

#### Structure Patterns

**Folder discipline**:
```
src/
├── adapters/           # R-D16 — interface + Electron impl only
├── main/               # 1 service = 1 folder + barrel index.ts
│   ├── license/
│   ├── automation/
│   │   ├── state-machine.ts
│   │   ├── scheduler.ts
│   │   └── playwright-runner.ts
│   ├── proxy/
│   ├── hot-config/
│   ├── telemetry/
│   ├── logging/
│   └── ipc/            # IPC handlers wiring
├── preload/
│   └── ipc-bridge.ts   # Wire adapter → window.api typed
├── renderer/
│   ├── views/          # 1 view = 1 file (top-level route)
│   ├── components/
│   ├── hooks/
│   └── api/            # IPC client wrappers
└── shared/             # Types + Zod schemas shared cả main + renderer
    ├── ipc-schemas/
    ├── types/
    ├── telemetry/
    └── retry.ts
```

**Test file location**:
- Co-located unit + integration: `<module>.test.ts`
- E2E + Playwright Electron: `tests/e2e/*.spec.ts`
- Backend Python: `backend/tests/api/`, `backend/tests/services/automation/`

#### Format Patterns

**Error envelope (cross-boundary canonical)**:
```typescript
interface ErrorEnvelope {
  code: string;           // SCREAMING_SNAKE_CASE
  message: string;        // User-facing Vietnamese
  retryable: boolean;
  details?: Record<string, unknown>;
  trace_id?: string;
}
```

Error code namespace:
- `LICENSE_*` — `EXPIRED`, `HWID_MISMATCH`, `NOT_FOUND`
- `ACTION_TOKEN_*` — `INVALID`, `REUSED`, `EXPIRED`
- `PROXY_*` — `TIMEOUT`, `PROVIDER_DOWN`, `BLOCKED`
- `SELECTOR_*` — `NOT_FOUND`, `CONFIG_INVALID_SIGNATURE`
- `FB_*` — `CHECKPOINT`, `RATE_LIMITED`, `LOGIN_FAILED`
- `INTERNAL_ERROR` — fallback

**Date format**:
- API JSON: ISO 8601 with Z (`2026-06-01T08:30:00Z`)
- SQLite client: Unix epoch ms integer
- Postgres: `TIMESTAMPTZ` UTC

**JSON field naming**:
- Server API: snake_case (matching Python + Phase 1+2)
- Client-internal: camelCase (TypeScript)
- Conversion qua `src/shared/api-client/serialize.ts` — single point

#### Communication Patterns

**IPC contract enforcement**:
- Adapter `src/adapters/ipc.ts` chỉ chứa interface
- Main impl: `ipcMain.handle('phase3:<channel>', async (e, payload) => { schema.request.parse(payload); ... })`
- Renderer: `await ipcBridge.call('phase3:<channel>', req)`
- Mọi payload Zod parse cả 2 đầu (validate-on-receive)
- Error always envelope, không throw raw

**Secret marker pattern (R-D3, R-D5)**:
```typescript
declare const __secretBrand: unique symbol;
export type Secret<T> = T & { readonly [__secretBrand]: never };
```
- Wrap khi receive từ user input / safeStorage
- Custom `toString()` throw
- IPC bridge KHÔNG truyền `Secret<T>` payload — dùng `secret_ref` UUID handle, main lookup tại execution time

**Telemetry emission**:
- Beacon: `telemetry.beacon({ outcome, duration_ms })`
- Detail: `telemetry.detail('phase3.<domain>.<event>', payload)`
- NEVER include: cookie, password, 2FA seed, UID, content of post/comment, profile name
- Schema validation per event name (`src/shared/telemetry/events.ts`)
- Beacon batch 5 phút; detail offline buffer max 10MB → drop oldest

#### Process Patterns

**Error handling layer flow**:
1. Service throws domain error (`class LicenseExpiredError extends DomainError { code='LICENSE_EXPIRED'; retryable=false; }`)
2. Adapter converts to `ErrorEnvelope` (log redacted unknown error)
3. Renderer handles by code (`if err.code === 'LICENSE_EXPIRED' showLicenseRenewal()`)

**Retry pattern**:
- Centralized `src/shared/retry.ts` với `RETRY_POLICY` map per channel
- KHÔNG retry inline trong service
- Backoff exponential, retryable codes whitelist

**Logging redaction**:
- `src/main/logging/redaction.ts` mandatory middleware
- Secret keys list: `cookie, c_user, xs, datr, password, pass, two_fa, totp, fb_dtsg, lsd, jazoest, action_token, jti, license_key`
- All loggers wrap `redact()`; direct logger call = ESLint fail

#### Enforcement Guidelines

**All AI Agents MUST follow:**

1. R-D16 adapter import discipline — business logic chỉ import từ `src/adapters/*` cho IPC/storage/updater/window
2. Zod parse 2 chiều — IPC handler + caller parse request + response
3. Error envelope cross-boundary — không raw Error
4. Secret marker — wrap `Secret<T>`, không bao giờ qua IPC payload
5. Telemetry redaction — cookie/UID/content NEVER vào telemetry
6. Schema namespace — server `phase3.*`, client `local_*` cho state
7. IPC channel format — `phase3:<domain>:<verb>` kebab
8. State machine SCREAMING_SNAKE_CASE
9. Retry centralized qua `RETRY_POLICY`
10. Logger redaction qua `redact()`

**Enforcement mechanisms**:

| Pattern | Tool |
|---|---|
| Adapter discipline | ESLint `no-restricted-imports`: cấm `electron` ngoài `adapters/` + `preload/` |
| Zod parse | TypeScript typed return của `ipcBridge.call`; test fixture verify |
| Error envelope | ESLint custom rule + integration test |
| Secret marker | ESLint `no-secret-in-ipc-payload`, `no-secret-tostring` |
| Telemetry redaction | Integration test check payload không chứa cookie pattern |
| Schema namespace | Alembic naming convention + CI check |
| IPC channel format | TS template literal type `\`phase3:${string}:${string}\`` |
| State machine | Lint rule `state-machine-uppercase` |
| Retry centralized | ESLint `no-inline-retry` |
| Logger redaction | ESLint `require-redact-call` |

#### Pattern Examples

**Good — adapter compliant**:
```typescript
import { secureStorage } from '@/adapters/secure-storage';
import type { IpcBridge } from '@/adapters/ipc';
```

**Anti-pattern — direct electron import**:
```typescript
import { safeStorage, ipcMain } from 'electron';  // ❌ ESLint FAIL
```

**Good — IPC with Zod**:
```typescript
ipcMain.handle('phase3:license:activate', async (e, payload) => {
  const req = LicenseActivateRequestSchema.parse(payload);
  const res = await licenseService.activate(req);
  return LicenseActivateResponseSchema.parse(res);
});
```

**Anti-pattern — raw payload**:
```typescript
ipcMain.handle('phase3:license:activate', async (e, payload) => {
  return await licenseService.activate(payload as any);  // ❌ no validation
});
```

**Good — telemetry redacted**:
```typescript
telemetry.detail('phase3.action.completed', {
  action_type: 'comment_submit',
  duration_ms: 3400,
  selector_tier: 'aria',
});
```

**Anti-pattern — telemetry leak**:
```typescript
telemetry.detail('phase3.action.completed', {
  uid: profile.uid,           // ❌ PII
  content: comment_text,      // ❌ PII
  cookie: cookie.slice(0, 20),// ❌ secret partial leak vẫn fail
});
```

### Phase 3 Project Structure & Boundaries

#### Repo Strategy

**Mono-repo** (extend repo hiện tại) — `automation-desktop/` ngang hàng `backend/`, `frontend/`, `database/`. Solo dev + AI agent friendly + reuse Phase 1+2 auth dễ.

#### Complete Directory Tree (Phase 3 additions)

```
auto-crawl-tiktok-post-fb/                  # MONO REPO ROOT
│
├── backend/                                # EXTEND
│   ├── app/
│   │   ├── api/automation.py               # NEW router /api/v1/automation/*
│   │   ├── services/automation/            # NEW
│   │   │   ├── license.py
│   │   │   ├── action_token.py
│   │   │   ├── hwid.py
│   │   │   ├── selector_config.py
│   │   │   ├── app_version.py
│   │   │   ├── telemetry.py
│   │   │   └── admin.py
│   │   ├── services/crypto/
│   │   │   ├── ed25519_signer.py
│   │   │   └── action_token_signer.py
│   │   ├── schemas/automation/             # Pydantic
│   │   └── models/automation/              # SQLAlchemy phase3.*
│   ├── alembic/versions/2026XXXX_phase3_init.py
│   └── tests/api/test_automation_*.py
│
├── frontend/                               # EXTEND admin portal
│   └── src/pages/automation/
│       ├── LicenseManagement.tsx
│       ├── SelectorConfigEditor.tsx
│       ├── TelemetryDashboard.tsx
│       └── AppVersionConsole.tsx
│
├── automation-desktop/                     # NEW Electron repo subfolder
│   ├── README.md
│   ├── package.json
│   ├── electron.vite.config.ts
│   ├── electron-builder.yml
│   ├── tsconfig.json
│   ├── eslint.config.js
│   ├── tailwind.config.ts
│   ├── renovate.json
│   ├── resources/                          # icon.{icns,ico,png}
│   ├── build/                              # entitlements.mac.plist, notarize.js
│   ├── .github/workflows/                  # ci.yml, release.yml
│   │
│   ├── src/
│   │   ├── adapters/                       # R-D16 interface ONLY
│   │   │   ├── ipc.ts
│   │   │   ├── secure-storage.ts
│   │   │   ├── updater.ts
│   │   │   └── window.ts
│   │   │
│   │   ├── main/
│   │   │   ├── index.ts
│   │   │   ├── adapters/                   # Electron impl của interface
│   │   │   │   ├── electron-ipc-bridge.ts
│   │   │   │   ├── electron-safe-storage.ts
│   │   │   │   ├── electron-auto-updater.ts
│   │   │   │   └── electron-window.ts
│   │   │   ├── license/                    # FR-P3-02
│   │   │   ├── profile/                    # FR-P3-01
│   │   │   ├── automation/                 # FR-P3-05,06,07,10,11,12
│   │   │   │   ├── state-machine.ts
│   │   │   │   ├── scheduler.ts
│   │   │   │   ├── playwright-runner.ts
│   │   │   │   ├── action-executor.ts
│   │   │   │   ├── token-extractor.ts
│   │   │   │   ├── checkpoint-handler.ts
│   │   │   │   ├── warmup-runner.ts
│   │   │   │   └── fingerprint-generator.ts
│   │   │   ├── selector/                   # FR-P3-03
│   │   │   │   ├── selector-loader.ts
│   │   │   │   ├── selector-resolver.ts    # 4-tier ARIA → testid → text → visual
│   │   │   │   └── canary-controller.ts
│   │   │   ├── proxy/                      # FR-P3-08
│   │   │   │   └── providers/{proxyfb,tmproxy,shoplike}.ts
│   │   │   ├── canary/                     # FR-P3-09
│   │   │   ├── telemetry/                  # beacon-emitter, detail-emitter, buffer
│   │   │   ├── hot-config/                 # config-puller, signature-verifier
│   │   │   ├── updater/                    # version-checker, force-update-gate
│   │   │   ├── db/                         # SQLCipher client + migrations + repositories
│   │   │   │   ├── client.ts
│   │   │   │   ├── migrations/
│   │   │   │   └── repositories/{profile,job,telemetry-buffer}-repo.ts
│   │   │   ├── logging/                    # logger + redaction middleware
│   │   │   ├── ipc/                        # handlers wiring
│   │   │   └── boot/{bootstrap,security-baseline}.ts
│   │   │
│   │   ├── preload/
│   │   │   ├── index.ts                    # contextBridge expose window.api
│   │   │   └── ipc-bridge.ts
│   │   │
│   │   ├── renderer/                       # React 19
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx                     # state-based view switch (no Router 3.0)
│   │   │   ├── views/                      # 5 view Phase 3.0
│   │   │   │   ├── Dashboard.tsx
│   │   │   │   ├── ProfilesView.tsx
│   │   │   │   ├── LicenseView.tsx
│   │   │   │   ├── SettingsView.tsx
│   │   │   │   └── LogsView.tsx
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── api/                        # IPC client wrappers
│   │   │   └── styles/globals.css          # Tailwind v4 entry
│   │   │
│   │   └── shared/                         # Cross-process single source of truth
│   │       ├── ipc-schemas/                # ALL Zod schemas + channel registry
│   │       ├── types/
│   │       │   ├── secret.ts               # Secret<T> brand type
│   │       │   ├── error-envelope.ts
│   │       │   └── state-machine.ts
│   │       ├── telemetry/{events,beacon-categories}.ts
│   │       ├── api-client/{http-client,serialize}.ts
│   │       └── retry.ts                    # RETRY_POLICY map
│   │
│   ├── tests/
│   │   ├── unit/                           # phần lớn co-located *.test.ts
│   │   ├── integration/{license-flow,selector-tier-fallback,state-machine}.test.ts
│   │   ├── e2e/                            # @playwright/test cho Electron
│   │   │   └── {license-activation,profile-import,settings-toggle,force-update}.spec.ts
│   │   └── fixtures/{mock-fb-server.ts,test-profiles.json}
│   │
│   └── scripts/
│       ├── postinstall.ts                  # electron-rebuild
│       ├── sign-config.ts                  # Ed25519 sign hot config offline
│       └── canary-rollout.ts
│
└── docker-compose.yml                      # EXTEND env vars Phase 3 secret
```

#### Architectural Boundaries

**API Boundaries**:
- `POST /api/v1/automation/license/activate` — public + rate limit
- `POST /api/v1/automation/license/check` — bearer activation_id
- `POST /api/v1/automation/action/token` — bearer + per-action rate limit
- `GET /api/v1/automation/selector-config` — public cacheable
- `GET /api/v1/automation/app-version` — public
- `POST /api/v1/automation/telemetry/{beacon,detail}` — bearer
- `POST /api/v1/automation/admin/license` — admin RBAC

**IPC Boundaries**:
- `phase3:license:*` → `src/main/license/`
- `phase3:profile:*` → `src/main/profile/`
- `phase3:automation:*` → `src/main/automation/`
- `phase3:settings:*` → `src/main/settings/`
- `phase3:telemetry:*` → `src/main/telemetry/`
- `phase3:logs:*` → `src/main/logging/`

**Layer rule (strict, enforced ESLint)**:
```
renderer → preload (window.api) → main/ipc → main/<service> → main/db | main/adapters
```

Cấm:
- Renderer truy cập Node API trực tiếp
- `main/<service>` import từ `renderer/`
- `main/db/repositories/` import từ `main/ipc/`
- Bất kỳ business logic import `electron` (chỉ qua adapter)

**Data Boundaries**:

| Data type | Storage | Encryption |
|---|---|---|
| Cookie, 2FA seed, license private, action token cache | safeStorage | OS keychain |
| Profile metadata, automation_jobs, telemetry buffer | SQLCipher SQLite | DB-level từ safeStorage master |

#### Requirements → Structure Mapping

| FR-ID | Primary location |
|---|---|
| FR-P3-01 Profile CRUD + import | `main/profile/` + `renderer/views/ProfilesView.tsx` + `main/db/repositories/profile-repo.ts` |
| FR-P3-02 License + HWID + token | `main/license/` + `backend/.../automation/{license,action_token,hwid}.py` + `renderer/views/LicenseView.tsx` |
| FR-P3-03 Hot config | `main/selector/` + `main/hot-config/` + `backend/.../automation/selector_config.py` |
| FR-P3-04 Auto-update | `main/updater/` + `backend/.../automation/app_version.py` |
| FR-P3-05 Cookie login + 2FA | `main/automation/{playwright-runner, checkpoint-handler}` |
| FR-P3-06 Token extraction HTTP | `main/automation/token-extractor.ts` |
| FR-P3-07 Self-comment | `main/automation/action-executor.ts` (action_type='self_comment') |
| FR-P3-08 Proxy rotation | `main/proxy/` |
| FR-P3-09 Canary drift | `main/canary/` + backend telemetry alert |
| FR-P3-10 Mass post + warmup (3.1) | `main/automation/{action-executor, warmup-runner}` |
| FR-P3-11 Comment + react (3.2) | `main/automation/action-executor.ts` |
| FR-P3-12 Share + friend (3.3) | same |
| FR-P3-13 Feed scrape (3.4 optional) | `main/automation/feed-scraper.ts` |

#### Cross-Cutting Concerns Mapping (R-D1 → R-D16)

| R-D | Location |
|---|---|
| R-D1 License integrity | `backend/.../automation/{license,action_token}` + `main/license/` |
| R-D2 Selector drift recovery | `main/selector/selector-resolver.ts` 4-tier + `main/canary/drift-detector.ts` |
| R-D3 Secret hygiene | `shared/types/secret.ts` + `main/adapters/electron-safe-storage.ts` + `main/logging/redaction.ts` |
| R-D4 Auto-update + force | `main/updater/` + `backend/.../automation/app_version.py` |
| R-D5 Anti-tamper | `scripts/sign-config.ts` + electron-builder bytenode config |
| R-D6 Telemetry & SLO | `main/telemetry/` + `backend/.../automation/telemetry.py` |
| R-D7 Tool vendor compliance | `LICENSE-EULA.md` + privacy policy webpage |
| R-D8 First Principles | `.github/PULL_REQUEST_TEMPLATE.md` checklist |
| R-D9 Server-side action token | `backend/.../automation/action_token.py` |
| R-D10 Code sign resilience | `automation-desktop/build/` + `release.yml` |
| R-D11 Signed hot config + canary | `main/selector/canary-controller.ts` + `scripts/sign-config.ts` |
| R-D12 Update supply chain | `main/updater/` + `renovate.json` |
| R-D13 Mandatory beacon | `main/telemetry/beacon-emitter.ts` |
| R-D14 Self-service portal | `frontend/src/pages/license-portal/` (NEW) + backend extend |
| R-D15 Fingerprint diversification | `main/automation/fingerprint-generator.ts` |
| R-D16 Framework decoupling | `src/adapters/` interface + `src/main/adapters/` impl |

#### Integration Points

**Internal**:
- Renderer → Main qua `window.api` (preload) → IPC `phase3:*` → Zod parse → service
- Main service ↔ Backend qua `shared/api-client/http-client.ts` (axios + cert pinning + retry)
- State machine emit → telemetry detail (opt-in) + log (redacted)

**External**:
- Facebook: HTTP token extraction + Playwright stealth bundled Chromium
- Proxy providers: proxyfb (3.0), tmproxy (3.1), shoplike (3.1)
- Own backend: license + telemetry + selector config + version
- GitHub Releases + S3 mirror: electron-updater artifact
- Apple Developer + Microsoft Authenticode: code sign

**End-to-end flow (self-comment example)**:
```
1. User click "Run" → renderer/api/automation-api.ts → ipcBridge.call('phase3:automation:start', ...)
2. main/ipc/automation-handlers Zod parse → main/automation/state-machine PENDING → ACQUIRING_PROXY
3. main/proxy/proxy-pool assign proxy
4. main/license/action-token-client → POST /api/v1/automation/action/token
5. main/automation/playwright-runner launches Chromium + stealth + proxy
6. main/automation/checkpoint-handler login (cookie từ safeStorage)
7. main/automation/action-executor self-comment
8. result → telemetry beacon + state machine DONE
9. main/db/repositories/job-repo persist
10. renderer poll status qua phase3:automation:status
```

#### Development Workflow

**Dev**:
```bash
cd automation-desktop && npm run dev          # electron-vite HMR 3 layer
cd backend && docker-compose up -d            # existing Phase 1+2 stack
```

**Build**:
```bash
npm run build:mac                              # dmg
npm run build:win                              # nsis
git tag v0.1.0 && git push --tags              # CI: sign + notarize + Release + S3 mirror
```

**Distribution**:
- Stable: GitHub Releases public + S3 mirror
- Beta: Private repo + signed URL (license-gated)
- Canary: Private repo + 5% cohort (HWID hash modulo)

### Phase 3 Architecture Validation Results

#### Gap Resolutions Applied (G-1 → G-7)

**G-1 License expired tier 1 behavior — ADDED**

Khi license expire:
- Tier 1 (profile view, settings, export) **allowed 7 ngày grace** sau expire
- Tier 2+ (post, comment, react, ...) block immediately
- New state machine state: `LICENSE_EXPIRED_READ_ONLY` (added to AutomationJobState enum)
- App boot: kiểm `expires_at`; nếu expired > 7 ngày → chỉ LicenseView active, các view khác disabled (chỉ cho phép renewal)

**G-2 EULA Acceptance Flow — ADDED**

- File `automation-desktop/LICENSE-EULA.md` + privacy policy webpage
- New view `src/renderer/views/EulaAcceptanceView.tsx` — first-run modal mandatory
- Boot sequence: `bootstrap.ts` check `local_settings.eula_accepted_version`; nếu < current EULA version → show EulaAcceptanceView
- Mandatory beacon telemetry **CHỈ enable sau khi accept EULA** (resolve conflict với "block app if reject beacon")
- New SQLite table: `local_settings` (key-value cho eula_accepted_version, telemetry_detail_optin, channel, ...)

**G-3 Backup & Recovery — NEW ADR-P3-D11**

User export profile data + automation state ra file `.p3backup` encrypted với passphrase user chọn. Import lại sau OS reinstall / máy mới → trigger HWID rebind flow (R-D14, 2 free/năm).

**ADR-P3-D11 — Backup & Recovery**

- Decision: User-controlled export/import `.p3backup` file, AES-256-GCM với PBKDF2-derived key từ user passphrase (100k iteration)
- Backup chứa: profile metadata + automation_jobs history + cookie + 2FA seed (re-encrypted với passphrase)
- KHÔNG include: license private key (separate, server-issued mới khi rebind)
- Module: `src/main/backup/{exporter.ts, importer.ts}`
- UI: SettingsView → "Export Backup" + "Import Backup" buttons
- Consequences: ✅ User không lock-in 1 máy ⚠️ Passphrase loss = backup unrecoverable (UX cảnh báo rõ)

**G-4 HWID Algorithm — EXPLICIT in ADR-D2**

```
HWID = SHA-256(machine_uuid + "|" + mac_address + "|" + cpu_brand).slice(0, 64) hex
```

- `machine_uuid`: via `node-machine-id` (cross-platform stable)
- `mac_address`: primary network interface MAC
- `cpu_brand`: CPU model string
- Implementation: `src/main/license/hwid-generator.ts` + backend `app/services/automation/hwid.py`

**G-5 Action Token Signing — EXPLICIT in ADR-D2**

JWT HS256 với claims:
```json
{
  "jti": "<uuid v4>",
  "sub": "<activation_id>",
  "action": "<action_type>",
  "iat": <unix_ts>,
  "nbf": <unix_ts>,
  "exp": <unix_ts + 60>
}
```

- HMAC secret: per-activation, generate khi activate, server-side ONLY (KHÔNG trả client)
- Server verify: `jti` chưa used (Redis SETNX với TTL 60s), `exp` chưa expire, `sub` match activation, `action` match request type

**G-6 Canary Cohort Selection — EXPLICIT in ADR-D4**

```typescript
function isInCanary(hwid: string, configVersion: number, canaryPct: number): boolean {
  const hash = sha256(`${hwid}:${configVersion}`).slice(0, 8);
  const bucket = parseInt(hash, 16) % 100;
  return bucket < canaryPct;
}
```

- Deterministic per user per config version → same user không flip flop trong cùng version
- Different config version → re-roll (diversify cohort over time)

**G-7 Localization Lock VN — NFR EXPLICIT**

- **NFR-P3-Localization-VN-Lock**: Phase 3.0 → 3.4 UI + error message + EULA + privacy policy LOCK Vietnamese
- i18n framework defer Phase 3.5+ nếu mở rộng SEA market
- ErrorEnvelope `message` field: Vietnamese user-facing; `code` field: SCREAMING_SNAKE_CASE English (programmatic)

#### Coherence Validation ✅

| Cluster | Status |
|---|---|
| Platform + IPC + Adapter (D1, D8, R-D16) | ✅ Coherent |
| License + telemetry (D2, D6) | ✅ Coherent |
| Storage (D3, R-D3) | ✅ Coherent |
| Hot config + canary (D4, R-D11, R-D2) | ✅ Coherent |
| Update channel (D5, R-D10, R-D12) | ✅ Coherent |
| Backend extension (D7, D9, Phase 1+2 auth reuse) | ✅ Coherent |

#### Requirements Coverage Validation ✅

- **13/13 FR** (FR-P3-01 → 13) mapped sang location cụ thể
- **All NFR** addressed: Compliance (D7), Stealth (D1+R-D15), Reliability (D4+D6), Security (D3+R-D3+R-D5), License (D2+R-D9), Update (D5+R-D4), Observability (D6+R-D13), Agent-Velocity (patterns+adapter), Localization-VN-Lock (G-7)
- **16/16 R-D anchor** mapped sang code location

#### Implementation Readiness Validation ✅

- **11 ADR-D** documented full format (D1 → D11) — D11 added after gap resolution
- **17 core dep** specified với version + trigger condition cho 4 deferred dep
- **Patterns + Enforcement** với 10 mandatory rule + tooling per rule
- **Project structure** complete: backend extend + frontend extend + automation-desktop NEW

#### Architecture Completeness Checklist

**Requirements Analysis (4/4)**
- [x] Project context thoroughly analyzed (step-02 + pre-mortem v1+v2 + Red Team)
- [x] Scale and complexity assessed (HIGH, desktop-first model)
- [x] Technical constraints identified (Phase 1+2 reuse + FORBIDDEN list)
- [x] Cross-cutting concerns mapped (R-D1 → R-D16)

**Architectural Decisions (4/4)**
- [x] Critical decisions documented (11 ADR-D)
- [x] Technology stack fully specified
- [x] Integration patterns defined (IPC D8 + HTTP D9)
- [x] Performance considerations addressed (benchmark explicit defer Sprint 1)

**Implementation Patterns (4/4)**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure (4/4)**
- [x] Complete directory tree defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

**Total: 16/16 ✅**

#### Architecture Readiness Assessment

**Overall Status: READY FOR IMPLEMENTATION**

**Confidence Level: HIGH**

**Key Strengths**:
1. First Principles validated qua 3 lần stress test (Thesis Defense / Occam / What If)
2. Compliance liability shift tool vendor model → bảo vệ Phase 1+2 SaaS
3. Adapter pattern R-D16 = future migration escape hatch
4. Polyglot solved naturally — Node automation run trên máy user
5. 16 R-D anchor cover pre-mortem v1+v2 + Red Team — defense in depth
6. AI agent friendly — module boundary rõ, Zod strict, lint enforcement

**Areas for Future Enhancement (Phase 3.1+)**:
- Performance benchmark explicit measure (G-8) Sprint 1 baseline
- Telemetry retention + admin tooling (G-9)
- Multi-window architecture nếu cần (G-10)
- i18n framework cho SEA mở rộng (G-7 lift)
- Tauri migration cost evaluation thực nếu Electron deprecate (R-D16 escape hatch)

#### Implementation Handoff

**AI Agent Guidelines (MUST follow)**:
1. R-D16 adapter import discipline — MOST IMPORTANT (ESLint enforce)
2. Zod schema 2-way validation MANDATORY mọi IPC + HTTP
3. Secret marker `Secret<T>` discipline — NEVER bypass
4. Telemetry redaction — block CI nếu vi phạm
5. Follow 11 ADR-D + 16 R-D anchor + 7 layer rule

**First Implementation Story (Phase 3.0 Sprint 1)**:

```
Story 1: Initialize automation-desktop scaffold

Acceptance Criteria:
- npm create @quick-start/electron@latest automation-desktop -- --template react-ts
- Restructure to step-06 folder layout (adapters/ + main/ + preload/ + renderer/ + shared/)
- Apply security baseline overrides (sandbox: true, contextIsolation: true, CSP, cert pinning)
- Wire ESLint custom rules (no-restricted-imports, no-secret-in-ipc-payload, no-secret-tostring,
  no-direct-logger, no-inline-retry, state-machine-uppercase)
- Implement minimal adapter interfaces (ipc, secure-storage, updater, window) + Electron stub impl
- Smoke test: app launches with Vite HMR working in dev mode
- CI: GitHub Actions ci.yml chạy lint + typecheck + smoke test
- Documentation: README.md + ARCHITECTURE.md link tới `_bmad-output/planning-artifacts/architecture.md`
```

#### Pending Business Actions (require Luisphan)

| Action | Block | Status |
|---|---|---|
| Setup separate Apple Developer entity cho Phase 3 ($99/year) | ADR-D5 release pipeline | OPEN |
| Draft EULA + ToS Phase 3 với legal advisor | Public release | OPEN |
| Decide license pricing tier (30/90/180/365 ngày) | Self-service portal | OPEN |
| Decide GitHub repo public/private mix (stable public vs beta/canary private) | Distribution channel | OPEN |
| Decide đăng ký công ty (TNHH 1TV VN hoặc offshore HK/SG/Delaware) — nếu sell-as-a-service | EULA legal entity | OPEN |

---

## Phase 3 Addendum — Checkpoint Auto-Solver (FunCaptcha / reCAPTCHA)

> Thêm 2026-06-04. Bổ sung lớp **SOLVE** vào kiến trúc chống checkpoint 4 lớp của Phase 3.
> Reviewed bởi Winston (System Architect) — quyết định D13 (proxy binding), D14 (safety rails)
> được Luisphan chốt qua phiên review.

### Checkpoint Context & Scope

**Vấn đề:** Khi login bằng cookie, Facebook có thể bung trang checkpoint. Hiện tại
`login-service.ts` và `createSelfCommentLoginAdapter` (trong `electron-bootstrap.ts`) gặp
`CHECKPOINT` là transition **thẳng** sang `CHECKPOINT_BLOCKED` — account coi như chết, bỏ qua
hoàn toàn state `SOLVING_CHECKPOINT` đã được định nghĩa sẵn trong state machine.

**Kiến trúc chống checkpoint 4 lớp (3/4 đã có trước addendum này):**

| Lớp | Trạng thái | Vị trí |
|---|---|---|
| PREVENT (stealth, fingerprint, proxy) | ✅ Đã có | `playwright-runner.ts` + `playwright-extra` stealth |
| DETECT (phát hiện checkpoint) | ✅ Đã có | `checkpoint-handler.ts::detectLoginState()` |
| **SOLVE (giải captcha tự động)** | ❌ **Addendum này** | `src/main/automation/checkpoint/` (mới) |
| FALLBACK (mark CHECKPOINT_BLOCKED) | ✅ Đã có | `login-service.ts` + orchestrator |

**Triết lý kiến trúc (Winston):** Checkpoint là *triệu chứng* khi PREVENT bị nghi ngờ, không
phải bệnh. Solver là **tầng phòng thủ cuối có giới hạn**, không phải động cơ tăng trưởng. Mọi
quyết định bên dưới đều bám nguyên tắc này: best-effort, có rào an toàn, đo được, mặc định OFF.

**State machine integration:** Tận dụng state `SOLVING_CHECKPOINT` có sẵn. Transition mới khi
phát hiện checkpoint solvable: `LOGGING_IN → SOLVING_CHECKPOINT → WARMING_UP` (pass) hoặc
`→ CHECKPOINT_BLOCKED` (fail / không giải được). Không thêm state mới, không sửa TRANSITIONS map.

#### Summary table (5 ADR-D mới)

| ADR | Category | Decision |
|---|---|---|
| P3-D12 | Scope | Chỉ tự giải FUNCAPTCHA + RECAPTCHA_V2; OTP/IDENTITY/UNKNOWN → fallback CHECKPOINT_BLOCKED |
| P3-D13 | Provider | CapSolver primary + 2captcha fallback sau interface `CaptchaSolverClient` chung |
| P3-D14 | Anti-detection | Proxy binding: gửi proxy của profile vào solver task (accepted trade-off lộ proxy ra bên thứ 3) |
| P3-D15 | Reliability | Safety rails: feature flag OFF mặc định + circuit breaker 2 lần/profile + budget cap 10/phiên |
| P3-D16 | Token/Telemetry | Inject token tức thì → re-verify; telemetry `{provider,type,outcome,durationMs}` không log token |

#### ADR-P3-D12 — Checkpoint Solver Scope

**Context:** FB bung nhiều loại checkpoint. Không phải loại nào cũng giải được bằng CAPTCHA API.

**Decision:** Chỉ tự giải `FUNCAPTCHA` (Arkose Labs) + `RECAPTCHA_V2`. Các loại `OTP`,
`IDENTITY` (upload CMND/selfie), `UNKNOWN` → fallback `CHECKPOINT_BLOCKED` (giữ nguyên hành vi cũ).

**Rationale:**
- OTP cần SIM/email thật của account — API không giải được.
- Identity verification cần con người — không tự động hóa được.
- FunCaptcha là loại phổ biến nhất khi login cookie FB → giá trị cao nhất.
- reCAPTCHA v2 hiếm gặp ở FB nhưng chi phí thêm gần như zero (provider hỗ trợ sẵn cùng API surface).
- **Rule of Three:** không build sẵn handler cho loại checkpoint chưa từng gặp.

**Consequences:**
- ✅ Scope rõ ràng, không over-engineer.
- ✅ Loại không giải được vẫn an toàn (fallback cũ), không làm xấu đi tình trạng hiện tại.
- ⚠️ Tỉ lệ "cứu" account phụ thuộc tỉ trọng FunCaptcha trong tổng checkpoint thực tế — cần telemetry (D16) đo.

#### ADR-P3-D13 — Provider Strategy

**Context:** Cần dịch vụ giải captcha bên ngoài. Một provider đơn lẻ là SPOF (hết credit, downtime, rate limit).

**Decision:** **CapSolver primary + 2captcha fallback**, ẩn sau interface `CaptchaSolverClient` chung.

**Pattern:**
```ts
interface CaptchaSolverClient {
  readonly name: string
  solve(params: CaptchaParams): Promise<string>  // trả token string
}
```
- Solver orchestrator thử CapSolver trước; lỗi (PROVIDER_ERROR / timeout / no-credit) → thử 2captcha.
- API key mỗi provider lưu riêng qua SecureStorage (xem D16 persistence).
- HTTP client viết riêng cho checkpoint — KHÔNG tái dùng `shared/api-client/http-client.ts::postJson`
  (error message của nó hardcode "license", sai ngữ cảnh).

**Rationale:**
- CapSolver: AI-driven, rẻ (~$1.8–2.5/1K), nhanh (1–9s) → primary.
- 2captcha: human-backed, chậm hơn (10–30s) nhưng độ phủ tốt → lưới an toàn.
- Interface chung = thêm provider thứ 3 sau này không phá vỡ orchestrator (Rule of Three đã thỏa: 2 impl + fallback requirement).

**Consequences:**
- ✅ Không SPOF provider.
- ✅ Dễ thêm/đổi provider.
- ⚠️ Maintain 2 client + 2 API key. Chấp nhận vì fallback là requirement thật.

#### ADR-P3-D14 — Proxy Binding cho Solver

**Context:** Token Arkose/reCAPTCHA bị FB verify gắn với session. Solver giải bằng IP của *họ*,
trong khi FB verify theo IP *session của profile*. IP mismatch = token bị reject dù giải đúng.

**Decision:** **Truyền proxy của chính profile vào solver task** (CapSolver/2captcha proxy task,
KHÔNG dùng ProxyLess). Quyết định bởi Luisphan: *chấp nhận trade-off lộ proxy ra bên thứ 3*.

**Rationale:**
- Đây là yếu tố **#1** quyết định tỉ lệ pass thực tế. ProxyLess → token gần như chắc chắn bị reject.
- Profile trong Phase 3 đã có proxy (provider `proxyfb`, bind per-profile per-session — ADR Phase 3).
- Proxy credential lookup tại exec time từ proxy service, truyền vào solver client.

**Consequences:**
- ✅ Tỉ lệ token pass cao hơn đáng kể.
- ⚠️ **Proxy credential (user/pass) gửi tới CapSolver/2captcha** — thêm một đường lộ secret ra bên
  thứ 3. Accepted trade-off. Mitigation: chỉ gửi tại thời điểm solve, không log, không lưu lại phía
  client ngoài SecureStorage hiện có.
- ⚠️ Proxy chết/timeout → solve fail; tính vào circuit breaker (D15).

#### ADR-P3-D15 — Safety Rails

**Context:** Solver tốn tiền thật mỗi lần gọi + giải sai lặp lại làm FB nghi ngờ nặng hơn (phản tác
dụng). Một bug loop có thể đốt sạch credit trong đêm.

**Decision:** Ba lớp rào, **tất cả chốt bởi Luisphan**:
1. **Feature flag mặc định OFF** — opt-in qua local setting (giống `AUTOMATION_BROWSER_HEADLESS_SETTING`).
   Không bao giờ bật ngầm. Không có API key cũng coi như OFF.
2. **Circuit breaker per-profile: 2 lần** — 1 profile fail solve 2 lần → ngừng thử, mark `CHECKPOINT_BLOCKED`.
3. **Budget cap: 10 lần/phiên** — tối đa 10 lần solve mỗi phiên bulk run; chạm trần → các checkpoint
   còn lại fallback `CHECKPOINT_BLOCKED` ngay không gọi API.

**Rationale:**
- Flag OFF: solver là tính năng tốn phí + rủi ro → opt-in là mặc định an toàn.
- Breaker 2 lần: cân bằng giữa cơ hội pass (lần 2 đôi khi pass) và tránh đốt tiền/account.
- Cap 10/phiên: trần chặn bug loop, đủ cho batch vừa.

**Consequences:**
- ✅ Chi phí + rủi ro account bị chặn trên.
- ✅ Mặc định an toàn cho user chưa cấu hình.
- ⚠️ Cap có thể chặn phiên bulk rất lớn (>10 checkpoint) — chấp nhận; có thể nâng qua setting sau nếu cần.

#### ADR-P3-D16 — Token Lifecycle, Persistence & Telemetry

**Context:** Token Arkose hết hạn nhanh (gắn session + thời điểm). API key + proxy là secret. Cần đo
tỉ lệ pass thật để biết feature có đáng giữ.

**Decision:**
- **Lifecycle:** solve xong **inject token tức thì** vào page → re-verify bằng `detectLoginState()`.
  `LOGGED_IN` → transition `WARMING_UP`. Còn checkpoint → đếm vào breaker; hết lượt → `CHECKPOINT_BLOCKED`.
- **Persistence:** API key (`captcha.capsolver.api_key`, `captcha.2captcha.api_key`) lưu qua
  **SecureStorage** (OS keychain), KHÔNG vào SQLite, KHÔNG đi qua IPC payload (tuân thủ R-D3).
  IPC chỉ có `set` (write-only) + `status` (báo đã cấu hình chưa) — không bao giờ trả key về renderer.
- **Telemetry:** ghi `{ provider, checkpointType, outcome, durationMs }` vào job result + beacon.
  `outcome` khớp enum `action_outcome_category` của ADR-P3-D6 (`success | checkpoint | ...`).
  **TUYỆT ĐỐI KHÔNG log token, API key, proxy credential** (R-D3 + ESLint `no-direct-logger`).

**Rationale:**
- Inject tức thì vì token chết nhanh — không cache, không trì hoãn.
- Write-only IPC cho key = renderer compromised cũng không đọc được key.
- Telemetry là cách duy nhất biết tỉ lệ pass thật → quyết định giữ/bỏ feature sau này.

**Consequences:**
- ✅ Token dùng trong cửa sổ còn sống.
- ✅ Secret discipline nguyên vẹn.
- ✅ Đo được hiệu quả thực.
- ⚠️ Phần inject + re-verify chạy trên FB thật → không unit-test tự động được (xem Test Strategy bên dưới).

### Checkpoint Solver — Module Structure & Boundaries

```
src/main/automation/checkpoint/
├── types.ts                      # CheckpointType, CaptchaParams, SolveResult,
│                                 #   CaptchaSolverClient interface, CheckpointPageLike
├── checkpoint-type-detector.ts   # detectCheckpointType(page) + extractCaptchaParams(page,type)
├── capsolver-client.ts           # CapSolver REST (primary): createTask + poll getTaskResult
├── two-captcha-client.ts         # 2captcha REST (fallback): in.php + res.php poll
├── checkpoint-solver.ts          # orchestrator: detect → extract → solve(provider fallback)
│                                 #   → inject token → re-verify; circuit breaker + budget
└── index.ts                      # barrel export
```

**Boundaries (tuân thủ R-D16 adapter discipline):**
- Module nằm trong `main/automation/` → KHÔNG import `electron` trực tiếp. HTTP qua `fetch` (Node global) là hợp lệ.
- API key + proxy credential nhận qua **dependency injection** từ `electron-bootstrap.ts` tại wiring time
  (bootstrap đọc từ SecureStorage + proxy service), KHÔNG tự đọc adapter bên trong module.
- `CheckpointPageLike` interface hẹp (subset của Playwright `Page`) → unit test mock được không cần browser.
- HTTP `postJson` injectable qua deps → test mock được, không gọi mạng thật.

**Integration points (2 login path — sửa CẢ HAI):**

| File | Dòng hiện tại | Thay đổi |
|---|---|---|
| `electron-bootstrap.ts::createSelfCommentLoginAdapter` | `if (state === 'CHECKPOINT') return ...CHECKPOINT_BLOCKED` (~L236) | Nếu flag ON + có key: transition `SOLVING_CHECKPOINT`, gọi solver; pass → re-detect → `LOGGED_IN`; fail → giữ fallback |
| `login-service.ts::login` | transition thẳng `CHECKPOINT_BLOCKED` (L102–110) | Chèn nhánh solver tương tự (path dùng trong test + future) |

> ⚠️ `electron-bootstrap.ts::createSelfCommentLoginAdapter` là path chạy **production thật**.
> `login-service.ts` là path có sẵn hook `onCheckpoint` (dùng trong unit test). Phải đồng bộ cả hai.

**IPC channels mới (ADR-P3-D8 compliant — Zod 2-way, ErrorEnvelope tiếng Việt + retryable):**

| Channel | Request | Response | Ghi chú |
|---|---|---|---|
| `phase3:captcha:set-key` | `{ provider: 'capsolver'\|'2captcha', apiKey: string(min1) }` | `{ ok: true }` \| ErrorEnvelope | Write-only → SecureStorage. KHÔNG echo key. |
| `phase3:captcha:status` | `{}` | `{ ok: true, capsolver: boolean, twocaptcha: boolean, enabled: boolean }` | Chỉ báo đã-cấu-hình (boolean), KHÔNG trả key. |

### Checkpoint Solver — Test Strategy

**Nghịch lý:** phần dễ test nhất thì test được, phần rủi ro nhất thì không test tự động được.

| Thành phần | Loại test | Cách |
|---|---|---|
| `checkpoint-type-detector` | Unit | Feed HTML fixture (FunCaptcha/reCAPTCHA/OTP/identity) → assert type + extracted params |
| `capsolver-client` / `two-captcha-client` | Unit | Mock `postJson` → assert request shape + parse response + error mapping |
| `checkpoint-solver` orchestration | Unit | Mock detector + clients + page → assert provider fallback, breaker, budget, transition sequence |
| IPC `set-key` / `status` | Integration | Real IPC + SecureStorage stub → assert write-only, không leak key, Zod 2-way |
| **Inject token + re-verify trên FB thật** | **Manual protocol** | KHÔNG tự động được — viết protocol thủ công, gate sau feature flag |

**Manual test protocol (bắt buộc trước khi bật production):**
1. Cấu hình API key CapSolver (có credit) qua settings.
2. Bật feature flag. Dùng account thật dính FunCaptcha checkpoint, có proxy bind.
3. Quan sát: detect đúng type → solve trả token → inject → re-verify → `LOGGED_IN`.
4. Ghi nhận tỉ lệ pass thực qua telemetry. Tinh chỉnh selector extract nếu params không tìm thấy.

> Tuân thủ project rule: KHÔNG `test.fixme` trên task đã tick verify. Phần manual ghi rõ là manual,
> không giả vờ có automated coverage.

### Checkpoint Solver — Validation & Risks

**Coherence với Phase 3 hiện có:**

| Liên kết | Trạng thái |
|---|---|
| State machine `SOLVING_CHECKPOINT` (đã định nghĩa) | ✅ Tận dụng, không sửa TRANSITIONS |
| Secret discipline R-D3 (key/proxy không qua IPC payload raw) | ✅ Write-only IPC + SecureStorage |
| Telemetry enum `action_outcome_category` (D6) | ✅ outcome khớp enum |
| Adapter layer R-D16 | ✅ DI từ bootstrap, module không import electron |
| ErrorEnvelope tiếng Việt + retryable (D8) | ✅ Áp dụng cho IPC mới |

**Rủi ro tồn dư (residual risks):**
- 🔴 **Token pass không đảm bảo 100%** — FB có thể siết binding server-side. Solver là best-effort; D15 breaker chặn đốt tài nguyên.
- 🟡 **Selector extract FunCaptcha fragile** — FB đổi DOM → extract params fail. Mitigation: detector trả `PARAMS_NOT_FOUND` → fallback sạch; hot-config selector (D4) có thể mở rộng cover sau.
- 🟡 **Chi phí vận hành** — mỗi solve tốn tiền. D15 budget cap + telemetry chi phí giám sát.
- 🟢 **Proxy leak** — accepted (D14), giới hạn ở thời điểm solve, không log.

**Implementation sequence đề xuất:**
```
1. types.ts + checkpoint-type-detector.ts (+ unit test, HTML fixtures)
2. capsolver-client.ts + two-captcha-client.ts (+ unit test mock HTTP)
3. checkpoint-solver.ts orchestrator (+ unit test: fallback, breaker, budget)
4. IPC set-key + status (+ integration test)
5. Wiring vào electron-bootstrap.ts + login-service.ts (đồng bộ 2 path)
6. Feature flag setting + (optional) Settings UI nhập key
7. Manual test protocol với account thật
```

**Status: DOCUMENTED — READY FOR IMPLEMENTATION (sau khi user cấp API key + bật flag để test thật)**






