# Story 13.2: Crawl Video Từ Instagram Reels (Instagram Reels Crawler)

## 1. Story Foundation (Requirements)

**User Story:**
As a Campaign Manager,
I want to thêm Instagram profile làm nguồn crawl,
So that Reels viral trên Instagram cũng được lấy về hệ thống, sinh caption AI, và tự động repost sang Facebook page, mở rộng vũ trụ content (Đa nền tảng).

**Acceptance Criteria:**
- **Given** Admin thiết lập Campaign, cấu hình `source_url` là một đường dẫn hồ sơ (Profile URL) của kênh Instagram bất kỳ.
- **When** Function/Job Background `sync_campaign_content` của Campaign chạy tới lượt định kỳ.
- **Then** Job gọi Background Scraper, nhận dạng nguồn là Instagram, và gọi khởi động Actor qua nền tảng Apify (ví dụ: `apify/instagram-profile-scraper` hoặc `apify/instagram-reels-scraper`) để cào dữ liệu Reels.
- **And** System tự động download video định dạng MP4 từ CDN Url kết quả trả về bởi Apify. Video không dính watermark dạng nhúng thẳng (nếu có thể chặn qua API Apify).
- **And** Parse metadata (title, url, format, duration) map tiêu chuẩn vào DB Model `Video`.

## 2. Developer Context (Guardrails)

### Technical Requirements
- Mở rộng Model `campaigns`:
  - Trong Story 13.1, `source_platform: String` đã được đề cập. Nếu cấu hình giá trị `instagram`, Worker sẽ biết để rẽ nhánh.
- Tích hợp Crawler Engine (Lớp Apify):
  - Do Instagram chống crawl gắt gao (buộc login), bắt buộc đẩy rủi ro Proxy/Session sang bên thứ 3 (Apify) tương tự như hệ thống Tiktok đang triển khai (Story 6.1).
  - Khởi tạo File/Class `InstagramScraper` kế thừa BaseInterface ở backend service `scrapers/`. 
  - Khuyến nghị actor Apify: Tìm actor uy tín chuyên dụng cào Instagram Reels trên store của Apify để call API. Chú ý truyền tham số `resultsLimit` để không lạm chi trả quota của Apify account.
- Mapping Schema:
  - Đầu ra API Apify Instagram thường gồm: `description` -> `title` trong hệ thống mình, `videoUrl` -> Tự động down thành local file trước khi nhét vào hệ thống upload.
  - Hãy filter ra những Post chỉ có image (không có mp4), chỉ lấy Media Type là REELS hoặc VIDEO.

### Architecture Compliance
- Backend: Vẫn dùng module `ApifyClient` SDK Python đang có, chỉ thay đổi tên tham số Actor ID và payload body Input lúc kích hoạt `call_actor()`.
- Chống lặp (Deduplication): Hệ quả của Epic 2. Trước khi đẩy array video vào database, bắt buộc chạy qua cơ chế kiểm tra `source_video_id` (Trong trường hợp này là Shortcode/Id của Instagram) chống trùng lặp.
- Quản trị dung lượng đĩa ảo: Downloader của Instagram tải MP4 về ổ cứng. Hàm tải cần ghi logic dọn rác (File Cleanup) tương tự Pipeline Downloader Tiktok hiện hành theo Architecture Compliance.

### Previous Intelligence (Liên Kết Epic 6)
- File `apify_tiktok_scraper.py` đã tạo hệ thống gọi Apify rất quy củ với Retry Policy và Type validation. Hãy sao chép core structure của nó sang `apify_instagram_scraper.py`, chỉ sửa lại config payload cho Actor đồ sộ mới. Cùng sử dụng chung SECRET Key mảng Apify.

### File Structure Impacts
- `backend/app/services/scrapers/instagram.py` => Triển khai module Fetcher Instagram qua Apify.
- `backend/app/services/task_queue.py` => Dispatch thêm route `instagram` khi crawler được kích hoạt.
- Lên ý tưởng (Dự kiến Frontend Tweak nếu cần): Cho phép admin chọn Platform source trên UI thay vì chỉ copy URL mù, giúp Form validation dễ hơn.

## 3. Latest Tech Specifics
- Meta thay đổi Node/Graph API URL thường xuyên. Đôi khi URL down video trả về rớt dạng 403 Forbidden nếu không request cùng Client IP gốc, tuy nhiên Actor Apify chất lượng cao cung cấp Proxy URL / Redirect Buffer giúp hệ quả này hiếm khi xuất hiện. Nếu down bị 403, kiểm tra lại User-Agent request Python.

## 4. Status
Status: `ready-for-dev`
Note: Ultimate context engine analysis completed - comprehensive developer guide created.
