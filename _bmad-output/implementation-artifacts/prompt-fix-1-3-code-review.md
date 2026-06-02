# Dev Fix Prompt — Story 1.3 Code Review (21 patches)

> Dán cho dev agent. Story 1.3 happy-path ĐÃ ĐÚNG (live API smoke 5/5 pass trên Postgres thật). Đây là 21 patch từ 3-layer adversarial review — tập trung **edge cases + resilience + 1 rule-violation tái phát**. KHÔNG đổi happy-path logic đã verify.
>
> ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules) + `_bmad-output/project-context.md` § Testing Rules. Sau khi fix: `npm run lint && npm run typecheck` (client) + `pytest backend/tests/automation/` trên Postgres thật phải PASS. Set Status story → review để re-review.

## NHÓM A — Backend (Python)

### A1. `LicenseActivationError` — `str(exc)` rỗng (observability)
`backend/app/services/automation/license.py:15` — `@dataclass(frozen=True)` trên `Exception` → dataclass `__init__` không gọi `Exception.__init__` → `str(exc)`/`exc.args` rỗng, Sentry/uvicorn log message rỗng.
**Fix**: thêm `__post_init__` gọi `super().__init__(self.message)`, HOẶC bỏ dataclass, dùng class thường với `__init__` set `code/message/retryable` + `super().__init__(message)`.

### A2. Re-activate sau expire trả ngày cũ (vi phạm AC2)
`license.py:55-64` — khi `existing_activation` cùng HWID nhưng ĐÃ expired, vẫn trả `expires_at` cũ. AC2: compute `now + days_total`.
**Fix**: nếu `existing_activation.expires_at < now` → renew (tạo activation mới hoặc update expires_at = now + days_total, tăng rebind_count nếu phù hợp). Nếu chưa expired → giữ idempotent như hiện tại.

### A3. `days_total <= 0` không validate → silent stuck
`license.py` + migration — `timedelta(days=0)` → `expires_at == activated_at` → client `active:false` im lặng.
**Fix**: validate `days_total > 0` trong service (raise `LICENSE_INVALID` nếu ≤ 0) + CHECK constraint `days_total > 0` trong migration.

### A4. Race concurrent activate (no lock/unique)
`license.py:47-52` — 2 request đồng thời cùng key khác HWID đều qua check `existing is None` → 2 INSERT.
**Fix**: unique constraint `uq_license_activations_license_id` trên `license_activations(license_id)` (1 license = 1 activation) trong migration + model; handle IntegrityError → re-query → HWID match check. Hoặc `SELECT ... FOR UPDATE` trên license row.

### A5. Rate-limit endpoint activate (decision: thêm ngay)
`backend/app/api/automation.py`, `main.py` — endpoint public, thiếu rate-limit → brute-force key.
**Fix**: thêm rate-limit per-IP + per-key (vd `slowapi` hoặc middleware in-memory/Redis đếm). Trả 429 + ErrorEnvelope `RATE_LIMITED` retryable:true message tiếng Việt khi vượt ngưỡng. Mức gợi ý: 5-10 req/phút/IP.

### A6. FK schema-qualify (minor)
migration + model — `created_by_admin → users.id` không qualify schema, dựa search_path.
**Fix**: dùng `public.users.id` explicit trong ForeignKey.

### A7. Migration `SET search_path` không RESET (minor)
`20260602_01_phase3_license_init.py:20` — leak sang pooled connection.
**Fix**: thêm `op.execute("RESET search_path")` cuối `upgrade()`. (Hoặc bỏ SET, dùng schema-qualified table names — vốn đã qualify trong create_table schema='phase3').

### A8. Downgrade DROP SCHEMA guard (minor)
**Fix**: `DROP SCHEMA IF EXISTS phase3 RESTRICT` để fail-early nếu có object Phase 3.x khác.

## NHÓM B — Backend Test (rule-violation + gap)

### B1. ⚠️ ATTACH tái phát trong `test_storage_cleanup.py` (RULE VIOLATION)
`backend/tests/test_storage_cleanup.py:24-26` — thêm `ATTACH DATABASE ':memory:' AS phase3`. Đây đúng pattern rule cấm (project-context § Testing). test_storage_cleanup KHÔNG import phase3 models → ATTACH thừa.
**Fix**: XÓA hoàn toàn ATTACH khỏi file này. Verify test vẫn pass.

### B2. Cross-schema FK chưa test (prior Finding #3 chỉ giải quyết nửa)
`backend/tests/automation/test_automation_license.py` — chỉ test intra-phase3 FK (`license_activations → licenses`). Chưa test cross-schema `phase3.licenses.created_by_admin → public.users.id`.
**Fix**: thêm test insert License với `created_by_admin` = UUID không tồn tại trong `public.users` → phải fail FK (chứng minh cross-schema FK enforce trên Postgres).

### B3. `_reset_postgres_database` DROP public schema, guard yếu
`backend/tests/automation/conftest.py:36-40` — guard chỉ check tên DB chứa 'test'/'phase3' → `prod-host/medirus_test` qua được + wipe Phase 1+2.
**Fix**: KHÔNG drop `public` schema (chỉ drop+recreate `phase3`). Nếu cần clean public, thêm guard host (chỉ localhost) + explicit env opt-in `PHASE3_ALLOW_PUBLIC_RESET=1`.

## NHÓM C — Client safeStorage & License resilience (TS)

### C1. safeStorage adapter không crash-safe
`automation-desktop/src/main/adapters/electron-safe-storage.ts`:
- `readStore()` JSON.parse không try/catch → file corrupt → SyntaxError crash
- `get()`/`decryptString()` không try/catch + không check `isEncryptionAvailable()` → keychain re-lock/corrupt → crash
- `writeStore()` không atomic → partial write → corrupt
**Fix**: try/catch quanh readStore (fallback `{}`  + log redacted warning), guard `isEncryptionAvailable()` ở cả get lẫn set, atomic write (ghi temp file + rename).

### C2. License persist non-atomic → stuck vĩnh viễn
`automation-desktop/src/main/license/license-service.ts` — settings(expires/rebind) commit trước, `storage.set(activation_id)` fail sau → `active:false` vĩnh viễn.
**Fix**: persist `activation_id` (safeStorage) TRƯỚC, settings sau; hoặc nếu storage.set fail → rollback settings / không mark activated. Đảm bảo state nhất quán.

### C3. `fetch()` không timeout
`license-service.ts` — backend treo → IPC hang.
**Fix**: `fetch(url, { signal: AbortSignal.timeout(15000) })` + catch AbortError → ErrorEnvelope `NETWORK_TIMEOUT` retryable:true message tiếng Việt.

### C4. Backend HTTP response không Zod-validate
`license-service.ts` — `as BackendActivationResponse` cast thuần → thiếu field → lưu `"undefined"`.
**Fix**: định nghĩa Zod schema cho backend response, `.parse()` trước khi dùng/lưu. Fail → ErrorEnvelope.

## NHÓM D — Client HWID (TS)

### D1. HWID instability — virtual interface đổi HWID
`automation-desktop/src/main/license/hwid-generator.ts:firstMacAddress` — lấy MAC non-internal đầu tiên theo thứ tự không deterministic → docker0/utun(VPN) xuất hiện đổi HWID → false `LICENSE_HWID_MISMATCH` cùng máy → user lock out.
**Fix**: lọc virtual interface (tên `docker`, `veth`, `utun`, `vmnet`, `vboxnet`, `br-`, `tun`, `tap`...) + sort MAC deterministic (vd theo tên interface alphabetical hoặc lấy MAC nhỏ nhất) để cùng máy luôn cùng HWID dù Docker/VPN bật/tắt.

### D2. `machineId()` không try/catch
`hwid-generator.ts:generateHwid` — Linux sandbox/container không có `/etc/machine-id` → throw.
**Fix**: try/catch quanh `machineId()`, fallback stable khác (vd hostname + cpu) + log; KHÔNG để generateHwid throw chặn flow.

## NHÓM E — Client IPC & UI (TS)

### E1. pipe-split error parsing fragile
`automation-desktop/src/main/ipc/license-handlers.ts` — parse `error.message.split('|')` (format `code|message|retryable`). Message tiếng Việt chứa `|` vỡ.
**Fix**: dùng typed `LicenseServiceError` (instanceof + đọc `.code/.message/.retryable`), XÓA nhánh string split. Service phải throw typed error, không Error thô có `|`.

### E2. `App.tsx handleActivate` không catch + error state im lặng
`automation-desktop/src/renderer/src/App.tsx` — không catch; khi status inactive không set error.
**Fix**: try/catch trong handleActivate, set App-level error rõ ràng; khi `status.active === false` sau activate → hiển thị lý do (vd "License đã hết hạn").

### E3. Zod `datetime()` fragile (minor)
`automation-desktop/src/shared/ipc-schemas/license.ts:6` — `z.string().datetime()` strict Z. Backend hiện trả Z (OK) nhưng fragile.
**Fix**: `z.string().datetime({ offset: true })` để chấp nhận cả `+00:00`.

### E4. Extract `shared/api-client/http-client.ts` (minor, task deviation)
License-service inline fetch. Task hứa tạo `shared/api-client/http-client.ts`.
**Fix**: extract HTTP client ra `src/shared/api-client/http-client.ts` (fetch + timeout + Zod validate + error mapping) để Epic 8 cert-pinning reuse. License-service dùng client này.

## Definition of Done

- [ ] 21 patch fixed (A1-A8, B1-B3, C1-C4, D1-D2, E1-E4)
- [ ] Happy-path logic KHÔNG đổi (live smoke vẫn 5/5)
- [ ] `pytest backend/tests/automation/` PASS trên Postgres thật (testcontainers/PG)
- [ ] Cross-schema FK test thêm + PASS
- [ ] `test_storage_cleanup.py` KHÔNG còn ATTACH
- [ ] Client `npm run lint && typecheck && test` PASS
- [ ] HWID deterministic khi bật/tắt Docker/VPN (test thêm)
- [ ] safeStorage crash-safe (corrupt file/keychain unavailable không crash app)
- [ ] Rate-limit endpoint activate hoạt động (429 khi vượt)
- [ ] Set Story Status → `review`, sprint-status 1.3 → `review`

## Tham chiếu
- Story: `1-3-activate-license-voi-hwid-binding.md` § Review Findings (full code review)
- Rules: `automation-desktop/CLAUDE.md`, `_bmad-output/project-context.md`
- Live smoke verify happy-path đúng — chỉ fix edge/resilience/rule, KHÔNG đổi happy logic
