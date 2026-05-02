# Deferred Work

## Deferred from: code review of 9-2-bo-loc-hashtag-tu-khoa (2026-04-28)

- **D1:** Substring match không có word-boundary — "tea" sẽ block "steam", "cá độ" sẽ block "cá độc". Spec MVP đồng ý dùng substring đơn giản, defer thêm option `match_whole_word` nếu admin yêu cầu sau này. [content_filter.py:99]
- **D2:** PATCH API cho phép gửi `filter_blocklist_keywords: null` để wipe sạch filter — hành vi PATCH chuẩn, không vi phạm spec, defer thêm strict validation (chỉ chấp nhận list, không nhận null). [campaigns.py:248-265]
- **D3:** Race condition — admin update filter config giữa lúc sync (loop refetch campaign mỗi iteration → filter list thay đổi mid-sync). Acceptable trade-off, defer thêm "filter config snapshot" tại đầu sync. [campaign_jobs.py:162]
- **D4:** `reason="blocklist_match:{keyword}"` chứa user-input — nếu UI render trực tiếp event log không escape, là XSS surface nhỏ. Defer hardening ở observability/UI layer. [content_filter.py:101]
- **D5:** Hoisted filter chain `content_filters = get_default_filters()` ngoài loop sẽ là rủi ro cho Story 9.3 — `CrossCampaignDedup` có state (set hashes đã thấy). Cần re-instantiate per-campaign khi làm 9.3, hoặc design dedup là stateless (truy DB mỗi check). [campaign_jobs.py:158]

## Deferred from: code review of 9-1-cham-diem-chat-luong-video-tu-dong (2026-04-28)

- **F10:** Migration `20260428_01_add_filter_fields_to_campaigns.py` thiếu explicit `op.execute("UPDATE campaigns SET filter_min_views=0 WHERE filter_min_views IS NULL")`. Hiện `server_default='0'` đã đủ với Postgres + SQLite test, nhưng nên thêm cho cross-DB defensive sau này.
- **F12:** `QualityFilter.apply` dùng `int(entry.get("view_count") or 0)` — sẽ crash nếu Apify trả string (vd `"12.3K"`). Hiện `apify_crawler.py` đã normalize ints, không có rủi ro thực tế. Defer thêm try/except.
- **F14:** `run_filters` log INFO mỗi entry bị reject → có thể spam log khi feed > 1000 items. Defer chuyển xuống DEBUG hoặc rate-limit.

## Deferred from: code review of 7-2-tu-dong-lam-moi-long-lived-token (2026-04-06)

- **F11:** `decrypt_secret` trong `check_token_health` không được catch — nằm ngoài try/except block (token_lifecycle.py:62), fail sẽ skip tất cả pages tiếp theo trong vòng lặp. Pre-existing từ Story 7.1.
- **F12:** `datetime.utcnow()` deprecated trong Python 3.12+ — pattern cũ toàn codebase, code mới nên dùng `datetime.now(timezone.utc)` nhưng không phải scope Story 7.2.

## Deferred from: code review of 9-3-phat-hien-noi-dung-trung-lap (2026-04-28)

- **D1 (High):** Race condition giữa 2 workers — `sync_campaign_content` chạy đồng thời cho 2 campaigns cùng `target_page_id`, cả hai query CrossCampaignDedup TRƯỚC khi commit Video → cả hai cùng tạo Video → đăng trùng lên cùng Page. Cần partial UNIQUE index `(target_page_id, original_id) WHERE status != 'failed'` (Postgres) hoặc advisory lock. **Đề tài Story riêng — Story 9.3 explicit không add migration.**
- **D2 (High):** `entry.get("id", str(uuid.uuid4()))` ở `campaign_jobs.py:178` vs `entry.get("id", "")` ở `CrossCampaignDedup` — entries không có `id` (rare từ Apify) sẽ luôn bypass dedup và lưu Video với UUID ngẫu nhiên → không bao giờ match cross-campaign. Cần unify: hoặc skip entry không có id, hoặc deterministic hash từ URL.
- **D3 (High):** Within-campaign dedup (campaign_jobs.py:179-184) KHÔNG filter status, cross-campaign dedup CHO PHÉP retry `failed` → asymmetric retry policy: user có thể retry video failed ở campaign khác nhưng không trong cùng campaign. Inconsistent UX.
- **D4 (Medium):** Thiếu composite index `(target_page_id, original_id)` trên `videos`/`campaigns` — N entries × DB query/iteration với potential seq scan trên `campaigns.target_page_id`. Performance issue khi scale lên hàng trăm campaigns × hàng trăm entries/sync.
- **D5 (Medium):** `Video.campaign_id` FK có `ondelete="CASCADE"` — khi user xóa campaign cũ, lịch sử "đã đăng" mất theo → sync campaign mới cùng page sẽ re-post. Cần soft-delete Video hoặc bảng audit `posted_videos_by_page` riêng.
- **D6 (Low):** `get_default_filters(db=None)` silent fallback chỉ 2 filters → caller nào quên truyền `db` mất dedup mà không cảnh báo. Pattern fragile; cân nhắc tách thành 2 hàm explicit hoặc raise/log warning khi `db is None`.

## Deferred from: code review of story-8.1 (2026-05-02)

- **boto3 async / `run_in_executor`** — App hiện đồng bộ (sync), chưa có asyncio path. Reconsider khi tích hợp FastAPI async endpoints chạm vào storage hoặc khi scale worker concurrency cao. [backend/app/services/storage_backend.py]
- **`/tmp` disk quota check** — Khi nhiều worker download song song video lớn, /tmp có thể đầy. Deferred — infra/container concern, theo dõi qua observability/disk metrics. [backend/app/services/storage_backend.py]
- **Validate hostname/port của `S3_ENDPOINT_URL`** — Hiện chỉ check prefix `http(s)://`. Deferred — runtime endpoint connectivity check là đủ với cấu hình admin trusted. [backend/app/services/storage_backend.py:118-121]
- **S3 secrets dùng plaintext env (không qua `decrypt_secret`)** — Khác convention với FB token (DB + decrypt). Deferred — chấp nhận cho infrastructure config qua env, không lưu DB. [backend/app/core/config.py:69-73]

## Deferred from: code review of story-8.2 (2026-05-02)

- **Multi-pod distributed lock cho `storage_cleanup_job`** — `max_instances=1` của APScheduler chỉ áp dụng trong-process; nếu scale horizontally (>1 worker pod) cần distributed lock (Postgres advisory lock hoặc Redis). [backend/app/worker/cron.py:248]
- **`record_event` sau `db.rollback()` trong cleanup error handler** — Risk thấp vì `record_event` tự quản lý session; deferred. [backend/app/worker/cron.py:326-336]
- **`traceback.format_exc()` có thể vượt JSON column size limit** — JSONB Postgres không giới hạn thực tế; deferred truncation. [backend/app/worker/cron.py:243,333]
- **Async / `run_in_executor` cho `storage.delete` trong cleanup** — Đã deferred Round 1; reconsider khi tích hợp asyncio path. [backend/app/worker/cron.py:285,307]

## Deferred from: code review of story-10.1 (2026-05-02)

- **Optimistic locking cho `FacebookPage`** — Race brand_voice edit vs token refresh có thể last-writer-wins. Cần `updated_at` check hoặc version column. Broader concern, không scope 10.1. [backend/app/api/facebook.py:81-86]
- **i18n: brand_voice preset descriptions hardcoded tiếng Việt** — Khi Story 10.2 thêm `caption_language=en/auto`, preset descriptions vẫn là tiếng Việt → Gemini có thể leak VI text vào EN output. Reconsider khi implement 10.2. [backend/app/services/ai_generator.py:13-17]
