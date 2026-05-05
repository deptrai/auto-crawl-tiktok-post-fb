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

## Deferred from: code review of 10-2-caption-da-ngon-ngu.md (2026-05-03)

- Missing frontend Zod schema
- Hardcoded Enum values across layers
- Brittle Alembic downgrade
- Implicit fallback to 'auto' for invalid target_language values
- Worker uses fallback "auto" when campaign is missing
- Missing integration tests for language config
- Prompt numbered list fragility

## Deferred from: code review of 10-3-toi-uu-hashtag-tu-dong.md (2026-05-03)

- Fallback logic redundancy
- Hardcoded fallback tags ignore language context
- Missing Integration Tests
- Regex fails on emojis

## Deferred from: code review of 11-1-thu-thap-engagement-metrics.md (2026-05-03)

- Data Hoarding Without Pruning (inserts new row every 6 hours)
- Job stalls on dead network

## Deferred from: code review of story-11.1 (2026-05-04)

- **Verify FB Graph metric names cho video posts** — Code dùng `post_video_views` (cho views) và `post_impressions_unique` / `post_video_views_unique` (cho reach). Cần test với FB sandbox hoặc real page để xác nhận shape. Có thể tên thật là `total_video_views`, `total_video_impressions`. [backend/app/services/metrics_collector.py:101-104]
- **Single-video batch FB shape** — Rare edge case khi chunk cuối có 1 video, FB có thể trả flat object thay vì keyed dict. Add test khi gặp. [backend/app/services/metrics_collector.py:80]

## Deferred from: code review of story-11.2 (2026-05-04)

- **Missing campaign ownership check** — `Campaign` model không có `user_id` field, mọi authenticated user đều xem được analytics của campaign bất kỳ. Pre-existing schema. [backend/app/models/models.py, backend/app/api/analytics.py]
- **`func.date()` cross-DB inconsistency** — SQLite trả string, PostgreSQL trả date với timezone behavior khác. Off-by-one day risk khi prod chuyển PostgreSQL. [backend/app/services/analytics_service.py:128, 166]
- **VideoMetrics.video_id nullable** — Khi Video bị xóa, history metrics còn lại với `video_id=NULL` không match join → silent loss of historical data trong analytics dashboard. [backend/app/models/models.py:250]
- **BigInteger sum overflow JSON safe int** — `views/likes/etc.` là BigInteger; sum có thể vượt `2^53 - 1` khi campaign rất lớn → JS Number lose precision. [backend/app/services/analytics_service.py]
- **Time-series không gap-fill ngày trống** — Chỉ trả ngày có metric record, line chart "nhảy" thay vì hiển thị xu hướng liên tục. [backend/app/services/analytics_service.py:144-173]
- **Test cross-DB compat & parallel pytest-xdist** — SQLite single-file không safe cho parallel tests; `func.max(fetched_at)` precision khác SQLite vs PostgreSQL. [backend/tests/test_analytics_service.py]
- Test coverage thấp cho edge cases — Thiếu test cho 0 videos / 0 metrics / null fields / malformed UUID / limit boundary / midnight DST flaky. [backend/tests/test_analytics_service.py]
- Pydantic response schemas thiếu — Service trả raw dict, không có contract với FE. Cần Pydantic models cho `/summary`, `/top-videos`, `/time-series`. [backend/app/api/analytics.py]
- `total_videos` đếm tất cả vs metrics chỉ tính video có data — Inconsistency semantic: campaign mới tạo có `total_videos=10` nhưng `total_views=0`, engagement rate=0% → trông như "campaign tệ". Cần product clarification. [backend/app/services/analytics_service.py:32]
- Engagement rate fallback (reach OR views) — Trộn 2 mẫu số khác semantic giữa campaigns; số liệu không so sánh được. Cần product clarification về công thức chuẩn. [backend/app/services/analytics_service.py:55-64]
- `original_caption` không truncate, top videos thiếu thumbnail/link — UX/perf enhancement. [frontend/src/App.jsx:1865-1875]
- `get_summary` chạy 2 query (Campaign exists + analytics) — Perf minor, double DB roundtrip. [backend/app/api/analytics.py:14-21]
- Date range filter UI + backend support (AC violation) — UI chỉ có dropdown campaign, backend `/summary` và `/top-videos` không nhận `date_from`/`date_to`. AC yêu cầu đầy đủ filter campaign + date range. Cần UI date-range picker + 2 endpoint params. [frontend/src/App.jsx:1810-1824, backend/app/api/analytics.py]

## Deferred from: code review of 12-2-upload-len-instagram-reels.md (2026-05-06)

- Missing Async/Non-blocking Implementation (`time.sleep` blocks worker thread)
- Missing Brittle Polling Loop (hardcoded 12 polls/10s might not be enough)
- Missing Video Aspect Ratio Validation (9:16)

## Deferred from: code review of 10-1-cau-hinh-brand-voice-profile Round 3 (2026-05-04)

- **Control chars → space không collapse multiple spaces** — `_sanitize_brand_voice` replace control chars thành `" "`, có thể sinh double/triple spaces trong system instruction. Cosmetic, không ảnh hưởng security. [backend/app/services/ai_generator.py:20]
- **Token `required` conditional UX unclear khi edit mode** — `required={!fbForm.page_id}` tắt HTML5 validation khi edit page; placeholder text đã hint nhưng UX vẫn không explicit. Backend guard an toàn. [frontend/src/App.jsx:1126]
- **Private functions exposed trực tiếp trong unit tests** — `_sanitize_brand_voice` và `_build_system_instruction` được import/test trực tiếp (tight coupling); nếu rename thì tests vỡ silently. [backend/tests/test_brand_voice_prompt.py]

## Deferred from: code review of 13-1-crawl-video-tu-youtube-shorts (2026-05-04)

- **D1:** `DOWNLOAD_DIR` module-level constant stale trong tests — `settings.DOWNLOAD_DIR` evaluated lúc import, test overrides không phản ánh. Pattern giống `ytdlp_crawler.py` hiện tại. Fix trong Epic 14 cleanup hoặc khi làm test isolation refactor. [`youtube.py:34`]
- **D2:** `factory.get_scraper()` không defensive với `source_url=None` — `urlparse(None)` raises TypeError. Low risk vì caller `campaign_jobs` luôn pass string từ DB column. Defensive guard nên được thêm khi factory mở rộng. [`factory.py:_is_youtube_url`]
- **D3:** `YT_MAX_VIDEOS` env var không validate kiểu — non-integer string raise ValueError uncaught lúc build opts dict. Ops-level concern; document trong deployment guide, add try/except khi cần production hardening. [`youtube.py:extract_metadata:opts`]

## Deferred from: code review of 14-2-role-based-access-control.md (2026-05-05)

- Concurrent creation 500 error (`backend/app/api/users.py:44`)
- Weak password (`backend/app/api/auth.py:24`)
- Migration re-runs crash (`backend/alembic/versions/c14f91eae2aa_update_user_schema.py:51`)## Deferred from: code review of 14-3-workspace-to-chuc (2026-05-05)\n- Xóa bảo vệ chống Brute-Force trong API login: Cần khôi phục check_login_rate_limit nhưng hiện tại bị vô hiệu hoá do đang refactor.\n
