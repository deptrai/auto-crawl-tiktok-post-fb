---
stepsCompleted: ['step-01-validate-prerequisites.md', 'step-02-design-epics.md', 'step-03-create-stories.md', 'step-04-final-validation.md']
inputDocuments: ['_bmad-output/planning-artifacts/prd.md', '_bmad-output/planning-artifacts/architecture.md']
status: 'complete'
completedAt: '2026-04-04'
---

# auto-crawl-tiktok-post-fb - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for auto-crawl-tiktok-post-fb, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Admin có thể thêm, sửa, hoặc xóa nhiều đường dẫn kênh TikTok để làm dữ liệu nguồn.
FR2: Admin có thể liên kết tài khoản/Page Facebook vào hệ thống thông qua việc tiếp nhận Access Token định danh.
FR3: Admin có thể thiết lập ghép cặp (Mapping) nội dung từ một Nguồn Tiktok đẩy sang một Đích đến Facebook cụ thể.
FR4: Hệ thống có thể quét và nhận diện danh sách video mới trên một luồng TikTok gốc.
FR5: Hệ thống có thể tự động loại bỏ (filter) các video đã từng tải hoặc đăng thành công trong quá khứ để tránh trùng lặp nội dung.
FR6: Hệ thống có thể tải xuống file video gốc với chất lượng cao (không chèn watermark).
FR7: Hệ thống có thể trích xuất nguyên vẹn văn bản mô tả (caption) và bộ thẻ hashtag từ bài viết của kênh gốc.
FR8: Hệ thống có thể cấp phát (enqueue) các khối lệnh Tải/Đăng vào một chuỗi hàng đợi xử lý ngầm bất đồng bộ.
FR9: Hệ thống có thể tự động upload toàn bộ metadata và file video lên môi trường Facebook theo kết nối đã định trước.
FR10: Admin có thể cấu hình thông số "Thời gian chờ" ngẫu nhiên giữa các lần đăng video để mô phỏng hành vi tự nhiên.
FR11: Hệ thống có thể bắt các tín hiệu lỗi kỹ thuật (403 Forbidden/Rate limits) từ phía nền tảng gốc.
FR12: Hệ thống tự động thay đổi trạng thái của luồng làm việc thành "Tạm ngưng" khi nhận diện rào cản từ chối lớn (Fatal errors).
FR13: Admin có thể cấu hình cơ sở dữ liệu IP Ngoại (Proxy Pool) cho thiết bị cào dữ liệu.
FR14: Admin có thể can thiệp kích hoạt thủ công "Chạy lại" (Retry) cho tiến trình bị đứt gãy giữa chừng mà không cần làm lại từ đầu.
FR15: Hệ thống có thể tiếp nhận và phản hồi đúng chuẩn các tín hiệu trinh sát Challenge để bảo vệ tính hợp pháp cho Webhook của Meta.
FR16: Hệ thống có khả năng nhận các bản tin trạng thái từ Meta API để đồng bộ tiến độ "Post Published".
FR17: Admin có thể theo dõi danh sách luồng trạng thái chi tiết của mọi video (Pending/Downloading/Error/Published).
FR18: Admin có thể truy xuất log lịch sử chuyên sâu (Trace Logs) của các thao tác background đứt gãy.
FR19: Admin có thể điều khiển Khởi động / Dừng hẳn / Hủy diệt chiến dịch Cào dữ liệu.

### NonFunctional Requirements

NFR1: Tốc độ phản hồi Webhook - Tuyến Endpoint hứng tín hiệu Facebook bắt buộc phải trả về mã `HTTP 200 OK` dưới 100ms trong 99% trường hợp.
NFR2: Tải trọng giao diện - Dashboard lịch sử liệt kê 10,000 records phải load hoàn chỉnh và hiển thị mượt mà dưới 2 giây.
NFR3: Blast Radius Containment - Lỗi tiến trình ngầm không được ảnh hưởng luồng chính, MTTR (Mean Time to Recovery) < 5m.
NFR4: Tự phục hồi (Self-healing) - Hệ thống Worker tự động restart bằng quy tắc container khi gặp vi phạm tài nguyên bộ nhớ (OOM).
NFR5: Mã hóa Dữ liệu (Encryption at Rest) - Bắt buộc mã hóa Access Token FB và Cookies TT bằng Symmetric Encryption (AES-256), không lưu Plaintext.
NFR6: Phân quyền Backend (Route Protection) - 100% Admin endpoints rào chắn bằng cấu trúc Stateless Auth Token.
NFR7: Scalability - Kiến trúc Decoupled tuyệt đối giúp Worker Node mở rộng ngang độc lập đáp ứng 1000 requests/phút.

### Additional Requirements

- Tái sử dụng Base Starter: FastAPI (v0.135+) backend + React 19 Frontend. Tuân thủ cấu trúc module `features/` bên UI và `routers/services/workers` bên API.
- Engine Xử lý Ngầm: APScheduler (v3.11+) phân ly luồng làm nhiệm vụ tải/crawl độc lập hoàn toàn khỏi Webhook (API gateway).
- Data Layer: PostgreSQL + SQLAlchemy 2.0 (asyncpg) + Alembic migrations. Ranh giới schema cấm gộp cứng bảng Logs và Admin settings.
- Front-end Fetching: TanStack Query + Zustand quản lý state. Code style: Tailwind CSS v4 + Shadcn (optional).
- Error Resilience & Throttle: Bắt buộc nhúng `tenacity` phục vụ Exponential Backoff khi call Graph API.
- Tunnel Setup: Thiết lập Cloudflare Tunnels (cloudflared) ngay trên Docker Compose phục vụ call back Webhook từ facebook.

### UX Design Requirements

(No UX design document established. Admin Dashboard will rely on standard component structures as prescribed by React/Vite layout).

### FR Coverage Map

FR1: Epic 1 - Thêm sửa xóa kênh TikTok
FR2: Epic 1 - Nạp Access Token Facebook Page
FR3: Epic 1 - Thiết lập Mapping nguồn/đích
FR4: Epic 2 - Nhận diện video TikTok mới
FR5: Epic 2 - Bộ lọc chống trùng lặp dữ liệu
FR6: Epic 2 - Tải video chất lượng sắc nét không Watermark
FR7: Epic 2 - Trích xuất text Captions & Hashtags
FR8: Epic 2 - Bơm Tải/Đăng vào bộ lập lịch Queue Background
FR9: Epic 2 - Bắn metadata và file video trực tiếp lên FB
FR10: Epic 2 - Giãn cách thời gian đăng bài random
FR11: Epic 4 - Tóm gọn mọi chỉ báo chống máy của Meta (HTTP 403, Rate limits)
FR12: Epic 4 - Cơ chế Paused an toàn bảo vệ Worker
FR13: Epic 4 - Admin nạp bể IP Proxy vào
FR14: Epic 4 - Kích hoạt nốt lệnh cào bị Retry
FR15: Epic 3 - Điểm qua ải soát vé của luồng Webhook Challenge
FR16: Epic 3 - Cập nhật tự động "Post Published" Event
FR17: Epic 5 - Liệt kê và thống kê tỷ lệ tải của toàn bộ luồng video
FR18: Epic 5 - Kiểm toán Log Lỗi (Trace Logs)
FR19: Epic 5 - Play/Pause/Stop Chiến dịch Master

## Epic List

### Epic 1: Khởi Tạo Nền tảng Nguồn & Đích
Quản trị viên khởi tạo thành công các kênh TikTok gốc và Fanpage Facebook điểm đến kèm theo khóa bảo mật (Access Token), sau đó thiết lập luật ghép cặp. Đây là bước sống còn để xây móng cho toàn bộ dòng chảy Content sau này.
**FRs covered:** FR1, FR2, FR3

### Epic 2: Vận Hành Máy Cày Nội Dung
Lên lịch quét video TikTok mới, cào file gốc không ngấn nước kèm Captions, và sau cùng là rải vào hàng đợi phân phối tự động lên Fanpage Facebook với tần suất giống hệt hành vi con người.
**FRs covered:** FR4, FR5, FR6, FR7, FR8, FR9, FR10

### Epic 3: Đồng Bộ Thời Gian Thực Meta
Hệ thống tạo ra một cầu nối Webhook bảo mật "xuyên thấu" với nền tảng Meta để duy trì trạng thái App hợp lệ, đồng thời tự động cập nhật được tiến độ của các bài đã bung trên Fanpage (Post Published) cho người dùng thấy.
**FRs covered:** FR15, FR16

### Epic 4: Hệ Miễn Dịch & Khôi Phục
Người dùng được bảo vệ an toàn khỏi các án phạt Rate Limit cản bot của Meta/Tiktok. Chẳng cần lo đứt mạng hệ thống rò rì, người dùng có thể trang bị dàn Proxy mới và bấm "Chạy Lại" dễ dàng.
**FRs covered:** FR11, FR12, FR13, FR14

### Epic 5: Tổng Trạm Giám Sát Chiến Dịch
Giao một Bảng điều khiển Tổng tư lệnh cho Quản trị viên (Admin) để có tầm nhìn mắt chim vào trạng thái từng video, bóc tách các Logs lỗi sâu nhất, và tắt/bật/hủy diệt toàn bộ hệ thống cào theo ý muốn.
**FRs covered:** FR17, FR18, FR19

<!-- Repeat for each epic in epics_list (N = 1, 2, 3...) -->

## Epic 1: Khởi Tạo Nền tảng Nguồn & Đích

Quản trị viên khởi tạo thành công các kênh TikTok gốc và Fanpage FB điểm đến kèm theo khóa bảo mật, sau đó thiết lập luật ghép cặp. Đây là bước sống còn để xây móng cho toàn bộ dòng chảy Content sau này.
**Yêu cầu bao phủ:** FR1, FR2, FR3

<!-- Repeat for each story (M = 1, 2, 3...) within epic N -->

### Story 1.1: Quản lý Danh sách Nguồn Kênh TikTok (TikTok Source Management)

As an Admin,
I want to thêm, đọc, sửa, và xóa (CRUD) các đường dẫn kênh TikTok,
So that tôi thiết lập được những mục tiêu cần cào dữ liệu gốc vào kho đạn.

**Acceptance Criteria:**

**Given** tôi đang ở trên trang Cấu hình Nguồn (Dashboard)
**When** tôi nhập một URL đại diện cho kênh TikTok và bấm Lưu
**Then** hệ thống sẽ khởi tạo một bản ghi Database thành công
**And** ném ra cảnh báo lỗi (Validation error) nếu URL bị sai định dạng hệ sinh thái TikTok.

### Story 1.2: Lưu trữ Access Token Facebook & Cấp Quyền Đích (Facebook Auth Config)

As an Admin,
I want to khai báo khóa Access Token cùng cấu hình Page ID của Facebook một cách an toàn,
So that nền tảng có đủ giấy phép Graph API để đăng bài tự động mà không lo lộ Token.

**Acceptance Criteria:**

**Given** trang cấu hình bảo mật Đích Đến
**When** tôi cung cấp chuỗi Long-lived Access Token hợp lệ từ Facebook
**Then** hệ thống Back-end buộc phải dội qua hàm mã hóa AES-256 (Encryption at rest) trước khi nhét xuống PostgreSQL
**And** không bao giờ load trả lại chuỗi Token nguyên bạch (Plaintext) lên trên giao diện danh sách web.

### Story 1.3: Cấu hình Ghép Cặp Phân Phối (Source-to-Destination Mapping)

As an Admin,
I want to thiết lập luật ghép kênh nối `Tiktok Source A` sang `Facebook Target B`,
So that hệ thống Background Worker nhận lệnh và hiểu rõ dòng chảy video cần đem đi đâu.

**Acceptance Criteria:**

**Given** đã có ít nhất một kênh TikTok và một Page Facebook được định danh đang nằm trong DB
**When** tôi chọn ghép cặp (ví dụ: kênh review xe sang page bán xe)
**Then** CSDL sẽ ghim luật quan hệ Foreign Key vững chắc để sẵn sàng châm nổ tiến trình bằng API
**And** không cho phép lưu Mapping nếu thiết bị không chứa Nguồn/Đích nào.

<!-- End story repeat -->

<!-- TEMPLATE PLACEHOLDER FOR NEXT EPICS -->

## Epic 2: Vận Hành Máy Cày Nội Dung (Automated Content Pipeline)

Cấu hình APScheduler để bám theo kênh TikTok, cào file MP4 không ngấn nước kèm Captions, và sau cùng nhét vào hàng đợi bắn lên Fanpage Facebook (có delay bảo vệ). Nhóm tính năng này tự hoạt động dưới gầm máy.
**Yêu cầu bao phủ (FRs):** FR4, FR5, FR6, FR7, FR8, FR9, FR10

<!-- Repeat for each story (M = 1, 2, 3...) within epic N -->

### Story 2.1: Nhận diện Video Mới & Lọc chống trùng lặp bằng APScheduler (Scan & Deduplicate)

As an APScheduler Worker,
I want to quét kênh TikTok nguồn đều đặn và thu hồi list video,
So that gạn lọc chặn đứng những video cũ đã đăng, ngăn ngừa rác database và bạo hành API.

**Acceptance Criteria:**

**Given** Job định kỳ (Cron Trigger) được APScheduler đánh thức
**When** luồng Worker bắt data JSON danh sách feed của kênh
**Then** phải truy vấn chéo (JOIN/Query) qua SQLAlchemy để đối chiếu ID video với database
**And** chỉ những video chưa từng có mặt trên hệ thống mới được phép lưu tạo bản ghi rỗng (Status: `Scanned`) chờ xử lý tải.

### Story 2.2: Tải Xuống Video Không Watermark (Clean Video Downloader)

As an APScheduler Worker,
I want to tách và download file MP4 chất lượng tuyệt đối không ngấn nước watermark,
So that tài sản nội dung đem đi upload Facebook duy trì sự nguyên bản, chuyên nghiệp.

**Acceptance Criteria:**

**Given** hàng đợi có tồn tại video mới lấy về (`Scanned`)
**When** Job download chạy và tương tác với endpoint giải mã TikTok
**Then** luồng I/O tải trực tiếp khối byte MP4 lưu thành công vào Local Storage (phân cấp thư mục theo ID/Ngày)
**And** đánh dấu bản ghi database cập nhật sang `Downloaded`.

### Story 2.3: Bóc Tách Trích Xuất Metadata (Captions & Hashtags Extractor)

As an APScheduler Worker,
I want to bóc tách nguyên dạng chuỗi text caption và toàn bộ mảng hashtag,
So that khi bê video qua Facebook sẽ không bị mất văn cảnh mô tả.

**Acceptance Criteria:**

**Given** trong lúc phân giải payload của video ở bước tải
**When** Parser hoạt động tìm trường dữ liệu Text
**Then** băm nguyên vẹn caption và hashtags vào cột `metadata_text` trên SQLAlchemy Entity.

### Story 2.4: Bơm Hàng Đợi Upload Có Giãn Cách (Enqueued Upload with Jitter Delay)

As an APScheduler Manager,
I want to tự động nối tiếp (Chain) tiến trình Load -> Upload với một khoảng nghỉ (Jitter) ngẫu nhiên,
So that mô phỏng hành vi đăng bài của con người, trốn né thuật toán đánh dấu Flood/Bot của Facebook.

**Acceptance Criteria:**

**Given** Bước tải MP4 và Metadata (Story 2.2 & 2.3) đã tick xanh hoàn hảo
**When** Hệ thống chuyển trạng thái để nổ máy đẩy dữ liệu
**Then** Job đăng bài (Upload Task) không bao giờ nổ ngay mà phải bị trì hoãn (Delayed Job) ngẫu nhiên bằng thuật toán random (VD: 3 - 15 phút) tính từ thời điểm tải xong.

### Story 2.5: Đăng Video Lên Đích Facebook Graph API (Graph API Uploader)

As an APScheduler Worker,
I want to truyền tải file MP4 và chuỗi Text lên thẳng địa chỉ ID Facebook Page được Mapping bằng Graph API,
So that video chính thức lên mâm chảo diện rộng không cần một cú click chuột từ tay người.

**Acceptance Criteria:**

**Given** đã qua thời điểm chờ Jitter Delay của Story 2.4
**When** luồng gọi Graph API Video Upload nạp AES-256 Token đã giải mã rồi tiến hành bắn HTTP Request
**Then** Đẩy thành công và chuyển trạng thái Model Database sang `Pending Published` (chờ Facebook Webhook gửi giấy báo nhận)
**And** BẮT BUỘC nhúng lib `tenacity` để cover mọi trường hợp Rate Limit / Network error (mặc định thử lại theo Exponential Backoff).

<!-- End story repeat -->

<!-- TEMPLATE PLACEHOLDER FOR NEXT EPICS -->

## Epic 3: Đồng Bộ Thời Gian Thực Meta (Real-time Meta Integration)

Dựng một Router trên FastAPI nhằm tiếp sóng Webhook bảo mật "xuyên thấu" với nền tảng Meta để duy trì trạng thái App hợp lệ, đồng thời tự động đồng bộ tiến độ của các bài đã lùi thành công trên Fanpage (Post Published).
**Yêu cầu bao phủ (FRs/NFRs):** FR15, FR16, NFR1

<!-- Repeat for each story (M = 1, 2, 3...) within epic N -->

### Story 3.1: Xác Thực Cổng Giao Đãi (Webhook Challenge Verification)

As a FastAPI Router,
I want to tiếp nhận và phản hồi chính xác đoạn mã bí mật `hub.challenge` từ máy chủ Facebook,
So that ứng dụng được Meta cấp quyền hợp lệ và mở rào (subscribe) cho phép nhận thông báo thời gian thực về page.

**Acceptance Criteria:**

**Given** Meta gọi HTTP GET Request về endpoint `/api/v1/webhooks/facebook` (thông qua Cloudflare Tunnel)
**When** Query params chứa biến `hub.verify_token` trùng khớp với biến môi trường của hệ thống
**Then** Backend tuân thủ luật Facebook bằng cách trả về đúng giá trị số nguyên của biến `hub.challenge` (kèm HTTP 200)
**And** ép thời gian phản hồi nhanh tuyệt đối (< 100ms) để không bị Meta ngắt mạch (NFR1), đồng thời trả thẳng `403 Forbidden` nếu token không khớp.

### Story 3.2: Lắng Nghe Trạng Thái Hoàn Tất "Post Published" (Event Sync)

As a FastAPI Router,
I want to bắt được tín hiệu JSON qua giao thức POST do Facebook chọt ngược lại mỗi khi thao tác render video trên nền tảng của họ diễn ra thành công toàn vẹn,
So that lưu lại trạng thái, đánh dấu sự thắng lợi trọn vẹn của tiến trình, và thể hiện cho người dùng xem.

**Acceptance Criteria:**

**Given** Backend túc trực hứng luồng HTTP POST ở đường dẫn Webhook
**When** Meta đẩy Event payload về nội dung hoàn thành (Feed/Video published)
**Then** Truy vấn tìm ra chính xác bản ghi video của hệ thống có trong DB, update status từ `Pending Published` (chờ mỏi mòn) sang thẻ xanh `Published Successfully`
**And** Phải phản hồi lại mã `200 OK` cho Meta gần như tức thì, đẩy luồng Update DB vào background block hoặc asyncio để tránh ngâm phản hồi làm rớt Webhook.

<!-- End story repeat -->

<!-- TEMPLATE PLACEHOLDER FOR NEXT EPICS -->

## Epic 4: Hệ Miễn Dịch & Khôi Phục (Resilience & Recovery Operations)

Người dùng và hệ thống được bảo vệ an toàn khỏi các án phạt cản bot của Meta/Tiktok. Có khả năng tự phục hồi (chuẩn NFR) và người dùng có thể nạp Proxy mới, bấm "Chạy Lại" (Retry) dễ dàng nếu tiến trình đứt gãy giữa chừng.
**Yêu cầu bao phủ:** FR11, FR12, FR13, FR14, NFR3, NFR4

<!-- Repeat for each story (M = 1, 2, 3...) within epic N -->

### Story 4.1: Bẽ Gãy Ngoại Lệ API & Rate Limits (API Refusals Handler)

As an APScheduler Worker,
I want to giăng bẫy bắt gọn mọi mã phân giải HTTP trắc trở như `403 Forbidden` hay `429 Too Many Requests` khi gọi qua API Meta/TikTok,
So that Worker chỉ ghi lại nguyên nhân cái chết của chu trình vào Database log thay vì ném Exceptions làm văng (crash) app toàn cụm (NFR3).

**Acceptance Criteria:**

**Given** Job Download hoặc Upload đang thực thi liên lạc API mạng ngoài
**When** Graph API của Meta hoặc trang TikTok ném trả status `403` hoặc `429`
**Then** Luồng try-catch phải tóm gọn Exception này
**And** gán nhãn `RATE_LIMITED` hoặc `AUTH_FAILED` vào bản ghi task thay cho status `Error` chung chung để truy vết cực đoan dễ dàng hơn.

### Story 4.2: Phanh Gấp Khẩn Cấp (Emergency Pause Mechanism)

As a System Watchdog (Monitor),
I want to đánh rớt nhãn kích hoạt của chiến dịch (bật trạng thái `Paused`) nếu số lượng lỗi Fatal Errors vượt ngưỡng nguy hiểm cho phép,
So that hệ thống được hạ nhiệt bảo toàn mạng sống cho IP và bộ Access Token đắt giá vĩnh viễn không bị Meta khóa/ban.

**Acceptance Criteria:**

**Given** hệ thống Monitor đọc Logs của 1 chiến dịch Mapping nguồn/đích
**When** đếm thấy 5 tác vụ liên tiếp đập mặt vào tường với trạng thái `RATE_LIMITED` hoặc `AUTH_FAILED`
**Then** hệ thống tự động đổi `status` của Mapping thành `Paused` đình chỉ cấp tiếp job mới
**And** ngắt mạch toàn bộ các Jobs đăng/tải hàng đợi chưa kịp chạy dính tới Mapping đó ngay lập tức.

### Story 4.3: Tổng Trạm Bơm Proxy (Proxy Pool Configuration)

As an Admin,
I want to thiết lập và quản lý một danh sách bể chứa các địa chỉ HTTP/SOCKS Proxy,
So that cỗ máy Crawl bên APScheduler có thể xoay vòng ngẫu ngiên khoác áo IP mới mỗi khi kết nối TikTok.

**Acceptance Criteria:**

**Given** giao diện cấu hình nâng cao trên React
**When** tôi khai báo chuỗi danh sách các Proxy hợp lệ kèm Username/Password (nếu Auth)
**Then** Worker sẽ pick random hoặc quay vòng (Round-robin) một proxy trong database này dùng cho lib HTTP Client mỗi khi thực hiện Story 2.2 (Download video)
**And** tự động loại bỏ / báo đỏ Proxy nếu Proxy đó chết ngắc gây Network Timeout 3 lần liên tiếp.

### Story 4.4: Hồi Sinh Vết Gãy (Manual Fault Retry)

As an Admin,
I want to kích hoạt chạy lại (Retry) thủ công bất cứ tác vụ video nào bị lỗi giữa đường với 1 cú click,
So that tôi không phải lãng phí tài nguyên tải lại cục MP4 nặng nề từ con số 0 đối với các luồng đã vượt qua được nửa chặng đường.

**Acceptance Criteria:**

**Given** một bản ghi video đứt gãy lúc post Facebook (VD: trạng thái `Error_Upload` nhưng file ở Local vẫn còn do `Downloaded` thành công trước đó)
**When** Quản trị viên kích hoạt nút Retry trên bản ghi đó
**Then** Worker bỏ qua hẳn thủ tục đi quét TikTok, bỏ qua tải file, mà quăng thẳng thông tin file MP4 có sẵn trong volume nạp lại vào hàng đợi Upload Story 2.4
**And** reset Log error để nhường chỗ cho lần Retry mới.

<!-- End story repeat -->

## Epic 5: Tổng Trạm Giám Sát Chiến Dịch (Campaign Dashboard & Monitoring)

Cấp cho Quản trị viên (Admin) một bảng điều khiển Tổng tư lệnh (Dashboard) để có tầm nhìn mắt chim vào danh sách hàng ngàn video đang chảy, bóc tách các Logs lỗi sâu nhất bằng 1 click, và tắt/bật quyền lực tối cao toàn bộ chiến dịch.
**Yêu cầu bao phủ:** FR17, FR18, FR19, NFR2 (Tải trọng mượt mà)

<!-- Repeat for each story (M = 1, 2, 3...) within epic N -->

### Story 5.1: Bảng Điều Khiển Băng Chuyền Video (Video Pipeline Data Grid)

As an Admin,
I want to xem một giao diện danh sách phân trang (Data Grid) bao quát tất thảy trạng thái của từng video (Pending / Downloading / Error / Published),
So that tôi thống kê được hiệu năng chiến dịch cào mà không bị mù mờ thông tin.

**Acceptance Criteria:**

**Given** Admin truy cập vào màn hình Dashboard chiến dịch qua React UI
**When** trang gọi API list lịch sử video
**Then** Frontend phải render một Table / Grid đẹp mắt gỡ từ FastAPI Backend xuống
**And** bắt buộc áp dụng kĩ thuật Server-side Pagination, Sorting & Filtering, bảo chứng việc Load 10,000+ đống file rác vẫn phản hồi dưới 2 giây (Chuẩn NFR2).

### Story 5.2: Khai Quật Log Kỹ Thuật Chuyên Sâu (Trace Logs Inspector)

As a System Admin (Người fix rủi ro),
I want to click vào thẳng 1 task bị gãy (Error) để xem mặt mũi của khối log báo lỗi gốc (JSON Error) từ Meta hoặc hệ thống quăng ra,
So that đoán đúng bệnh nằm ở Proxy, đứt mạng, hay chết Token mà không cần kỹ năng ssh xuống lặn tìm file hệ thống trên Cloud.

**Acceptance Criteria:**

**Given** tôi đang xem bảng Video Pipeline và thấy một task báo nhãn đỏ `Error_Upload`
**When** tôi bấm vào nút "Xem Trace Log" (View Details)
**Then** UI React bật ra một cửa sổ dạng Terminal/Code-viewer
**And** Backend đổ ra đẩy đủ chuỗi Exception Trace hoặc HTTP Request Dump nguyên thủy đã được bẫy lại.

### Story 5.3: Cầu Dao Tổng Nhánh Chiến Dịch (Master Campaign Switches)

As an Admin,
I want to sở hữu cụm 3 nút Quyền lực: Khởi Động (Play), Tạm Dừng (Pause), và Ngưng Hẳn (Stop) cấp độ Mapping,
So that tôi ra lệnh thiết quân luật / can thiệp khẩn cấp vào toàn hệ thống cào mà không cần phải cất công xóa trắng Database setup lúc đầu.

**Acceptance Criteria:**

**Given** Admin có quyền truy cập vào danh sách Mapping ghép cặp giữa Nguồn-Đích
**When** Admin bật / tắt Status của một Mapping nào đó
**Then** API Endpoint Backend trực tiếp gán đè trạng thái của Model
**And** các luồng Worker đang chạy ngầm của **Epic 2** một khi check DB thấy bị khóa vòi sẽ ngay lập tức hủy phiên làm việc.

<!-- End story repeat -->
