## Headless Audit — 2026-04-27T00:00:00
Story: 7-3-canh-bao-giam-sat-han-token
Mode: autonomous
Action required: yes — 1 finding needs attention

---

# Audit Report: Story 7.3 — Cảnh Báo & Giám Sát Hạn Token

## Verdict: FAIL (1 critical bug)

AC1–AC4 pass. **AC5 fails** — smart event logging never executes because `cron.py` bypasses `check_all_tokens()`.

---

## AC Evaluation

### AC1: API trả về token health summary — PASS
- `GET /facebook/config`: returns `token_type`, `token_health_status`, `token_expires_at`, `days_remaining`, `token_last_checked_at` for each page (verified at `facebook.py` lines 126-130).
- `GET /facebook/token-summary`: present at `facebook.py:148`, returns `total_pages`, `healthy`, `expiring_soon`, `expired`, `invalid`, `unknown`, `worst_status` (priority order: invalid > expired > expiring_soon > unknown > valid).

### AC2: Badge cảnh báo trên card Facebook Page — PASS
- `App.jsx`: `TokenHealthBadge` component at line 233.
- Maps `valid` → green (CircleCheck), `expiring_soon` → amber (AlertTriangle + days remaining), `expired` → rose (CircleX), `invalid` → rose (CircleX), `unknown` → slate (Clock).
- `TOKEN_HEALTH_META` dict covers all 5 statuses.
- Rendered at lines 954 and 1096 (both page list contexts).

### AC3: Banner cảnh báo toàn Dashboard — PASS
- `App.jsx`: `TokenAlertBanner` component at line 240.
- Returns `null` when `worst_status === 'valid'` → no banner when all healthy.
- `isError = expired || invalid` → rose (AlertTriangle). Otherwise amber.
- Counts `expired`, `invalid`, `expiring_soon`, `unknown` surfaced in message.
- "Xem chi tiết →" button triggers `onNavigate` callback (line 256).
- Rendered at line 843 via `{tokenSummary && <TokenAlertBanner ...>}`.
- `tokenSummary` populated from `GET /facebook/token-summary` at line 496-512.

### AC4: Nút "Kiểm tra ngay" — PASS
- `App.jsx` line 674: click triggers `GET /facebook/config/{pageId}/check-health`.
- Line 675: immediately updates page state in `setFbPages` (no wait for 5s auto-refresh).
- Line 677: also refreshes `tokenSummary` after health check.
- Loading state managed at button level (implied from state update pattern).

### AC5: SystemEvent cảnh báo — ❌ FAIL

**Requirement (AC5 from story):**
> `token_health_check_job` KHÔNG ghi event nếu status KHÔNG thay đổi (tránh spam event log mỗi 24h)

**Root cause:**
`cron.py:token_health_check_job` (lines 189-243) calls `check_token_health()` directly per page, then unconditionally writes `record_event()` whenever status is `expired`, `invalid`, or `expiring_soon` — regardless of whether status changed since last run.

`token_lifecycle.py:check_all_tokens()` (lines 162-189) implements the correct smart logic:
```python
if new_status != previous_status and new_status != HEALTH_UNKNOWN:
    record_event(...)
```
But this function is **never called by the scheduler**. It exists but is orphaned.

**Concrete failure scenario:**
- Page token expires on Day 1 → `expired` event written ✓ (correct)
- Day 2 cron runs: status is still `expired` → another `expired` event written ✗ (spam)
- Day 3, 4, 5 ... every 24h: same spam event

**Impact:** Event log fills with duplicate token error/warning events. Monitoring/alerting becomes noisy. If events drive notifications, admins receive daily false alarms.

**Fix required:**
Replace the per-page `check_token_health()` call in `token_health_check_job` with `check_all_tokens()`, then remove the redundant inline event-writing code from the cron job (since `check_all_tokens` handles smart event logging).

**Affected file:** `backend/app/worker/cron.py` lines 192-216.
**Related function:** `backend/app/services/token_lifecycle.py:check_all_tokens` (lines 162-189).

**Note — cron auto-pause and auto-refresh still work correctly.** The `check_all_tokens()` refactor must preserve:
1. Auto-pause campaigns on `expired`/`invalid`
2. Auto-refresh on `expiring_soon` + `auto_refresh_enabled`

These are currently handled in the cron loop body. The fix needs to keep them while delegating event logging to `check_all_tokens()`.

---

## Test Gaps

- `test_token_monitor.py`: 21 tests for API endpoints and `_calc_days_remaining` — all pass.
- **Gap:** No test verifies that `cron.py` does NOT write duplicate events when status is unchanged across two runs. This is the exact scenario AC5 fails on.

---

## Story Design Issues

None — the story design is correct. `check_all_tokens()` was designed with smart event logging from the start (Story 7.1 Tasks 2.3). The bug is an implementation oversight in Story 7.3 cron integration.

---

## Required Action

**File:** `backend/app/worker/cron.py`
**Change:** Replace `check_token_health()` per-page loop with `check_all_tokens()`, then move campaign auto-pause + auto-refresh logic to use the returned `TokenHealthResult` list.
**Test:** Add test in `test_token_monitor.py` verifying no duplicate events on status-unchanged cron run.
