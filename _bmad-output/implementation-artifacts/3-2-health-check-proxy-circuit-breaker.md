# Story 3.2: Health-check proxy + circuit breaker

Status: done

<!-- Review patches applied (2026-06-03): P1 wrap upsertConfig best-effort; P2 "Healthy"→"Bình thường" + health-null state + handleSave health try/catch + e2e text; P3 getHealth OPEN→quarantined kể cả cooldown=0. Lint/Typecheck/123 tests PASS. -->


<!-- Phase 3 story (Epic 3 — Proxy Management, story 2/3). Sources: epics-phase3.md#Story-3.2 (L328-339), prd-phase3.md#FR25, architecture.md (retry RETRY_POLICY L1661-1663, circuit breaker L1299, proxy_error enum L1368/L1558). ⚠️ automation-desktop/ — 25 rules CLAUDE.md. Previous: 3.1 done (proxyfb provider, proxy_configs table, ProxyService.rotate). -->

## Story

As a user (affiliate marketer như Minh),
I want hệ thống tự phát hiện proxyfb lỗi liên tục và tạm ngừng (quarantine) provider đó một thời gian,
so that khi proxyfb down, automation KHÔNG fail hàng loạt mà chờ provider hồi phục — và tôi thấy rõ trạng thái proxy.

> ⚠️ **PHẠM VI**: `automation-desktop/`. Story 3.2 = **circuit breaker quanh `ProxyService.rotate` + quarantine + health status + RETRY_POLICY infra** (FR25). Bind proxy per session (FR26) = 3.3. Tích hợp vào automation state machine = Epic 4. Telemetry beacon `proxy_error` = Epic 6 (defer — chỉ để hook).

## Acceptance Criteria

1. **Circuit breaker (generic, testable)**: `src/main/proxy/circuit-breaker.ts` — class `CircuitBreaker` với config `{ failureThreshold, cooldownMs }` + **injected clock `now(): number`** (KHÔNG dùng `Date.now()` trực tiếp — testable). States `CLOSED | OPEN | HALF_OPEN`. `canRequest()`: CLOSED→true; OPEN→nếu `now() ≥ openedAt+cooldownMs` chuyển HALF_OPEN+true, ngược lại false; HALF_OPEN→true. `recordSuccess()`→reset CLOSED, failureCount=0. `recordFailure()`→++count; count≥threshold (hoặc HALF_OPEN fail) → OPEN + set openedAt. `getState()`→`{ state, failureCount, openedAt? }`.
2. **ProxyService.rotate wrap breaker**: trước khi gọi provider → nếu `!breaker.canRequest()` → throw `ProxyServiceError('PROXY_QUARANTINED', 'Proxy đang tạm ngừng do lỗi liên tục. Thử lại sau.', true)`. Provider success → `breaker.recordSuccess()` + persist `proxy_configs.enabled=1` + `last_rotated_at=now ISO`. Provider fail → `breaker.recordFailure()`; nếu breaker chuyển OPEN → persist `proxy_configs.enabled=0` (quarantine) + gọi hook `onProxyError` (defer telemetry); rethrow `PROXY_UNAVAILABLE` retryable:true. KHÔNG đổi behavior 3.1 khi breaker CLOSED + success.
3. **proxy-repo (proxy_configs read/write)**: `src/main/db/repositories/proxy-repo.ts` — `getConfig(provider): {provider,enabled,lastRotatedAt}|undefined`, `upsertConfig(provider, {enabled, lastRotatedAt})` (INSERT ... ON CONFLICT(provider) DO UPDATE). Prepared statements. `enabled` 0/1 ↔ boolean.
4. **IPC `phase3:proxy:health`**: req `{}` (strict), res `{ ok:true, health: { state: 'healthy'|'quarantined', configured: boolean, cooldownRemainingMs?: number } }`. `state='quarantined'` khi breaker OPEN và còn cooldown. Zod 2-way + registry + ErrorEnvelope VN. KHÔNG trả secret.
5. **RETRY_POLICY infra**: `src/shared/retry.ts` — `RETRY_POLICY: Record<Phase3ChannelName, {maxRetries, baseDelayMs, maxDelayMs, retryableCodes: string[]}>` (ít nhất entry `phase3:proxy:rotate`: maxRetries 2, base 1000, retryableCodes `['PROXY_UNAVAILABLE','PROXY_QUARANTINED']`). Helper `computeBackoffMs(attempt, base, max)` (exponential: `min(max, base*2^attempt)`), `isRetryable(channel, code)`. Pure functions, KHÔNG retry inline trong service (architecture: retry centralized). Unit test thuần. **Tích hợp consume vào automation = Epic 4** — 3.2 chỉ tạo infra + test.
6. **ProxyView health indicator**: hiển thị trạng thái proxy: "Healthy" (xanh) / "Tạm ngừng (còn Ns)" (cam) từ `phase3:proxy:health`, refresh khi mount + sau mỗi Test proxy. Hardcode tiếng Việt. testid riêng (rule #16). KHÔNG đụng khu cấu hình API key / cảnh báo HTTP của 3.1.
7. **Tests**: Unit `circuit-breaker.spec.ts` (injected clock): CLOSED→3 fail→OPEN; OPEN trong cooldown→canRequest false; sau cooldown→HALF_OPEN; HALF_OPEN success→CLOSED; HALF_OPEN fail→OPEN lại. Unit `retry.spec.ts`: computeBackoffMs exponential cap, isRetryable whitelist. Unit `proxy-service.spec.ts` (mở rộng): N fail→quarantine→PROXY_QUARANTINED; cooldown qua→thử lại; success→enabled=1+last_rotated_at; verify proxy-repo upsert gọi đúng. Integration `proxy-ipc-handlers.spec.ts`: health channel Zod 2-way + no-secret. `typecheck` PASS, `lint` 0 errors.

## Tasks / Subtasks

- [x] **Task 1: CircuitBreaker** (AC: #1) — `src/main/proxy/circuit-breaker.ts` class + injected `now`. Export. KHÔNG import electron.
- [x] **Task 2: proxy-repo** (AC: #3) — `src/main/db/repositories/proxy-repo.ts` getConfig/upsertConfig, prepared stmt. Mirror profile-repo pattern.
- [x] **Task 3: shared/retry.ts** (AC: #5) — RETRY_POLICY map + computeBackoffMs + isRetryable. Import `Phase3ChannelName` từ ipc-schemas.
- [x] **Task 4: ProxyService wrap breaker** (AC: #2,#4) — deps thêm `repo: ProxyRepository`, `clock?: () => number`, `breakerConfig?`, `onProxyError?`. `rotate` wrap breaker + persist proxy_configs. Thêm `getHealth(): Promise<{state, configured, cooldownRemainingMs?}>`. Interface + impl. `index.ts` barrel export CircuitBreaker + types.
- [x] **Task 5: IPC health** (AC: #4) — `ipc-schemas/proxy.ts` thêm `ProxyHealthRequest/Response` schema; `index.ts` registry; `proxy-handlers.ts` handler `phase3:proxy:health` (reuse normalizeError).
- [x] **Task 6: Bootstrap** (AC: #2) — `electron-bootstrap.ts`: tạo `proxyRepo = createProxyRepository(db)`; truyền vào `createProxyService({ storage, providers, repo: proxyRepo, clock: () => Date.now() })`.
- [x] **Task 7: Renderer** (AC: #6) — `proxy-api.ts` thêm `getProxyHealth()`; `ProxyView.tsx` health indicator (load mount + sau Test). tiếng Việt, testid `proxy-health-status`.
- [x] **Task 8: Tests** (AC: #7) — circuit-breaker.spec, retry.spec, proxy-service.spec (mở rộng), proxy-ipc-handlers.spec (health). Real-DB: mở rộng `runProxySchemaSmoke` verify upsert proxy_configs (enabled/last_rotated_at) nếu có sẵn smoke.

### Review Findings (2026-06-03 — bmad-code-review, 3 reviewers)

> Diff: `17ba0ae`→working-tree. **Lint ✅ · Typecheck ✅ · 123 tests PASS.** E2E chưa exec. Scorecard: AC1✅ AC2✅ AC3✅ AC4⚠️ AC5✅ AC6⚠️ AC7✅ — scope sạch (passive-only, telemetry hook-only, no bind/pool). **Không có Critical/High thực** — breaker logic đúng spec.

**Patch:**

- [x] [Review][Patch][Med] `rotate()`: `repo.upsertConfig` (success line 108 + `quarantineProvider` line 69) KHÔNG wrap try/catch → nếu DB throw: success path mất proxy đã fetch (caller nhận DB error thay proxy); fail path ghi đè `PROXY_UNAVAILABLE` thành raw DB error. Fix: wrap cả 2 upsert best-effort (try/catch, không override result/error chính) [proxy-service.ts:68-76,105-122]
- [x] [Review][Patch][Med] ProxyView health text: `"Healthy"` (tiếng Anh) → tiếng Việt "Bình thường" (AC6 + rule #15); khi `health===null` (load lỗi) đừng hiển thị "Bình thường" giả → show "Đang kiểm tra"/"Không rõ"; `handleSave` wrap health-refresh trong try/catch riêng (đừng để lỗi refresh ghi đè save-success — như handleTest đã làm) [ProxyView.tsx:108, handleSave]
- [x] [Review][Patch][Low] `getHealth` boundary: khi breaker OPEN + cooldown vừa hết (`cooldownRemainingMs===0`) hoặc HALF_OPEN → hiện báo "healthy" sớm dù chưa có trial success. Fix: derive theo `breaker.getState().state` (OPEN→quarantined kể cả =0; CLOSED→healthy). + reset `failureCount` khi breaker chuyển OPEN (getState báo count phình to qua nhiều cycle) [proxy-service.ts:125-135, circuit-breaker.ts recordFailure]

**Dismissed (false-positive / documented / intentional):** `canRequest()` mutate OPEN→HALF_OPEN trong predicate (Blind "Critical" — đây là STANDARD lazy-half-open CB pattern; rotate luôn record sau; getHealth dùng getState không canRequest → không misuse); concurrent HALF_OPEN cho 2 trial (chấp nhận; single-flight = mối lo 3.3); `PROXY_QUARANTINED` trong retryableCodes (khớp AC5 spec; consumer=Epic 4 sẽ xử cooldown); provider data-error (FORMAT/PORT) trip breaker (Dev Notes quyết "mọi throw=1 failure"); restart DB enabled=0 vs in-memory CLOSED mismatch (Dev Notes documented-accepted; getConfig dành cho 3.3); no live-countdown polling (AC6 không yêu cầu); enabled int≠0/1 (chỉ code này ghi); smoke hardcoded date (SQLite TEXT verbatim); lastRotatedAt null (column KHÔNG NOT NULL — verified); test-coverage gaps concurrent/threshold=1/getConfig-undefined (Low — 5 breaker transition ĐÃ phủ qua 3 test).

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules)
- **Rule #12**: clock injected (`now()`) thay `Date.now()` trực tiếp trong CircuitBreaker → deterministic test (giống bài học license clock).
- **Rule #7,#8,#9,#15**: IPC health Zod 2-way + ErrorEnvelope retryable + message tiếng Việt.
- **Rule #1**: circuit-breaker.ts + retry.ts KHÔNG import electron (pure).
- **Rule #10,#11**: health response KHÔNG chứa secret/proxy credential (chỉ state + cooldown).
- **Rule #21**: barrel `proxy/index.ts` export thêm CircuitBreaker.

### Circuit breaker design (chính xác)
```ts
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'
class CircuitBreaker {
  constructor(private cfg: { failureThreshold: number; cooldownMs: number }, private now: () => number) {}
  // state, failureCount, openedAt private
  canRequest(): boolean
  recordSuccess(): void   // → CLOSED, count=0
  recordFailure(): void   // count++; >=threshold || HALF_OPEN → OPEN, openedAt=now()
  getState(): { state; failureCount; openedAt?: number }
}
```
- Default config: `failureThreshold=3, cooldownMs=60_000`. Configurable qua deps.
- **In-memory state** (reset khi restart app — chấp nhận được cho desktop single-process). Quarantine flag persist vào `proxy_configs.enabled` để UI/3.3 đọc được sau restart (note: breaker in-memory sẽ CLOSED lại sau restart nhưng enabled=0 trong DB cho tới rotate thành công kế — chấp nhận, 3.3/Epic 4 có thể reconcile).

### Health-check = PASSIVE (quan sát rotate), KHÔNG background pinger
- 3.2 KHÔNG tạo timer ping proxy định kỳ. Breaker quan sát kết quả `rotate()` thực tế (FR25 "phát hiện provider trả lỗi vượt ngưỡng"). Active background health-check pinger = future enhancement (ghi note, KHÔNG làm — tránh timer leak + tốn API quota proxyfb).

### proxy_configs (3.1 đã tạo)
- `proxy_configs(provider TEXT PK, enabled INTEGER DEFAULT 1, last_rotated_at TEXT)` — 3.1 tạo table NHƯNG chưa ghi gì. 3.2 là story ĐẦU TIÊN ghi vào (upsert). [Source: src/main/db/client.ts:42-47]
- `provider='proxyfb'` cho story này.

### Telemetry proxy_error — DEFER Epic 6
- AC epic gốc nói "telemetry ghi `proxy_error`". `src/main/telemetry/index.ts` hiện chỉ `export {}` (Epic 6 chưa build). → 3.2 expose hook `onProxyError?: (ctx) => void` trong ProxyServiceDeps (gọi khi breaker mở), bootstrap truyền no-op (hoặc bỏ trống). Epic 6 sẽ wire beacon `proxy_error` vào hook này. KHÔNG implement beacon giờ. Ghi `deferred-work.md`.

### RETRY_POLICY (architecture L1661-1663)
- `src/shared/retry.ts`: centralized, KHÔNG retry inline trong service. 3.2 tạo policy map + pure helpers + test. **Consumer** (ai gọi withRetry) = Epic 4 automation state machine (ACQUIRING_PROXY retry). 3.2 chỉ build infra để 3.3/Epic 4 dùng. [Source: architecture.md L1661-1663, folder retry.ts L1866]

### Files UPDATE (current state)
| File | 3.2 đổi gì | Giữ |
|---|---|---|
| `proxy/proxy-service.ts` | wrap breaker + getHealth + deps repo/clock/onProxyError | configGet/configSet + rotate happy-path 3.1 |
| `proxy/index.ts` | export CircuitBreaker + types | export 3.1 |
| `ipc-schemas/proxy.ts` | + health schema | schema 3.1 |
| `ipc-schemas/index.ts` | + registry phase3:proxy:health | entry 3.1 |
| `ipc/proxy-handlers.ts` | + health handler | 3 handler 3.1 |
| `electron-bootstrap.ts` | wire proxyRepo + clock vào proxyService | wiring 3.1 |
| `proxy-api.ts` | + getProxyHealth | 3.1 api |
| `ProxyView.tsx` | + health indicator | API-key config + HTTP warning 3.1 |

### Previous story intelligence (3.1)
- `ProxyServiceError(code, message, retryable)` đã có — reuse. `normalizeError` trong proxy-handlers: ProxyServiceError→propagate, khác→PROXY_ERROR retryable:false.
- `rotate()` 3.1: get key safeStorage → provider.getProxy → return ProxyInfo. 3.2 chỉ WRAP, giữ core.
- Provider proxyfb throw `PROXY_UNAVAILABLE`/`PROXY_FORMAT_INVALID`(false)/`PROXY_PORT_INVALID`(false) — breaker chỉ count failure khi rotate throw (mọi loại); cân nhắc: format/port error (data lỗi) có nên trip breaker? → CÓ (provider trả garbage = provider lỗi). Đơn giản: mọi throw từ rotate = 1 failure.
- channelRegistry bắt buộc (preload throw nếu thiếu). Zod-inferred type single-source (bài học 2.2/3.1). `.strict()` cho request schema.
- E2E helper `launchWithActiveLicense`/`closeServer` (proxy.spec.ts 3.1). FakeIpcMain integration.
- KHÔNG commit `.phase3-manual/` + `.review-*.diff`.

### Edge cases
- Breaker OPEN, gọi rotate trong cooldown → PROXY_QUARANTINED retryable:true (KHÔNG gọi provider, tiết kiệm quota).
- Cooldown hết → HALF_OPEN → 1 rotate thử: success→CLOSED+enabled=1; fail→OPEN lại (cooldown mới).
- proxy_configs chưa có row provider → upsert tạo mới.
- getHealth khi chưa cấu hình key → `configured:false`, state vẫn báo (healthy nếu breaker CLOSED).
- clock injected → test tua thời gian không cần sleep thật.
- Restart app: breaker in-memory reset CLOSED nhưng proxy_configs.enabled có thể =0 → getHealth nên ưu tiên breaker in-memory state (source of truth runtime); enabled DB chỉ để observability/3.3.
- Nhiều rotate đồng thời (3.3 sẽ gọi) → breaker state mutation; better-sqlite3 sync + single-thread Node → an toàn (note: nếu Epic 4 worker thread → cần revisit).

### Scope — KHÔNG làm
- KHÔNG background health-check pinger (passive only).
- KHÔNG implement telemetry beacon (Epic 6 — chỉ hook).
- KHÔNG bind proxy per session / proxy-pool (3.3).
- KHÔNG tích hợp retry vào automation (Epic 4 — chỉ tạo retry.ts infra).
- KHÔNG đụng provider proxyfb logic 3.1 (chỉ wrap ở service).
- KHÔNG backend/frontend.

### References
- [Source: epics-phase3.md#Story-3.2 (L328-339)]
- [Source: prd-phase3.md#FR25] — health-check + circuit-break
- [Source: architecture.md#L1661-1663] — RETRY_POLICY centralized; [L1299] circuit breaker; [L1368,L1558] proxy_error enum
- [Source: src/main/proxy/proxy-service.ts] — rotate/configGet/configSet 3.1 (wrap)
- [Source: src/main/db/client.ts:42-47] — proxy_configs schema
- [Source: src/main/db/repositories/profile-repo.ts] — repo pattern mẫu
- [Source: src/main/ipc/proxy-handlers.ts, ipc-schemas/proxy.ts, index.ts] — IPC pattern 3.1
- [Source: src/renderer/src/views/ProxyView.tsx, api/proxy-api.ts] — UI 3.1
- [Source: automation-desktop/CLAUDE.md], [Source: 3-1-tich-hop-proxy-provider-proxyfb.md Review Findings]

## Dev Agent Record

### Agent Model Used
Codex GPT-5

### Debug Log References
- RED Task 1-3: `npx playwright test tests/unit/circuit-breaker.spec.ts tests/unit/retry.spec.ts tests/integration/proxy-repo.spec.ts --reporter=line` failed initially because `circuit-breaker.ts`, `retry.ts`, and `proxy-repo.ts` did not exist.
- Task 1-3 GREEN: `npm rebuild better-sqlite3-multiple-ciphers && npx playwright test tests/integration/proxy-repo.spec.ts --reporter=line` -> 1 passed after rebuilding native module for Node ABI.
- Task 4 RED/GREEN: `npx playwright test tests/unit/proxy-service.spec.ts --reporter=line` -> RED on missing quarantine/repo writes, then GREEN 8 passed after wrapping `ProxyService.rotate`.
- Task 5 RED/GREEN: `npx playwright test tests/integration/proxy-ipc-handlers.spec.ts tests/integration/proxy-ipc-contract.spec.ts --reporter=line` -> RED on missing health channel/registry, then GREEN 11 passed.
- Task 6 smoke adjustment: rewrote `proxy-repo.spec.ts` to use Electron smoke because direct Node SQLCipher native ABI conflicts with Electron-based integration smoke tests.
- Targeted Story 3.2 suite: `npm rebuild better-sqlite3-multiple-ciphers && npx playwright test tests/unit/circuit-breaker.spec.ts tests/unit/retry.spec.ts tests/unit/proxy-service.spec.ts tests/integration/proxy-repo.spec.ts tests/integration/proxy-ipc-handlers.spec.ts tests/integration/proxy-ipc-contract.spec.ts tests/integration/db-schema.spec.ts --reporter=line` -> 26 passed.
- E2E proxy: `npx electron-rebuild -f -w better-sqlite3-multiple-ciphers && npx electron-vite build && npx playwright test tests/e2e/proxy.spec.ts --reporter=line` -> 2 passed.
- Quality: `npm run typecheck` -> passed; `npm run lint` -> passed (existing module-type warning only for local eslint rule file).
- Full non-E2E regression: `npx playwright test tests/unit tests/integration tests/api tests/component --reporter=line` -> 123 passed.
- Full E2E regression: `npx playwright test tests/e2e --reporter=line` -> 18 passed.

### Completion Notes List
- Implemented pure `CircuitBreaker` with injected clock, CLOSED/OPEN/HALF_OPEN states, deterministic cooldown transition, and reset/reopen semantics.
- Added centralized `RETRY_POLICY`, `computeBackoffMs`, and `isRetryable` helpers for `phase3:proxy:rotate` without adding inline retry behavior to services.
- Added `ProxyRepository` for `proxy_configs` get/upsert with boolean mapping and Electron smoke validation for real SQLCipher writes.
- Wrapped `ProxyService.rotate` with passive circuit breaker behavior: successful rotate records success and persists `enabled=1` + ISO `lastRotatedAt`; repeated provider failures open quarantine, persist `enabled=0`, call `onProxyError`, and block provider calls during cooldown with `PROXY_QUARANTINED`.
- Added `ProxyService.getHealth()` and IPC `phase3:proxy:health` with strict request schema, public health-only response, registry entry, and Vietnamese ErrorEnvelope handling.
- Wired `proxyRepo` and injected clock into Electron bootstrap; extended proxy schema smoke to verify repository upsert/read.
- Added renderer `getProxyHealth()` and `ProxyView` health indicator (`proxy-health-status`) that shows `Healthy` or `Tạm ngừng (còn Ns)`, refreshes on mount, after save, and after proxy test success/failure.
- Added E2E coverage for health indicator happy path and quarantine UI after repeated provider failures, while preserving no-secret display assertions.

### File List
- automation-desktop/src/main/proxy/circuit-breaker.ts
- automation-desktop/src/main/proxy/proxy-service.ts
- automation-desktop/src/main/proxy/index.ts
- automation-desktop/src/main/db/repositories/proxy-repo.ts
- automation-desktop/src/main/adapters/electron-bootstrap.ts
- automation-desktop/src/main/ipc/proxy-handlers.ts
- automation-desktop/src/shared/retry.ts
- automation-desktop/src/shared/ipc-schemas/proxy.ts
- automation-desktop/src/shared/ipc-schemas/index.ts
- automation-desktop/src/renderer/src/api/proxy-api.ts
- automation-desktop/src/renderer/src/views/ProxyView.tsx
- automation-desktop/src/renderer/src/assets/main.css
- automation-desktop/tests/unit/circuit-breaker.spec.ts
- automation-desktop/tests/unit/retry.spec.ts
- automation-desktop/tests/unit/proxy-service.spec.ts
- automation-desktop/tests/integration/proxy-repo.spec.ts
- automation-desktop/tests/integration/proxy-ipc-handlers.spec.ts
- automation-desktop/tests/integration/proxy-ipc-contract.spec.ts
- automation-desktop/tests/e2e/proxy.spec.ts
- _bmad-output/implementation-artifacts/3-2-health-check-proxy-circuit-breaker.md
- _bmad-output/implementation-artifacts/sprint-status-phase3.yaml

### Change Log
- 2026-06-03: Implemented Story 3.2 proxy health-check/circuit-breaker, proxy config repository writes, retry policy infra, health IPC, ProxyView health indicator, and full unit/integration/E2E coverage.
