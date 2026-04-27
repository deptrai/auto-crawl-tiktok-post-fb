## Headless Audit — 2026-04-27T00:00:00
Story: 7-1-ho-tro-system-user-token-khong-het-han
Mode: autonomous
Action required: no — all ACs pass

---

# Audit Report: Story 7.1 — Hỗ Trợ System User Token Không Hết Hạn

## Verdict: PASS

All acceptance criteria verified against code. Dev Agent Record section is empty (no completion notes), but implementation is confirmed present.

---

## AC Evaluation

### AC1: Schema mở rộng FacebookPage — PASS
- `models.py`: `TokenType` enum (`short_lived`, `long_lived`, `system_user`) present.
- 4 columns added: `token_type`, `token_expires_at`, `token_last_checked_at`, `token_health_status`.
- Alembic migration: `53457421ab4c_add_token_lifecycle_fields.py` present.
- Defaults match spec: `token_type=long_lived`, `token_health_status="unknown"`.

### AC2: Token Inspect Service — PASS
- `token_lifecycle.py`: `check_token_health(page_id, db)` implemented.
- Calls `GET /debug_token` with `{app_id}|{app_secret}` format.
- Parses `data.is_valid`, `data.expires_at`, `data.scopes`.
- Updates `token_expires_at`, `token_health_status`, `token_last_checked_at` in DB.
- Returns `TokenHealthResult(is_valid, token_type, expires_at, days_remaining, scopes, health_status)`.
- Graceful skip when `FB_APP_ID`/`FB_APP_SECRET` unconfigured (sets `HEALTH_UNKNOWN`, logs warning).
- Network error → keeps current status, no auto-pause (line 95: `HEALTH_UNKNOWN` on HTTP error).

### AC3: APScheduler cron job — PASS
- `cron.py`: `token_health_check_job()` registered in `start_scheduler()` with `interval hours=24`.
- Queries all pages with non-null token.
- Auto-pauses campaigns on `expired`/`invalid` (lines 201-212).
- Writes `SystemEvent` for each problematic page.

  **Note on AC3 vs AC5 (Story 7.3) interaction:**
  Story 7.1 AC3 requires ghi SystemEvent cho mỗi page có vấn đề — cron.py thực hiện điều này đúng.
  Story 7.3 AC5 yêu cầu thêm ràng buộc: chỉ ghi event khi status THAY ĐỔI. Xem audit 7-3 để biết chi tiết.

### AC4: API endpoints — PASS
- `GET /facebook/config`: trả về `token_type`, `token_expires_at`, `token_health_status`, `token_last_checked_at`, `days_remaining` (computed via `_calc_days_remaining()`).
- `GET /facebook/config/{page_id}/check-health`: present, triggers immediate check, returns `health_status` + `days_remaining`.

### AC5: Auto-detect token type khi save — PASS
- `POST /facebook/config`: sau khi save token, gọi `check_token_health()` ngay để detect type.
- `detect_token_type(expires_at)`: `0 → system_user`, `> 50 days → long_lived`, `<= 50 days → short_lived`.
- `token_type`, `token_expires_at`, `token_health_status` được cập nhật ngay.

---

## Test Coverage
- `test_token_lifecycle.py`: 3 tests — `test_detect_token_type`, `test_check_token_health_valid`, `test_cron_auto_pause`.
- Coverage is minimal but covers happy path and auto-pause.
- **Gap (non-blocking):** No test for network error path (HEALTH_UNKNOWN on HTTP error), no test for missing FB_APP_ID graceful skip. These are edge cases, not AC failures.

---

## Story Design Issues
None.

---

## Notes
- Dev Agent Record section is **empty** — no completion notes, no file list recorded. Implementation is confirmed from code inspection. Recommend filling in Dev Agent Record for traceability.
