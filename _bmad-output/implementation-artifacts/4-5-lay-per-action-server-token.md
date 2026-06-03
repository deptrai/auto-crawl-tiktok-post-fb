# Story 4.5: Lấy per-action server token

Status: review

Epic: 4 — Lõi Automation Facebook (Self-Comment MVP) · Story: 4.5 · ID: 4.5

> ⚠️ **STORY FULL-STACK** (Backend Python/FastAPI + Client Electron). Lần đầu Epic 4 đụng `backend/`. Backend mirror pattern license sẵn có; KHÔNG áp 25 rule của automation-desktop lên Python (rule đó cho client). Nếu thấy quá lớn → xem "Tùy chọn tách" cuối file (4.5a backend / 4.5b client).

## Story

As a user (license hợp lệ),
I want mỗi action tier 2+ (post/comment/react/share/friend) được cấp short-lived token từ server,
So that crack license thuần client-side KHÔNG hoạt động (R-D9) — revenue protection.

## Acceptance Criteria

- **AC1 (Issue endpoint)** — Given license active + HWID khớp, When client `POST /api/v1/automation/action/token` với `{key, hwid, action_type}`, Then server verify license (active, chưa revoke, chưa hết hạn) + HWID match + rate limit + action_type ∈ tier2+ → cấp **JWT HS256** claims `{jti, sub=activation_id, action, exp=now+60s}`.
- **AC2 (Anti-reuse persistence)** — Server lưu `jti` vào bảng `phase3.action_tokens` (jti UNIQUE) để chống reuse. *(Architecture nêu Redis SETNX; Redis CHƯA cấu hình trong backend → dùng DB jti-UNIQUE — xem Quyết định D2.)*
- **AC3 (Deny invalid)** — License không tồn tại/revoked → `LICENSE_INVALID`; hết hạn → `LICENSE_EXPIRED`; HWID lệch → `LICENSE_HWID_MISMATCH`; action_type không phải tier2+ → `ACTION_NOT_ALLOWED`. Mọi lỗi trả ErrorEnvelope `{code, message (tiếng Việt), retryable}` + HTTP status đúng (mirror license endpoint).
- **AC4 (Client block)** — Client `action-token-client`: When request thành công → trả `{token, jti, expiresAt}` (in-memory cho 4.6 đính action). When offline → block tier2+ với lỗi `ACTION_TOKEN_OFFLINE` (retryable). When server deny → `ACTION_TOKEN_DENIED` (message tiếng Việt). Tier2+ KHÔNG có token hợp lệ → KHÔNG execute.
- **AC5 (Secret hygiene)** — `action_token` (JWT) + `jti` ∈ secret-keys list (L1667) → client KHÔNG log token/jti, KHÔNG đưa vào IPC payload thô, KHÔNG ghi `automation_jobs.result` (chỉ `job_actions.action_token` reference khi 4.6 — defer). Backend KHÔNG log JWT đã ký. `JWT_SECRET` từ `settings` (KHÔNG hardcode).
- **AC6 (Test coverage)** — Backend pytest: issue success (exp~60s, jti lưu), 3 deny case (invalid/expired/hwid), action không tier2+, rate limit, jti UNIQUE (anti-reuse). Client unit: success→token, offline→block, deny→block, no-leak. Backend test xanh + client lint/typecheck/test xanh.

## Tasks / Subtasks

### Backend (Python/FastAPI — mirror `automation/license` pattern)
- [x] **B1** — `backend/app/models/automation/action_token.py`: `ActionToken(Base)` `__tablename__="action_tokens"` schema `phase3`. Cột: `jti` (String PK/UNIQUE), `license_activation_id` (Uuid FK `phase3.license_activations.id` ON DELETE CASCADE), `action_type` (String), `issued_at`, `expires_at` (DateTime tz), `used_at` (DateTime tz, nullable). (AC2)
- [x] **B2** — `alembic/versions/20260603_..phase3_action_tokens.py`: migration tạo bảng (mirror `20260602_01_phase3_license_init.py`). (AC2)
- [x] **B3** — `backend/app/schemas/automation/action_token.py`: `ActionTokenRequest {key, hwid, action_type}` + `ActionTokenResponse {token, jti, expires_at}` (Pydantic).
- [x] **B4** — `backend/app/services/automation/action_token.py`: `ActionTokenError(code, message, retryable)` + `issue_action_token(db, *, key, hwid, action_type, now=None)`:
  - tìm license theo `key` + `_latest_activation` (reuse từ `license.py`) → none → `LICENSE_INVALID`.
  - revoked / `expires_at < now` → `LICENSE_INVALID` / `LICENSE_EXPIRED`.
  - `validate_hwid` + `activation.hwid_hash != normalized` → `LICENSE_HWID_MISMATCH`.
  - `action_type ∉ {post,comment,react,share,friend}` → `ACTION_NOT_ALLOWED`.
  - `jti=uuid4`, `exp=now+60s`, `token=create_access_token-style` qua `app/core/security.py` (`settings.JWT_SECRET`, HS256) claims `{jti, sub=str(activation.id), action, exp}`.
  - INSERT `ActionToken` row (jti UNIQUE). Return `ActionTokenResponse`. (AC1/AC2/AC3)
- [x] **B5** — `backend/app/api/automation.py`: route `POST /api/v1/automation/action/token` (Depends `get_db`) + reuse rate-limiter + `_error_response` map (mirror `/license/activate`). (AC1/AC3)
- [x] **B6** — `backend/tests/automation/test_automation_action_token.py`: pytest (AC6) — issue success (exp 60s, jti in DB), invalid/expired/hwid deny + status, action-not-allowed, rate limit, jti uniqueness.

### Client (automation-desktop — mirror `BackendLicenseClient`)
- [x] **C1** — `src/shared/api-client/http-client.ts`: thêm `ActionTokenResponseSchema` (zod) + type (mirror `BackendActivationResponseSchema`).
- [x] **C2** — `src/main/license/action-token-client.ts`: `createActionTokenClient(deps)` → `requestActionToken({ actionType }): Promise<ActionToken>`: lấy hwid (hwid-generator) + license key → `postJson` `/api/v1/automation/action/token` → trả `{token, jti, expiresAt}`. Offline (`BackendHttpError` network) → `ACTION_TOKEN_OFFLINE` (retryable); server 4xx → `ACTION_TOKEN_DENIED`. ErrorEnvelope message tiếng Việt. Deps `Pick<>`. (AC4/AC5)
- [x] **C3** — `src/main/license/index.ts`: barrel APPEND export. (rule #21)
- [x] **C4** — `tests/unit/action-token-client.spec.ts`: DI mock postJson — success→token; offline→`ACTION_TOKEN_OFFLINE`; 403→`ACTION_TOKEN_DENIED`; assert error KHÔNG chứa token/jti value. (AC6)
- [x] **V** — Verify: backend `pytest backend/tests/automation/test_automation_action_token.py` xanh; client `npm run lint` + `typecheck` + test mới + full suite không giảm (baseline 172).

> **D1 (defer):** KHÔNG consume token / mark `used_at` (4.6 khi action execute — verify jti + used_at null + set used_at). KHÔNG self-comment HTTP POST (4.6). KHÔNG IPC/UI wire `automation:start` (4.6). KHÔNG `job_actions` insert (4.6). KHÔNG cache token safeStorage (optional, defer 4.6 nếu cần). KHÔNG state machine transition.

## Dev Notes

### ⚠️ ĐỌC TRƯỚC
- **Client**: `automation-desktop/CLAUDE.md` (25 rules) + `project-context.md`.
- **Backend**: KHÔNG áp 25 rule client. Mirror convention sẵn có: `backend/app/api/automation.py` (route + rate-limiter + `_error_response`), `backend/app/services/automation/license.py` (`*Error(code,message,retryable)`, `_latest_activation`, `validate_hwid`, `_utc_now`), `backend/app/models/automation/license.py` (SQLAlchemy `phase3.` schema), `backend/app/core/security.py` (JWT encode), `backend/tests/automation/test_automation_license.py` (pytest pattern).

### 🔴 Quyết định D2 — Anti-reuse: DB jti-UNIQUE (KHÔNG Redis)

Architecture (R-D9, L1287) nêu "Redis SETNX TTL 60s". Nhưng **Redis CHƯA cấu hình** trong `backend/` (chỉ APScheduler in-memory — architecture L110 cho phép defer Redis). → 4.5 dùng **bảng `phase3.action_tokens` với `jti` UNIQUE** làm persistence + chống reuse:
- Issue: INSERT row jti (UNIQUE → 2 lần cùng jti impossible, nhưng jti=uuid4 nên luôn unique khi issue).
- **Reuse phòng ở CONSUME** (4.6): khi action execute, verify JWT + SELECT action_tokens WHERE jti → nếu `used_at` != null → reject reuse; else set `used_at`. 4.5 chỉ ISSUE + lưu; **consume = 4.6** (D1).
- Token tự hết hạn qua `exp=60s` trong JWT (verify lúc consume). `expires_at` cột để cleanup/audit.
- Khi tải tăng → chuyển Redis SETNX sau (architecture cho phép). Ghi note trade-off.

### Backend issue flow (B4) — mirror license verify

```python
def issue_action_token(db, *, key, hwid, action_type, now=None):
    now = now or _utc_now()
    if action_type not in TIER2_ACTIONS:           # {post,comment,react,share,friend}
        raise ActionTokenError("ACTION_NOT_ALLOWED", "Hành động không được phép cấp token.", False)
    license_record = _find_license_by_key(db, key)  # mirror activate lookup
    if not license_record or license_record.revoked:
        raise ActionTokenError("LICENSE_INVALID", "License không hợp lệ.", False)
    activation = _latest_activation(db, license_record.id)
    if not activation:
        raise ActionTokenError("LICENSE_INVALID", "License chưa kích hoạt.", False)
    if _as_utc(activation.expires_at) < now:
        raise ActionTokenError("LICENSE_EXPIRED", "License đã hết hạn.", False)
    if activation.hwid_hash != normalize_hwid(hwid):
        raise ActionTokenError("LICENSE_HWID_MISMATCH", "Thiết bị không khớp license.", False)
    jti = str(uuid.uuid4())
    expires_at = now + timedelta(seconds=60)
    token = encode_jwt({"jti": jti, "sub": str(activation.id), "action": action_type,
                        "exp": int(expires_at.timestamp())})   # security.py, HS256, settings.JWT_SECRET
    db.add(ActionToken(jti=jti, license_activation_id=activation.id, action_type=action_type,
                       issued_at=now, expires_at=expires_at, used_at=None))
    db.commit()
    return ActionTokenResponse(token=token, jti=jti, expires_at=expires_at)
```
- 🚫 KHÔNG log `token`. JWT secret từ `settings.JWT_SECRET` (đã có `app/core/security.py`).
- Rate limit: reuse pattern `ActivationRateLimiter` (per ip+key, window 60s) — action token gọi nhiều hơn activate → cân nhắc window/max riêng (vd 60/phút). Note tune.

### Client (C2) — mirror BackendLicenseClient

```ts
// http-client đã có postJson<T> + BackendHttpError. action-token-client dùng lại.
async requestActionToken({ actionType }) {
  const hwid = deps.hwid()           // hwid-generator
  const key = deps.getLicenseKey()   // nguồn key (license đã activate) — inject
  try {
    const res = await postJson({ url: `${baseUrl}/api/v1/automation/action/token`,
                                 body: { key, hwid, action_type: actionType }, schema: ActionTokenResponseSchema })
    return { token: res.token, jti: res.jti, expiresAt: res.expires_at }   // in-memory, caller (4.6) giữ
  } catch (err) {
    if (isNetworkError(err)) throw actionTokenError('ACTION_TOKEN_OFFLINE', 'Mất kết nối — không thể cấp token cho hành động.', true)
    throw actionTokenError('ACTION_TOKEN_DENIED', 'Máy chủ từ chối cấp token cho hành động.', false)
  }
}
```
- 🚫 KHÔNG log token/jti (action_token ∈ secret-keys L1667). Error message tiếng Việt (rule #15), `retryable` đúng (offline=true, deny=false) (rule #9).
- `getLicenseKey` / `hwid` inject (Pick<>/fn) → unit test mock, KHÔNG hit backend.
- Token sống in-memory; 4.6 đính vào HTTP POST action + gọi consume. KHÔNG cache đĩa ở 4.5.

### Edge cases

- action_type hợp lệ nhưng license hết hạn giữa chừng → LICENSE_EXPIRED (verify mỗi issue, không cache license state).
- Đồng thời 2 request cùng license → 2 jti khác nhau (uuid4) → 2 row, OK (anti-reuse ở consume, không ở issue).
- Clock skew client/server → exp dùng server `now` (60s đủ buffer). Client KHÔNG tự tính exp.
- Backend `JWT_SECRET` mặc định `change-me-jwt-secret` (dev) → production set env (ngoài scope 4.5, nhưng note).
- Offline: client KHÔNG có fallback issue (tier2+ MUST online — R-D9). Block rõ ràng, KHÔNG silently cho qua.

### Scope — KHÔNG làm

- KHÔNG consume/verify token lúc execute + set `used_at` (4.6).
- KHÔNG self-comment / HTTP POST action gửi token (4.6) — 4.5 chỉ CẤP token.
- KHÔNG IPC/UI; KHÔNG state machine transition; KHÔNG `job_actions` insert (4.6).
- KHÔNG Redis (D2 — dùng DB jti-UNIQUE).
- KHÔNG cache token ra safeStorage (defer 4.6 nếu cần).
- KHÔNG đổi license endpoint/logic 1.x (chỉ ADD action-token, reuse helper).

### Files

| File | Action | Stack | Ghi chú |
|---|---|---|---|
| `backend/app/models/automation/action_token.py` | NEW | BE | `ActionToken` table phase3 (jti UNIQUE) |
| `backend/alembic/versions/20260603_..action_tokens.py` | NEW | BE | migration |
| `backend/app/schemas/automation/action_token.py` | NEW | BE | Pydantic req/res |
| `backend/app/services/automation/action_token.py` | NEW | BE | issue_action_token + ActionTokenError |
| `backend/app/api/automation.py` | UPDATE | BE | + route `POST .../action/token` |
| `backend/tests/automation/test_automation_action_token.py` | NEW | BE | pytest AC6 |
| `src/shared/api-client/http-client.ts` | UPDATE | Client | + ActionTokenResponseSchema |
| `src/main/license/action-token-client.ts` | NEW | Client | requestActionToken + block offline/deny |
| `src/main/license/index.ts` | UPDATE | Client | barrel append |
| `tests/unit/action-token-client.spec.ts` | NEW | Client | DI mock + no-leak |
| ~~consume / IPC / UI / job_actions~~ | — | — | DEFER 4.6 (D1) |

### Previous story intelligence

- **1.x license**: `BackendLicenseClient.activate/check` qua `postJson` + `BackendHttpError` + zod schema → mirror y hệt cho action-token-client. hwid qua `hwid-generator`.
- **Backend license**: `api/automation.py` rate-limiter + `_error_response` (VN ErrorEnvelope), `services/automation/license.py` `_latest_activation`/`validate_hwid`/`_utc_now`/`*Error`, `models` SQLAlchemy phase3, `core/security.py` JWT encode (`settings.JWT_SECRET`/HS256), alembic phase3 migration. Reuse tất cả.
- **4.4 secret-no-log**: action_token cũng secret → 0 log token (client + backend).
- **4.3 offline/block pattern**: tier2+ MUST online → block rõ ràng (như checkpoint block).
- **172 test client đang PASS** + backend pytest hiện tại — đừng phá.

### Testing chi tiết (AC6)

**Backend** `test_automation_action_token.py` (mirror `test_automation_license.py` fixtures/db):
- issue success: tạo license + activate → request → token decode được (jwt.decode HS256) claims jti/sub/action/exp; exp ≈ now+60s; row action_tokens tồn tại.
- LICENSE_INVALID (key lạ/revoked) → 4xx + code.
- LICENSE_EXPIRED (activation expires_at < now) → code.
- LICENSE_HWID_MISMATCH (hwid khác) → 409.
- ACTION_NOT_ALLOWED (action_type='view') → reject.
- rate limit (vượt window) → 429-ish.
- jti uniqueness: 2 issue → 2 jti khác, cả 2 row tồn tại.

**Client** `action-token-client.spec.ts`:
- success: mock postJson trả {token,jti,expires_at} → requestActionToken trả {token,jti,expiresAt}.
- offline: postJson throw network → `ACTION_TOKEN_OFFLINE` retryable=true.
- deny: postJson throw 403 → `ACTION_TOKEN_DENIED` retryable=false.
- no-leak: error message KHÔNG chứa token/jti giả.

## References

- [Source: epics-phase3.md#Story-4.5 (L414-427)] — AC gốc (POST action/token, JWT HS256 jti/sub/action/exp=60s, Redis SETNX, offline block)
- [Source: architecture.md#R-D9 (L996-997,L1287-1297)] — server-side action token tier2+, anti-reuse
- [Source: architecture.md (L925)] — tier2+ MUST get short-lived server token mỗi request
- [Source: architecture.md (L1391)] — `phase3.action_tokens(jti, license_activation_id, issued_at, expires_at, used_at, action_type)`
- [Source: architecture.md (L110)] — Redis defer (APScheduler hiện tại) → D2 DB jti-UNIQUE
- [Source: backend/app/api/automation.py + services/automation/license.py + models/automation/license.py + core/security.py] — mirror pattern
- [Source: backend/alembic/versions/20260602_01_phase3_license_init.py] — migration mẫu
- [Source: src/shared/api-client/http-client.ts + src/main/license/license-service.ts] — client mirror
- [Source: automation-desktop/CLAUDE.md] — 25 rules (client only)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Backend targeted red/green: `cd backend && PHASE3_TEST_DATABASE_URL=postgresql://admin:adminpassword@localhost:5433/phase3_test venv/bin/pytest tests/automation/test_automation_action_token.py -q` → `6 passed, 3 warnings`.
- Backend Phase 3 regression: `cd backend && PHASE3_TEST_DATABASE_URL=postgresql://admin:adminpassword@localhost:5433/phase3_test venv/bin/pytest tests/automation/ -q` → `41 passed, 1 warning`.
- Client focused: `cd automation-desktop && npx playwright test tests/unit/action-token-client.spec.ts --reporter=line` → `3 passed`.
- Client lint: `cd automation-desktop && npm run lint` → `0 errors` (Node module-type warning only).
- Client typecheck: `cd automation-desktop && npm run typecheck` → `0 errors`.
- Client unit+integration: `cd automation-desktop && npx playwright test tests/unit tests/integration --reporter=line` → `175 passed`.
- Diff hygiene: `git diff --check` → pass.

### Completion Notes List

- Implemented backend `phase3.action_tokens` model + Alembic migration with `jti` primary/unique key, FK to `phase3.license_activations`, timestamps, and `used_at` reserved for 4.6 consume flow.
- Added `POST /api/v1/automation/action/token` with separate 60/min action-token rate limiter, Vietnamese ErrorEnvelope mapping, active-license/HWID/action allowlist verification, and HS256 JWT claim issuance using `settings.JWT_SECRET`.
- Added backend Postgres/Alembic tests for table existence, success JWT claims/DB persistence, invalid/revoked/expired/HWID/action deny paths, rate limit, and unique jti issuance.
- Added automation-desktop action token response schema and `createActionTokenClient` DI wrapper returning token/jti in memory only; offline maps to `ACTION_TOKEN_OFFLINE`, server deny maps to `ACTION_TOKEN_DENIED` without carrying backend details that may contain secrets.
- Added client unit tests for success, offline block, server deny, and token/jti no-leak behavior.
- Fixed Electron SQLCipher integration harness to unset inherited `ELECTRON_RUN_AS_NODE=1` when spawning Electron; this restored existing integration specs during full suite validation without changing app business logic.

### File List

- `_bmad-output/implementation-artifacts/4-5-lay-per-action-server-token.md`
- `_bmad-output/implementation-artifacts/sprint-status-phase3.yaml`
- `automation-desktop/src/main/license/action-token-client.ts`
- `automation-desktop/src/main/license/index.ts`
- `automation-desktop/src/shared/api-client/http-client.ts`
- `automation-desktop/tests/integration/automation-job-repo.spec.ts`
- `automation-desktop/tests/integration/fingerprint-service.spec.ts`
- `automation-desktop/tests/unit/action-token-client.spec.ts`
- `backend/alembic/env.py`
- `backend/alembic/versions/20260603_01_phase3_action_tokens.py`
- `backend/app/api/automation.py`
- `backend/app/models/automation/__init__.py`
- `backend/app/models/automation/action_token.py`
- `backend/app/schemas/automation/__init__.py`
- `backend/app/schemas/automation/action_token.py`
- `backend/app/services/automation/action_token.py`
- `backend/tests/automation/conftest.py`
- `backend/tests/automation/test_automation_action_token.py`

### Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-06-03 | 1.0 | Implemented per-action server token backend/client with Postgres migration, tests, and validation harness fix for Electron spawn env | Codex |
| 2026-06-03 | 0.1 | Story created (bmad-create-story) — per-action server token JWT HS256, client+backend, DB jti-UNIQUE anti-reuse | Luisphan |
