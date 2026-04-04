---
stepsCompleted: ['step-01-init.md', 'step-02-context.md', 'step-03-starter.md', 'step-04-decisions.md', 'step-05-patterns.md', 'step-06-structure.md', 'step-07-validation.md', 'step-08-complete.md']
inputDocuments: ['_bmad-output/planning-artifacts/prd.md', '_bmad-output/project-context.md']
workflowType: 'architecture'
project_name: 'auto-crawl-tiktok-post-fb'
user_name: 'luisphan'
lastStep: 8
status: 'complete'
completedAt: '2026-03-30'
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
