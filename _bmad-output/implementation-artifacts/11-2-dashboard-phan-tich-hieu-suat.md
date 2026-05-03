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
Status: `review`

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

