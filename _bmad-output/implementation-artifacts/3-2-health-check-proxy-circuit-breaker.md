# Story 3.2: Health-check proxy + circuit breaker

Status: ready-for-dev

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

- [ ] **Task 1: CircuitBreaker** (AC: #1) — `src/main/proxy/circuit-breaker.ts` class + injected `now`. Export. KHÔNG import electron.
- [ ] **Task 2: proxy-repo** (AC: #3) — `src/main/db/repositories/proxy-repo.ts` getConfig/upsertConfig, prepared stmt. Mirror profile-repo pattern.
- [ ] **Task 3: shared/retry.ts** (AC: #5) — RETRY_POLICY map + computeBackoffMs + isRetryable. Import `Phase3ChannelName` từ ipc-schemas.
- [ ] **Task 4: ProxyService wrap breaker** (AC: #2,#4) — deps thêm `repo: ProxyRepository`, `clock?: () => number`, `breakerConfig?`, `onProxyError?`. `rotate` wrap breaker + persist proxy_configs. Thêm `getHealth(): Promise<{state, configured, cooldownRemainingMs?}>`. Interface + impl. `index.ts` barrel export CircuitBreaker + types.
- [ ] **Task 5: IPC health** (AC: #4) — `ipc-schemas/proxy.ts` thêm `ProxyHealthRequest/Response` schema; `index.ts` registry; `proxy-handlers.ts` handler `phase3:proxy:health` (reuse normalizeError).
- [ ] **Task 6: Bootstrap** (AC: #2) — `electron-bootstrap.ts`: tạo `proxyRepo = createProxyRepository(db)`; truyền vào `createProxyService({ storage, providers, repo: proxyRepo, clock: () => Date.now() })`.
- [ ] **Task 7: Renderer** (AC: #6) — `proxy-api.ts` thêm `getProxyHealth()`; `ProxyView.tsx` health indicator (load mount + sau Test). tiếng Việt, testid `proxy-health-status`.
- [ ] **Task 8: Tests** (AC: #7) — circuit-breaker.spec, retry.spec, proxy-service.spec (mở rộng), proxy-ipc-handlers.spec (health). Real-DB: mở rộng `runProxySchemaSmoke` verify upsert proxy_configs (enabled/last_rotated_at) nếu có sẵn smoke.

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

### Debug Log References

### Completion Notes List

### File List
