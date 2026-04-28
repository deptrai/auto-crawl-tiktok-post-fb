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
