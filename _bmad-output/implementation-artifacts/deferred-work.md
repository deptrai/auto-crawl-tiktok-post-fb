# Deferred Work

## Deferred from: code review of 9-1-cham-diem-chat-luong-video-tu-dong (2026-04-28)

- **F10:** Migration `20260428_01_add_filter_fields_to_campaigns.py` thiếu explicit `op.execute("UPDATE campaigns SET filter_min_views=0 WHERE filter_min_views IS NULL")`. Hiện `server_default='0'` đã đủ với Postgres + SQLite test, nhưng nên thêm cho cross-DB defensive sau này.
- **F12:** `QualityFilter.apply` dùng `int(entry.get("view_count") or 0)` — sẽ crash nếu Apify trả string (vd `"12.3K"`). Hiện `apify_crawler.py` đã normalize ints, không có rủi ro thực tế. Defer thêm try/except.
- **F14:** `run_filters` log INFO mỗi entry bị reject → có thể spam log khi feed > 1000 items. Defer chuyển xuống DEBUG hoặc rate-limit.

## Deferred from: code review of 7-2-tu-dong-lam-moi-long-lived-token (2026-04-06)

- **F11:** `decrypt_secret` trong `check_token_health` không được catch — nằm ngoài try/except block (token_lifecycle.py:62), fail sẽ skip tất cả pages tiếp theo trong vòng lặp. Pre-existing từ Story 7.1.
- **F12:** `datetime.utcnow()` deprecated trong Python 3.12+ — pattern cũ toàn codebase, code mới nên dùng `datetime.now(timezone.utc)` nhưng không phải scope Story 7.2.
