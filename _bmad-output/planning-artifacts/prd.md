---
stepsCompleted: ['step-01-init.md', 'step-02-discovery.md', 'step-02b-vision.md', 'step-02c-executive-summary.md', 'step-03-success.md', 'step-04-journeys.md', 'step-05-domain.md', 'step-07-project-type.md', 'step-08-scoping.md', 'step-09-functional.md', 'step-10-nonfunctional.md', 'step-11-polish.md', 'step-e-01-discovery', 'step-e-02-review', 'step-e-03-edit']
inputDocuments: ['_bmad-output/project-context.md']
workflowType: 'prd'
workflow: 'edit'
classification:
  projectType: 'saas_b2b_automation'
  domain: 'social_media_marketing_automation'
  complexity: 'medium'
  projectContext: 'brownfield'
---

# Product Requirements Document - auto-crawl-tiktok-post-fb

**Author:** Luisphan
**Date:** 2026-03-29

## Executive Summary

Dự án này hướng tới việc tự động hóa toàn trình quy trình phân phối nội dung video ngắn từ TikTok sang hệ sinh thái mạng xã hội Facebook. Bằng cách gỡ bỏ các thao tác thủ công lặp đi lặp lại (như tải video, xóa ngấn nước, hẹn giờ đăng bài), hệ thống tái cấu trúc lại năng suất làm việc thông qua một luồng xử lý liền mạch hoạt động ngầm 24/7. Giải pháp này dành cho các nhà sáng tạo nội dung và tổ chức Affiliate muốn mở rộng quy mô, cho phép họ vận hành hệ thống nghìn luồng nội dung chỉ với vài cú click thiết lập.

### Core Value Proposition

Lợi thế cạnh tranh cốt lõi của công cụ không nằm ở giao diện hào nhoáng, mà nằm ở sức bền hạ tầng:
- **Tách biệt luồng API & Worker:** Kiến trúc tách đôi độc đáo giữa khối nhận tin (FastAPI) và khối xử lý nặng (APScheduler), đảm bảo tải lượng lớn video không làm crash giao diện web.
- **Tính tương thích Webhook tuyệt đối:** Cơ chế phản hồi "HTTP 200 OK" siêu tốc dưới 50ms giúp lách qua các tiêu chuẩn khắt khe nhất của Meta, chặn đứng rủi ro bị khóa App do rớt mạng.
- **Vượt rào cản nền tảng (Anti-ban):** Sự kết hợp uyển chuyển giữa `yt-dlp`, cơ chế Proxy, và khối xử lý lỗi tĩnh (Pause/Retry logic) đảm bảo tỉ lệ sống sót tối đa trước thuật toán cản bot của TikTok.

## Project Classification

- **Loại dự án:** Nền tảng Tự động hóa / SaaS B2B
- **Lĩnh vực:** Social Media Marketing Automation
- **Độ phức tạp:** Medium (Yêu cầu khắt khe về bất đồng bộ và xử lý Webhook)
- **Ngữ cảnh dự án:** Brownfield (Tối ưu và quy chuẩn hóa từ repo hiện có)

## Success Criteria

### User Success
- **100% Zero-Touch:** Giải phóng toàn bộ thao tác tải và đẩy video thủ công lên trang Facebook đích.
- **Độ trễ tiêu chuẩn:** Thời gian từ lúc video đẩy lên luồng cho đến khi xuất hiện trên bài đăng thực tế trung bình dưới 10 phút.

### Business/Domain Success
- **Độ bền vững:** Tỷ lệ cào dữ liệu và phân phối thành công đạt lớn hơn 95%, chịu được các lệnh quét IP thông thường.
- **Hiệu suất nhân lực:** Hệ thống thay thế tương đương sức lao động của 2-3 nhân viên trực luồng mạng xã hội hằng ngày.

### Technical Success
- **Zero UI Timeout:** Giao diện điều khiển không bao giờ bị tắt nghẽn dẫu luồng Worker đang cào hàng Gb dữ liệu.
- **Tương tác API chuẩn xác:** Tỷ lệ timeout cho webhook xác minh tính hợp lệ từ Facebook Meta xấp xỉ 0%.
- **Container Uptime:** Node xử lý nền (Worker) đạt tỷ lệ sống sót 99% mà không bị hệ điều hành Kill vì rò rỉ RAM (OOM).

## User Journeys

**1. Hành trình Thiết lập Phễu (Người dùng chính)**
*   **Bối cảnh:** Affiliate Marketer cần tải 50 video mỗi ngày đăng lên Fanpage.
*   **Hành động:** Nạp danh sách các kênh TikTok cần cào vào hệ thống và ghép cặp với trang Facebook đã gắn Access Token.
*   **Kết quả:** Hệ thống Worker kích hoạt khối lập lịch `APScheduler`, âm thầm lấy Data bằng `yt-dlp` và tự động dùng Meta Graph API đăng nội dung theo chu kỳ. Dashboard chuyển trạng thái sang "Thành Công" mà không cần treo máy.

**2. Hành trình Khôi phục hệ thống (Người dùng chính)**
*   **Bối cảnh:** TikTok siết thuật toán, IP cào bị khóa tạm thời.
*   **Hành động:** Hệ thống chủ động hứng lỗi (try/catch), tạm ngưng quy trình thay vì dội Request vô tội vạ. Người dùng gắn chuỗi IP ngoại (Proxy) vào config và bấm "Retry".
*   **Kết quả:** Luồng bị đứt đoạn cấp tốc chạy lại tiếp tục tại điểm dừng mà không down lại các video cũ gây tốn băng thông.

**3. Hành trình Xác minh Webhook (Quản trị Hệ thống)**
*   **Bối cảnh:** Bắt buộc tuân thủ đường hầm nhận biến động (Updates) từ Facebook thông qua Public Domain.
*   **Hành động:** Khởi chạy Cloudflare Tunnel, Meta ập Request Ping xác minh Webhook vào hệ thống.
*   **Kết quả:** API Router gọn nhẹ dội trả "HTTP 200" tức thì, mở khóa việc cập nhật trạng thái "Live" Realtime cho bài báo trên Facebook.

## Product Scope & Phased Roadmap

### MVP Strategy & Philosophy
Mục tiêu giai đoạn 1 là **Giá trị Cốt lõi & Sự Bền bỉ (Stability-First)**. Thay vì chạy đua nhúng AI hay thêm giao diện phức tạp, ưu tiên chứng minh khả năng một luồng video đi mượt mà hai chiều mà không bị rò rỉ tài nguyên hệ thống (Memory leak).

### Phase 1: Minimum Viable Product (MVP)
- Tích hợp Module thu thập video chất lượng gốc không ngấn nước (`yt-dlp`).
- Thiết lập tuyến Webhook API xử lý bất đồng bộ I/O bảo chứng đường luân chuyển Facebook.
- Khối Background Worker chuyên biệt xử lý riêng phần tải nằng bằng thư viện `APScheduler`.
- Giao diện Admin quản trị React Vite đơn giản giám sát Token và Bảng trạng thái Log.
- Tính năng Tạm dừng (Pause) & Khởi động lại (Retry) thủ công khi gặp IP Block.

### Phase 2: Growth (Tăng trưởng Quy mô)
- **Proxy Pool Management:** Bổ sung giao diện quản lý Trạm Proxy trực quan để Bypass thuật toán.
- **Multi-Accounts Routing:** Chức năng phân phối siêu tốc: Đẩy một nội dung gốc sang vô hạn các môi trường Page Facebook phụ khác nhau cùng lúc.

### Phase 3: Vision (Định dạng Đa Kênh)
- **Omnichannel Distribution:** Mở rộng đường dẫn tới YouTube Shorts và Instagram Reels API bằng một cú Click.
- **AI Content Spinning:** Tích hợp AI Agent (OpenAI/Claude) cho phép tự động dịch, xào bài, và lên hashtag thông minh tùy thuộc ngữ cảnh nền tảng đích.

## Domain & B2B Architecture Requirements

*Nền tảng Tự động hóa B2B đánh dấu trái tim của sự tồn tại nằm ở máy cày Worker và Quản lý Lỗi (Error Handling), không nằm ở một Frontend lồng lộn.*

- **Kiến trúc phân rã (Decoupled Design):** Ứng dụng phải được chia tách rõ ràng: Database (Lưu vết), FastAPI (Khối tiếp Webhook siêu tốc), và APScheduler (Bắp thịt cào dữ liệu).
- **Tuân thủ Tiêu chuẩn Rate Limit:** Triệt tiêu mọi hàm lặp (loops) gọi API phi lý vì rủi ro khóa ứng dụng mạng xã hội (App Suspension).
- **Mã hóa và Bảo mật (Secret Management):** Chuỗi Access Token Facebook cấp cao, Cookies định danh TikTok tuyệt đối phải được mã hóa tại ổ cứng, mã nguồn đi kèm rào chắn kiểm tra vòng đời của token.
- **Ủy quyền Oauth & Đăng kí Graph API (v18+):** Chịu trách nhiệm trực tiếp luồng Upload Reels. Buộc xin xét duyệt quyền `pages_show_list` và `pages_manage_posts`.

## Functional Requirements

### Cấu hình Nguồn và Đích
- **FR1:** Admin có thể thêm, sửa, hoặc xóa nhiều đường dẫn kênh TikTok để làm dữ liệu nguồn.
- **FR2:** Admin có thể liên kết tài khoản/Page Facebook vào hệ thống thông qua việc tiếp nhận Access Token định danh.
- **FR3:** Admin có thể thiết lập ghép cặp (Mapping) nội dung từ một Nguồn Tiktok đẩy sang một Đích đến Facebook cụ thể.

### Thu thập dữ liệu gốc
- **FR4:** Hệ thống có thể quét và nhận diện danh sách video mới trên một luồng TikTok gốc.
- **FR5:** Hệ thống có thể tự động loại bỏ (filter) các video đã từng tải hoặc đăng thành công trong quá khứ để tránh trùng lặp nội dung.
- **FR6:** Hệ thống có thể tải xuống file video gốc với chất lượng cao (không chèn watermark).
- **FR7:** Hệ thống có thể trích xuất nguyên vẹn văn bản mô tả (caption) và bộ thẻ hashtag từ bài viết của kênh gốc.

### Lập lịch & Quản lý Phân phối
- **FR8:** Hệ thống có thể cấp phát (enqueue) các khối lệnh Tải/Đăng vào một chuỗi hàng đợi xử lý ngầm bất đồng bộ.
- **FR9:** Hệ thống có thể tự động upload toàn bộ metadata và file video lên môi trường Facebook theo kết nối đã định trước.
- **FR10:** Admin có thể cấu hình thông số "Thời gian chờ" ngẫu nhiên giữa các lần đăng video để mô phỏng hành vi tự nhiên.

### Khôi phục tự động & Quản trị Rủi ro
- **FR11:** Hệ thống có thể bắt các tín hiệu lỗi kỹ thuật (403 Forbidden/Rate limits) từ phía nền tảng gốc.
- **FR12:** Hệ thống tự động thay đổi trạng thái của luồng làm việc thành "Tạm ngưng" khi nhận diện rào cản từ chối lớn (Fatal errors).
- **FR13:** Admin có thể cấu hình cơ sở dữ liệu IP Ngoại (Proxy Pool) cho thiết bị cào dữ liệu.
- **FR14:** Admin có thể can thiệp kích hoạt thủ công "Chạy lại" (Retry) cho tiến trình bị đứt gãy giữa chừng mà không cần làm lại từ đầu.

### Giao tiếp Thời gian thực (Webhook)
- **FR15:** Hệ thống có thể tiếp nhận và phản hồi đúng chuẩn các tín hiệu trinh sát Challenge để bảo vệ tính hợp pháp cho Webhook của Meta.
- **FR16:** Hệ thống có khả năng nhận các bản tin trạng thái từ Meta API để đồng bộ tiến độ "Post Published".

### Bảng điều khiển Giám sát
- **FR17:** Admin có thể theo dõi danh sách luồng trạng thái chi tiết của mọi video (Pending/Downloading/Error/Published).
- **FR18:** Admin có thể truy xuất log lịch sử chuyên sâu (Trace Logs) của các thao tác background đứt gãy.
- **FR19:** Admin có thể điều khiển Khởi động / Dừng hẳn / Hủy diệt chiến dịch Cào dữ liệu.

## Non-Functional Requirements

### Performance (Hiệu suất)
- **Tốc độ phản hồi Webhook:** Tuyến Endpoint hứng tín hiệu từ Facebook bắt buộc phải trả về mã `HTTP 200 OK` dưới 100 mili-giây (100ms) trong 99% trường hợp.
- **Tải trọng giao diện:** Dashboard lịch sử liệt kê 10,000 records không được vỡ và load hoàn chỉnh dưới 2 giây.

### Reliability & Recoverability
- **Kiểm soát sụp đổ cục bộ (Blast Radius Containment):** Khả năng tự phục hồi trong vòng 5 phút (MTTR < 5m), tiến trình ngầm lỗi không được ảnh hưởng đến luồng chính (Main Thread/Process). Lỗi thuật toán chặn tải của một video (HTTP 403) bắt buộc phải bị cô lập.
- **Tính tự phục hồi (Self-healing):** Hệ thống Worker tải nặng có năng lực tự khởi động lại (auto-restart) khi gặp các vi phạm Memory (OOM) mà không cần sự can thiệp từ quản trị viên.

### Security
- **Mã hóa Dữ liệu (Encryption at Rest):** Access Token Facebook và định danh Session Cookies của TikTok bị giới hạn lưu trữ khắt khe. Phải được thao tác sử dụng mã hóa đối xứng (Symmetric Encryption). Cấm việc xuất hiện Plaintext Database.
- **Phân quyền Backend (Route Protection):** 100% Cổng kết nối API làm nhiệm vụ can thiệp vào luồng cào dữ liệu đòi hỏi yêu cầu rào chắn bằng cơ chế xác thực không lưu trạng thái (Stateless Authentication Protocol) có mã hóa đối xứng.

### Scalability
- Kiến trúc Decoupled Design mở lối thoát lý tưởng: Hệ thống phải hỗ trợ mở rộng ngang (Horizontal Scaling) các Worker Node một cách độc lập, đáp ứng tải 1000 requests/phút mà không kích nổ sụp luồng nhận API Tổng.

## Risk Mitigation Strategy
- **Nghẽn lưu lượng Webhook:** Facebook khóa đường hầm vì timeout -> **Xử lý:** Tách tuyệt đối Controller Logic với Heavy Task bằng Event queues.
- **Giới hạn API (Rate Limits) của Meta:** Meta API từ chối phản hồi (HTTP 429) do tần suất gọi quá cao -> **Xử lý:** Áp dụng cơ chế Exponential Backoff có jitter khi gặp HTTP 429, kết hợp chiến lược phân luồng Token Bucket trên các Worker.
- **Trình Cào bị Chặn vĩnh viễn:** Thư viện `yt-dlp` rớt đài vì Update TikTok -> **Xử lý:** Thay thế cấp sẵn module backup bằng `curl-cffi` hoặc Browser Stealth Mode.
- **Bơm đầy rác bộ nhớ:** Task cũ nhân bản vòng đời dài khóa chết RAM máy chủ -> **Xử lý:** Thuận theo Container Restart Mode tĩnh và module Cron "Dọn Rác" định kỳ.
