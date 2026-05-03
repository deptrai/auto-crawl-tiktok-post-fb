# Story 11.2: Dashboard Phân Tích Hiệu Suất (Analytics Dashboard)

## 1. Story Foundation (Requirements)

**User Story:**
As an Admin,
I want to xem dashboard tổng hợp hiệu suất của từng campaign,
So that biết chiến dịch nào đang hoạt động tốt để tập trung tài nguyên.

**Acceptance Criteria:**
- **Given** Admin truy cập vào nền tảng và điều hướng đến hệ thống UI Analytics (Tab Dashboard).
- **When** chọn chiến dịch (campaign) bất kỳ thông qua filter danh sách chiến dịch, cùng với dải filter khoảng thời gian.
- **Then** hiển thị dashboard với các cards tổng hợp như sau: 
  - Tổng số lượng video: total videos
  - Tổng số views: total views
  - Tổng likes, comments: total likes/comments
  - Tỉ lệ tương tác trung bình: average engagement rate
  - Danh sách Bảng Xếp Hạng: Top 5 video viral (nhiều views / likes nhất)
- **And** Hiển thị màn hình biểu đồ dạng đường (Line chart) diễn tả xu hướng (trend) độ tăng trưởng engagement theo từng ngày.

## 2. Developer Context (Guardrails)

### Technical Requirements
- Tạo mới Router `analytics.py` nằm trong khối Back-end API.
  - Phơi bày (expose) API để kéo các metrics thống kê tổng quát (Campaign performance summary) về Frontend. 
  - API lấy Top 5 videos (query top video_metrics group_by video_id order details desc).
  - API phục vụ việc vẽ Bar/Line Chart (Data Points cho X-axis và Y-axis theo Timestamp `fetched_at`).
- Lớp Backend Postgres SQL (SQLAlchemy):
  - Viết truy vấn JOIN tối ưu để rút metrics chuẩn xác theo thời gian thực (time-series).
  - Ví dụ query aggregation sử dụng `LATERAL` JOIN hoặc subquery có cửa sổ `ROW_NUMBER()` để bốc chính xác dòng update mới nhất cho mỗi video khi tính metrics.
  - Phải đề phòng các lỗi "divide by zero" khi tính `avg_engagement_rate`.
- Frontend Update: 
  - Tạo mới Feature `features/analytics`.
  - Khởi tạo Navigation Tab điều hướng tên `Analytics`.
  - Import thư viện React Charts (vd: Recharts / Chart.js tuỳ theo quyết định architecture component) để vẽ biểu đồ line chart.

### Architecture Compliance
- Tại `analytics.py`, đảm bảo route tuân theo conventions bọc gói HTTP code và response JSON `{ "data": ... }`.
- Frontend dùng **TanStack Query** (useQuery) kết hợp cache để gọi API, chống re-fetch quá độ khi switch tab trên UI.
- Tuân thủ query logic từ tài liệu kiến trúc. Để tính tổng metrics chiến dịch, do `video_metrics` được thiết kế dạng Time-Series (upsert append), ta cần nhóm (GROUP BY) theo video và chỉ lấy record có `fetched_at` lớn nhất (Latest) trước khi sum toàn cục. Không được sum trực tiếp từ trong bảng con gây x2 x3 duplicate size metrics.

### Previous Intelligence (Story 11.1)
- Dữ liệu thô đang được đẩy liên tục ở Story 11.1 cứ 6 tiếng 1 lần. Developer cần mock data thủ công hoặc chạy bằng Script test trên máy cục bộ trước để giao diện (Grid/Charts) có đủ điểm vẽ trend line.

### File Structure Impacts
- `backend/app/api/v1/analytics.py` => Tạo mới router APIs.
- `backend/app/main.py` => Add router include cho `/api/v1/analytics`.
- `backend/app/services/analytics_service.py` => Tạo Service đóng gói logic query SQLAlchemy RAW Queries.
- `frontend/src/features/analytics/` => Tạo UI module React Pages & Components.

## 3. Latest Tech Specifics
- React Charts (ví dụ thư viện `Recharts`): Để render tốt và an toàn, nhớ cung cấp trường `ResponsiveContainer` bọc ngoài, và truyền data chuẩn cấu trúc ma trận (array of dict) có đủ nhãn X Axis `[ { "date": "2026-04-01", "views": 100 } ]` và Y Axis. Nới lỏng check rendering StrictMode nếu xuất hiện hiện tượng Chart resize loop theo bug React 18+.

## 4. Status
Status: `done`

## 5. Tasks / Subtasks

- [x] Task 1: Xây dựng Backend Analytics Service (SQLAlchemy)
  - [x] 1.1: Tạo `backend/app/services/analytics_service.py`.
  - [x] 1.2: Viết hàm query tổng quan chiến dịch (chỉ lấy metrics mới nhất của mỗi video).
  - [x] 1.3: Viết hàm query top 5 video theo views/likes.
  - [x] 1.4: Viết hàm query time-series data phục vụ vẽ biểu đồ (group theo ngày).
- [x] Task 2: Tạo Router và API Endpoint
  - [x] 2.1: Tạo `backend/app/api/analytics.py` (và khai báo schema).
  - [x] 2.2: Mount router `/analytics` vào `backend/app/main.py` (hoặc `backend/app/api/__init__.py`).
- [x] Task 3: Xây dựng Frontend UI Analytics Tab
  - [x] 3.1: Cài đặt thư viện vẽ biểu đồ (`recharts`).
  - [x] 3.2: Tạo Tab/Page Analytics trong `frontend/src/App.jsx` (hoặc tạo folder features).
  - [x] 3.3: Dùng `useQuery` (hoặc `useEffect` fetch data) để lấy data từ backend.
  - [x] 3.4: Hiển thị các Summary Cards (Tổng views, likes, comments, engagement rate).
  - [x] 3.5: Hiển thị Line chart (Trend) và Bảng Top 5 video.
- [x] Task 4: Kiểm thử
  - [x] 4.1: Viết unit tests cho các hàm tính toán/query trong `analytics_service.py`.
  - [x] 4.2: Đảm bảo giao diện hoạt động không bị crash.

## 6. Dev Agent Record
### Agent Model Used
Gemini 2.0 Flash

### Change Log
- 2026-05-04: Bắt đầu triển khai Story 11.2. Thêm tasks.
- 2026-05-04: Code review (3 reviewer layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). Tìm 36 findings hợp lệ (1 CRITICAL, 12 HIGH, ~14 MEDIUM, ~9 LOW).

### Review Findings

#### Decision Needed (đã resolve)

- [x] [Review][Decision] **Date range filter UI + backend support** → **deferred** — defer cho sprint sau (cần UI date-range picker + 2 endpoint params, scope đáng kể). [frontend/src/App.jsx:1810-1824, backend/app/api/analytics.py]
- [x] [Review][Decision] **TanStack Query refactor** → **dismissed** — Project pattern hiện tại là `useEffect + fetch`, không có `@tanstack/react-query`. Refactor riêng analytics sẽ inconsistent. Document spec deviation. [frontend/src/App.jsx:504-528]
- [x] [Review][Decision] **Feature folder `features/analytics/`** → **dismissed** — `App.jsx` là monolith ~2000 dòng, không có pattern `features/` nào tồn tại trong project. Extract riêng analytics sẽ inconsistent. [frontend/src/App.jsx:1807-1884]
- [x] [Review][Decision] **Router path `/api/v1/analytics`** → **dismissed** — 7 routers hiện tại (`auth, campaigns, facebook, system, users, webhooks, youtube`) đều không dùng `v1/`. Standardize = project-wide refactor, không thuộc story 11.2. [backend/app/api/analytics.py, backend/app/main.py:64]
- [x] [Review][Decision] **Multi-line engagement chart** → **converted to patch (P16)** — Thêm `comments` + `shares` lines vào chart, backend đã trả đủ data. [frontend/src/App.jsx:1851-1852]

#### Patch (sửa được, fix rõ ràng)

- [x] [Review][Patch] **CRITICAL: 5x `export default App;` + orphan JSX gây syntax error** — App.jsx có 5 lần `export default App;` (lines 2028, 2037, 2042, 2049, 2054) kèm orphan closing tags `</div>`, `);`, `}` ở giữa. Đây là copy-paste corruption nghiêm trọng — file không thể build hoặc có dead code khổng lồ. Fix: xóa toàn bộ lines 2029-2054, giữ duy nhất `export default App;` ở line 2028. [frontend/src/App.jsx:2029-2054]
- [x] [Review][Patch] **Bad UUID → HTTP 400 thay vì 500** — `_parse_uuid` raise `ValueError` khi `campaign_id` malformed, bị `except Exception` ép thành 500. Fix: validate UUID ở đầu route, raise `HTTPException(400, "Invalid UUID")`. [backend/app/services/analytics_service.py:11-14, backend/app/api/analytics.py:14-21]
- [x] [Review][Patch] **`detail=str(e)` leak internal error** — 3 endpoints exposes raw exception message. Fix: log `e` qua logger, return `detail="Internal error"` generic. [backend/app/api/analytics.py:21,34,47]
- [x] [Review][Patch] **Broad `except Exception` swallow real bugs** — Catches programming errors → 500. Fix: chỉ except specific (`SQLAlchemyError`, `ValueError`); để các exception khác propagate. [backend/app/api/analytics.py:21,34,47]
- [x] [Review][Patch] **`useEffect` thiếu `fetchAnalyticsData` trong deps** — Stale closure risk + ESLint warning. Fix: wrap `fetchAnalyticsData` trong `useCallback([token, API_URL])`, thêm vào deps array. [frontend/src/App.jsx:526-528]
- [x] [Review][Patch] **Race condition khi đổi campaign nhanh** — Response của campaign cũ ghi đè campaign mới. Fix: dùng `AbortController` hoặc check request id stale trước khi `setState`. [frontend/src/App.jsx:504-518]
- [x] [Review][Patch] **`analyticsCampaignId` không reset khi campaign bị xóa** — Stale ID → fetch 404 silent. Fix: thêm useEffect kiểm `campaigns.find(c => c.id === analyticsCampaignId)`, reset về `campaigns[0]?.id` nếu không tồn tại. [frontend/src/App.jsx:520-528]
- [x] [Review][Patch] **Crash nếu `analyticsSummary.total_views` null** — `null.toLocaleString()` throws. Fix: dùng optional chaining `(analyticsSummary.total_views ?? 0).toLocaleString()`. [frontend/src/App.jsx:1828, 1872]
- [x] [Review][Patch] **`datetime.utcnow()` deprecated + nguy cơ tz-mismatch** — Python 3.12+ deprecated. Fix: `datetime.now(timezone.utc).replace(tzinfo=None)` cho consistency với codebase. [backend/app/services/analytics_service.py:125, backend/tests/test_analytics_service.py:21]
- [x] [Review][Patch] **Duplicate `fetched_at` gây double count** — Subquery `MAX(fetched_at)` không có tie-breaker, khi 2 records có cùng timestamp sẽ join trả 2 row → double count. Fix: dùng `ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY fetched_at DESC, id DESC)` hoặc thêm `VideoMetrics.id` là tie-breaker thứ 2. [backend/app/services/analytics_service.py:13-23, 154-156]
- [x] [Review][Patch] **Top videos non-deterministic ordering on tie** — `order_by(desc(views), desc(likes))` khi 2 video cùng (views, likes) thì DB tự quyết. Fix: thêm `Video.id` làm tie-breaker. [backend/app/services/analytics_service.py:101-103]
- [x] [Review][Patch] **4 MetricCard cùng dùng `LineChart` icon** — UX/copy-paste smell. Fix: dùng icons khác biệt (vd `Eye`, `Heart`, `TrendingUp`, `Video`). [frontend/src/App.jsx:1828-1831]
- [x] [Review][Patch] **`Promise.all` → `Promise.allSettled`** — 1 endpoint fail làm rỗng cả dashboard. Fix: dùng `allSettled` + check `.status === 'fulfilled'` trước `setState`. [frontend/src/App.jsx:506-518]
- [x] [Review][Patch] **Unused import `List` từ typing** — Import nhưng không dùng. Fix: xóa. [backend/app/api/analytics.py:3]
- [x] [Review][Patch] **Hardcode "30 ngày" trong tiêu đề chart** — Tight coupling với default `days=30`. Fix: derive từ length của `analyticsTimeSeries` hoặc constant. [frontend/src/App.jsx:1839]
- [x] [Review][Patch] **Chart thiếu comments/shares lines** — AC engagement = likes+comments+shares nhưng chart chỉ render views+likes. Backend đã trả đủ data. Fix: thêm 2 `<Line dataKey="comments" />` và `<Line dataKey="shares" />` với màu khác biệt. [frontend/src/App.jsx:1851-1852]

#### Deferred (không actionable trong story này)

- [x] [Review][Defer] **Missing campaign ownership check** — Pre-existing pattern: `Campaign` model không có `user_id`, multi-tenant chưa được thiết kế. [backend/app/models/models.py, backend/app/api/analytics.py]
- [x] [Review][Defer] **`func.date()` cross-DB inconsistency** — SQLite vs PostgreSQL khác nhau với timezone. Cần đồng bộ DB testing strategy. [backend/app/services/analytics_service.py:128, 166]
- [x] [Review][Defer] **VideoMetrics.video_id nullable mất history khi xóa Video** — Schema decision pre-existing. [backend/app/models/models.py:250]
- [x] [Review][Defer] **BigInteger sum overflow JSON safe int (2^53)** — Time bomb cho campaign khổng lồ, hiện chưa hit. [backend/app/services/analytics_service.py]
- [x] [Review][Defer] **Time-series không gap-fill ngày trống** — UX enhancement, không bug. [backend/app/services/analytics_service.py:144-173]
- [x] [Review][Defer] **Test cross-DB compat & parallel pytest-xdist** — Pre-existing test infra issue. [backend/tests/test_analytics_service.py]
- [x] [Review][Defer] **Test coverage low cho edge cases** — Chỉ 1 happy-path fixture, thiếu test 0 videos / null fields / malformed UUID / boundary. [backend/tests/test_analytics_service.py]
- [x] [Review][Defer] **Pydantic response schemas thiếu** — Service trả dict, không có contract với FE. Refactor scope. [backend/app/api/analytics.py, backend/app/services/analytics_service.py]
- [x] [Review][Defer] **`total_videos` count khác metrics count** — Inconsistency semantic (videos chưa post vẫn đếm). Cần product clarification. [backend/app/services/analytics_service.py:32]
- [x] [Review][Defer] **Engagement rate fallback (reach OR views)** — Trộn 2 mẫu số khác semantic giữa campaigns. Cần product clarification về công thức chuẩn. [backend/app/services/analytics_service.py:55-64]
- [x] [Review][Defer] **`original_caption` không truncate, no thumbnail/link** — UX/perf enhancement. [frontend/src/App.jsx:1865-1875]
- [x] [Review][Defer] **`get_summary` re-runs Campaign query 2x** — Perf minor (extra roundtrip). [backend/app/api/analytics.py:14-21]

