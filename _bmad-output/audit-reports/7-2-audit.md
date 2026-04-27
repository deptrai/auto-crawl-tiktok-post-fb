## Headless Audit — 2026-04-27T00:00:00
Story: 7-2-tu-dong-lam-moi-long-lived-token
Mode: autonomous
Action required: no — all ACs pass

---

# Audit Report: Story 7.2 — Tự Động Làm Mới Long-Lived Token

## Verdict: PASS

All acceptance criteria verified. All 12 review patches applied. Dev Agent Record populated.

---

## AC Evaluation

### AC1: Thêm trường lưu User Token — PASS
- `models.py`: `user_access_token` (String, encrypted), `auto_refresh_enabled` (Boolean, default False), `token_refresh_error` (String NULLABLE), `last_refresh_at` (DateTime NULLABLE) — all present.
- Alembic migration: `20260406_01_add_token_refresh_fields.py` present.
- `user_access_token` stored encrypted, NOT used for posting (only refresh flow).

### AC2: Token refresh service — PASS
- `token_lifecycle.py`: `refresh_long_lived_token(page_id, db)` → exchange user token → derive page token → verify → atomic write.
- `_exchange_user_token()`: calls Graph API exchange endpoint, raises `ValueError` with error code on failure.
- `_derive_page_token()`: follows pagination (`paging.next` loop — F3 patch), filters by page_id, raises if not found.
- `_verify_page_token()`: GET `/{page_id}?fields=id` before committing (F2 patch).
- Atomic: token only overwritten after BOTH exchange + derive succeed.
- Writes `record_event("token", "info", ...)` on success.
- Updates `token_expires_at`, `token_health_status = "valid"`, `token_last_checked_at`, `last_refresh_at`.

### AC3: Tích hợp vào token_health_check_job — PASS
- `cron.py` lines 217-236: detects `HEALTH_EXPIRING_SOON` + `auto_refresh_enabled` → calls `refresh_long_lived_token()`.
- Refresh fail → warning event, no campaign pause (lines 222-229).
- `auto_refresh_enabled = False` → warning event only (lines 231-236).

### AC4: API endpoints — PASS
- `POST /facebook/config`: accepts `user_access_token` (encrypted on save) and `auto_refresh_enabled`.
- `GET /facebook/config`: returns `auto_refresh_enabled`, `has_user_token` (boolean), `last_refresh_at`, `token_refresh_error`.
- `user_access_token` value NOT exposed in response (only `has_user_token`).
- `POST /facebook/config/{page_id}/refresh-token`: present, triggers manual refresh. Returns 200 with `new_expires_at`. Returns 400 if no user token, 404 if page not found.

### AC5: Edge cases — PASS
- System User Token → skipped, no refresh attempted.
- Missing `user_access_token` → returns `RefreshResult(success=False)` with "User Token" message.
- Exchange/derive failure → token unchanged (atomic), `token_refresh_error` set.
- F7 patch: `expires_in <= 0` guard prevents past-expiry `token_expires_at`.
- F1 patch: `last_refresh_at < now - 1h` guard prevents concurrent double refresh.
- Review findings F1-F10 applied; F11-F12 deferred (pre-existing patterns).

---

## Test Coverage
- `test_token_refresh.py`: 16 tests covering all AC scenarios.
  - Happy path (mock exchange + derive + verify)
  - Exchange fail → token unchanged
  - Derive fail → token unchanged (atomic)
  - Missing user token → skip
  - System user → skip
  - Cron integration: expiring_soon + auto_refresh_enabled=True → refresh triggered
  - Cron integration: expiring_soon + auto_refresh_enabled=False → warning only
  - Manual API refresh: success, no user token (400), not found (404)
  - Config accept user token, response includes refresh fields

---

## Story Design Issues
None.
