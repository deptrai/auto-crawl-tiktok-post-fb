# Deferred Work

## Deferred from: code review of 7-2-tu-dong-lam-moi-long-lived-token (2026-04-06)

- **F11:** `decrypt_secret` trong `check_token_health` không được catch — nằm ngoài try/except block (token_lifecycle.py:62), fail sẽ skip tất cả pages tiếp theo trong vòng lặp. Pre-existing từ Story 7.1.
- **F12:** `datetime.utcnow()` deprecated trong Python 3.12+ — pattern cũ toàn codebase, code mới nên dùng `datetime.now(timezone.utc)` nhưng không phải scope Story 7.2.
