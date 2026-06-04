# Story 5.6: Cấu hình API key CAPTCHA solver

Status: done

Epic: 5 — Khả năng Tự phục hồi (Adaptive Resilience) · Story: 5.6 · ID: 5.6

> ⚠️ **STORY NHẠY CẢM: secret + chi phí thật.** Story này mở đường production cho Story 5.5. Mọi API key CapSolver/2captcha PHẢI write-only, lưu `safeStorage`, không echo về renderer, không vào SQLite/log/telemetry. Feature flag `captcha.solver.enabled` mặc định OFF.

## Story

As a user,
I want nhập và bật/tắt API key CapSolver/2captcha qua Settings,
so that tôi kiểm soát chi phí CAPTCHA solver và chỉ bật auto-solver khi đã sẵn sàng.

## Acceptance Criteria

- **AC1 (Write-only key persistence)** — Given user mở Settings, When nhập API key CapSolver hoặc 2captcha và bấm lưu, Then key được trim + lưu qua `ElectronSafeStorage` key `captcha.capsolver.api_key` hoặc `captcha.2captcha.api_key`; response chỉ `{ ok: true }`; key KHÔNG lưu vào `local_settings`, KHÔNG echo qua IPC, KHÔNG xuất hiện trong UI sau khi save.
- **AC2 (Safe status IPC)** — Given renderer cần render trạng thái, When gọi `phase3:captcha:status`, Then response chỉ có booleans `{ capsolverConfigured, twoCaptchaConfigured, enabled }` và KHÔNG chứa key, partial key, provider secret, token, proxy credential.
- **AC3 (Feature flag control)** — Given user toggle CAPTCHA solver, When bật/tắt và save, Then `captcha.solver.enabled` được lưu trong `local_settings` bằng `'true' | 'false'`; mặc định khi chưa có setting là OFF; UI không tự bật flag khi user chỉ save key.
- **AC4 (IPC contract + validation)** — Given payload invalid, empty key, unknown provider, or response malformed, Then IPC trả ErrorEnvelope tiếng Việt với `retryable` boolean; request/response dùng Zod 2-way và được đăng ký trong `channelRegistry` để preload validate trước khi gọi main.
- **AC5 (Settings UX)** — Given user vào Settings, Then có section CAPTCHA solver hiển thị trạng thái cấu hình từng provider, 2 password inputs write-only, nút lưu riêng cho CapSolver/2captcha, và toggle bật solver; copy tiếng Việt rõ về chi phí thật + mặc định OFF; không hiển thị key đã lưu.
- **AC6 (5.5 integration)** — Given 5.5 bootstrap đang đọc `captcha.solver.enabled`, `captcha.capsolver.api_key`, `captcha.2captcha.api_key`, When 5.6 lưu key/flag, Then production solver path tự dùng được mà không sửa lại solver core; CapSolver vẫn primary, 2captcha fallback; thiếu cả 2 key hoặc flag OFF vẫn fallback `CHECKPOINT_BLOCKED`.
- **AC7 (Secret hygiene regression)** — Given bất kỳ IPC/UI/test result, Then JSON/stringified response không chứa API key input; no direct `console.*` added; no key in `automation_jobs.result`, `local_settings`, telemetry, or logs.
- **AC8 (Test coverage)** — Unit/integration/E2E coverage: schema validation, IPC write-only + status booleans, settings UI save/toggle flow, no-secret assertions, and 5.5 gate compatibility. `npm run lint`, `npm run typecheck`, and relevant Playwright tests pass; no `test.fixme`.

## Tasks / Subtasks

- [x] **T1 — Shared IPC schemas** (AC2, AC4, AC7)
  - [x] Add `src/shared/ipc-schemas/captcha.ts` with provider enum `capsolver | 2captcha`, `CaptchaSetKeyRequestSchema`, `CaptchaSetKeyResponseSchema`, `CaptchaStatusRequestSchema`, `CaptchaStatusResponseSchema`.
  - [x] Request `apiKey` must be `z.string().trim().min(1).max(4096)` or equivalent transform; provider rejects unknown values.
  - [x] Status response shape must be `{ ok: true, capsolverConfigured: boolean, twoCaptchaConfigured: boolean, enabled: boolean }` only. Do not include key or masked key.
  - [x] Export types and register both channels in `src/shared/ipc-schemas/index.ts`: `phase3:captcha:set-key`, `phase3:captcha:status`.

- [x] **T2 — Main CAPTCHA config IPC handler** (AC1, AC2, AC3, AC4, AC7)
  - [x] Add `src/main/ipc/captcha-handlers.ts` with `registerCaptchaHandlers(ipcMain, deps)`.
  - [x] Deps should be narrow: `storage: Pick<SecureStorage, 'get' | 'set'>`, `settings: Pick<SettingsRepository, 'getSetting' | 'setSetting'>`.
  - [x] Map provider to exact storage keys: `capsolver -> captcha.capsolver.api_key`, `2captcha -> captcha.2captcha.api_key`.
  - [x] `set-key`: parse request, trim key, call `storage.set(storageKey, trimmed)`, return parsed `{ ok: true }` only.
  - [x] `status`: call `storage.get()` for both keys and `settings.getSetting('captcha.solver.enabled')`; return configured booleans + `enabled: value === 'true'`.
  - [x] Error mapping: validation -> `VALIDATION_ERROR` retryable false; storage/settings get/set failure -> Vietnamese ErrorEnvelope with retryable true only when retry could help. Never include raw Error object if it could contain secret.

- [x] **T3 — Bootstrap wiring** (AC2, AC3, AC4, AC6)
  - [x] Export handler from `src/main/ipc/index.ts`.
  - [x] Register handler in `src/main/adapters/electron-bootstrap.ts` near settings/proxy handlers using existing `deps.adapters.storage` + `deps.services.settings`.
  - [x] Reuse existing constants already used by 5.5 bootstrap where practical: `captcha.solver.enabled`, `captcha.capsolver.api_key`, `captcha.2captcha.api_key`.
  - [x] Do not touch checkpoint solver core unless type imports require it.

- [x] **T4 — Renderer API wrapper** (AC2, AC4, AC7)
  - [x] Add `src/renderer/src/api/captcha-api.ts` mirroring `proxy-api.ts` `assertOk` pattern.
  - [x] Functions: `getCaptchaStatus(): Promise<{ capsolverConfigured; twoCaptchaConfigured; enabled }>` and `setCaptchaKey(provider, apiKey): Promise<void>`.
  - [x] Optional `setCaptchaEnabled(enabled)` may call existing `setSetting('captcha.solver.enabled', String(enabled))`; keep the key write path on `phase3:captcha:set-key`, not generic settings.

- [x] **T5 — Settings UI** (AC3, AC5, AC7)
  - [x] Update `src/renderer/src/App.tsx` Settings view or extract `CaptchaSolverSettings` component if it keeps App readable.
  - [x] On mount, load current headless setting plus captcha status; avoid one failed request preventing the rest of Settings from rendering.
  - [x] Add two password fields with test ids: `captcha-capsolver-key-input`, `captcha-2captcha-key-input`.
  - [x] Add save buttons: `captcha-capsolver-save-button`, `captcha-2captcha-save-button`; disable immediately in `onClick` before async; clear field after successful save; update configured status.
  - [x] Add toggle `captcha-solver-enabled-toggle`; persist `'true'/'false'` in `local_settings`; default unchecked when status says disabled.
  - [x] Display provider status booleans in Vietnamese: configured/not configured. Do not render stored key or masked key.
  - [x] Include concise warning copy: CAPTCHA solver costs real money, sends proxy to provider during solve per Story 5.5, and stays OFF until user enables.

- [x] **T6 — Tests: IPC + schema** (AC1, AC2, AC3, AC4, AC7, AC8)
  - [x] Add `tests/integration/captcha-ipc-handlers.spec.ts` with fake IPC, fake storage Map, fake settings Map.
  - [x] Assert `set-key` stores trimmed key to storage key and response does not contain the key.
  - [x] Assert `status` returns booleans only and `enabled` follows `captcha.solver.enabled === 'true'`.
  - [x] Assert invalid provider/empty key/unexpected payload returns ErrorEnvelope with Vietnamese message and `retryable: false`.
  - [x] Update `tests/unit/ipc-contracts.spec.ts` to include `phase3:captcha:set-key` and `phase3:captcha:status`, and validate schemas reject secret-echo responses.

- [x] **T7 — Tests: UI / E2E** (AC3, AC5, AC7, AC8)
  - [x] Add or extend E2E Settings test (likely `tests/e2e/profiles.spec.ts` power-user/settings flow or a new focused `tests/e2e/captcha-settings.spec.ts`).
  - [x] Scenario: activate app, open Settings, see solver OFF + unconfigured, save CapSolver key, save 2captcha key, verify fields clear and statuses become configured.
  - [x] Toggle enabled ON; poll `phase3:settings:get` for `captcha.solver.enabled` equals `'true'`.
  - [x] Assert `settings-view` and IPC status output do not contain the raw keys.

- [x] **T8 — Verification + secret grep** (AC6, AC7, AC8)
  - [x] Run targeted tests: `npx playwright test tests/integration/captcha-ipc-handlers.spec.ts tests/unit/ipc-contracts.spec.ts --reporter=line` plus any new E2E.
  - [x] Run `npm run typecheck` and `npm run lint`.
  - [x] Run relevant full unit/integration or existing project smoke as practical.
  - [x] Grep source/test outputs for accidental raw key echo patterns around `CAPSOLVER_SECRET`, `TWO_CAPTCHA_SECRET`, `captcha.capsolver.api_key`, `captcha.2captcha.api_key`, and `console.`. Production source must not log secrets.

## Dev Notes

### Critical Guardrails

- **Do not use generic `phase3:settings:set` for API keys.** It persists to SQLCipher `local_settings`; AC1 requires OS keychain via `ElectronSafeStorage`. Generic settings is allowed only for flag `captcha.solver.enabled`.
- **Do not add a read-key IPC.** Renderer gets only configured booleans. Password fields are write-only and clear after save.
- **Do not return raw Error objects from storage failures** if they can include the attempted key. Build sanitized ErrorEnvelope manually.
- **Do not enable solver automatically after saving a key.** Feature stays OFF until the user toggles `captcha.solver.enabled`.
- **Do not touch provider client implementation from 5.5.** This story is config/UI/IPC wiring. Solver already reads safeStorage keys in bootstrap.
- **Do not store masked keys.** Even masked/partial keys are unnecessary leakage and complicate tests.

### Current 5.5 Integration State

5.5 already wires bootstrap constants and solver gate:

```ts
const CAPTCHA_SOLVER_ENABLED_SETTING = 'captcha.solver.enabled'
const CAPTCHA_CAPSOLVER_KEY = 'captcha.capsolver.api_key'
const CAPTCHA_TWO_CAPTCHA_KEY = 'captcha.2captcha.api_key'
```

`createCheckpointSolver({ isEnabled, getClients })` reads safeStorage keys at solve time and creates clients in order CapSolver then 2captcha. This story must save the exact same keys so production path works without changing solver core. [Source: automation-desktop/src/main/adapters/electron-bootstrap.ts]

### Existing Patterns to Reuse

- IPC schema style: `src/shared/ipc-schemas/settings.ts`, `proxy.ts`, `content-template.ts`; export from `src/shared/ipc-schemas/index.ts` so preload validates request/response.
- IPC handler style: `src/main/ipc/settings-handlers.ts` and `proxy-handlers.ts`; use `safeParse` request and `ResponseSchema.parse(...)` response.
- Renderer API wrapper style: `src/renderer/src/api/proxy-api.ts` with local `assertOk`.
- UI pattern: `src/renderer/src/views/ProxyView.tsx` for password input, configured boolean, save button, clearing key after save, and no-secret E2E assertions.
- Settings surface currently lives inline in `src/renderer/src/App.tsx`. Extract a component only if it reduces clutter; keep styles consistent with `.settings-panel`, `.settings-grid`, `.settings-row`, `.settings-toggle`, `.license-input`, `.primary-button`, `.secondary-button`.

### Files Expected

| File | Action | Notes |
|---|---|---|
| `automation-desktop/src/shared/ipc-schemas/captcha.ts` | NEW | Zod request/response schemas + types |
| `automation-desktop/src/shared/ipc-schemas/index.ts` | UPDATE | export captcha schemas/types + register channels |
| `automation-desktop/src/main/ipc/captcha-handlers.ts` | NEW | write-only set-key + status handlers |
| `automation-desktop/src/main/ipc/index.ts` | UPDATE | export captcha handler |
| `automation-desktop/src/main/adapters/electron-bootstrap.ts` | UPDATE | register captcha IPC handler |
| `automation-desktop/src/renderer/src/api/captcha-api.ts` | NEW | renderer wrapper |
| `automation-desktop/src/renderer/src/App.tsx` | UPDATE | Settings CAPTCHA solver section or component import |
| `automation-desktop/src/renderer/src/App.css` | UPDATE if needed | Only if current classes cannot support layout cleanly |
| `automation-desktop/tests/integration/captcha-ipc-handlers.spec.ts` | NEW | write-only/status/error tests |
| `automation-desktop/tests/unit/ipc-contracts.spec.ts` | UPDATE | channel registry + schema tests |
| `automation-desktop/tests/e2e/captcha-settings.spec.ts` or existing E2E | NEW/UPDATE | Settings save/toggle/no-secret UI flow |

### Testing Standards

- Use `@playwright/test`, not Vitest.
- Unit/pure schema tests go under `tests/unit`; IPC handler tests under `tests/integration`; UI behavior under `tests/e2e`.
- E2E should assert raw keys are absent from Settings DOM after save. Use fake keys like `CAPSOLVER_SECRET_123` and `TWO_CAPTCHA_SECRET_456` only in tests.
- `npm run lint` applies to tests; no `test.fixme`.
- Existing lint warning may exist for old `console.warn` in bootstrap; do not add new direct logging.

### Previous Story Intelligence (5.5)

- 5.5 completed and then had review patches applied. Key lesson: budget/gate/proxy behavior is sensitive; avoid changing checkpoint solving logic in 5.6.
- Review F8 fixed proxy slot leak when browser is intentionally kept open for manual checkpoint/2FA. Do not reintroduce close/release coupling.
- Review F4 moved feature flag gate before DOM detection. 5.6 must keep flag default OFF and not auto-enable after key save.
- 5.5 verification after review patches: `npm run typecheck && npm run lint && npx playwright test tests/unit --reporter=line` passed with `190 passed` in the current repo snapshot.

### Latest Technical Notes

- Electron `safeStorage` remains the correct in-repo adapter boundary for OS-backed encryption. Use existing `ElectronSafeStorage`; do not import `safeStorage` outside `src/main/adapters`. Official docs: https://www.electronjs.org/docs/latest/api/safe-storage
- `ElectronSafeStorage.get()` returns `null` when encryption unavailable or decrypt fails; status should treat that as not configured and stay safe/off.

### Manual QA Protocol

1. Open Settings on a licensed app.
2. Save CapSolver and/or 2captcha API key; confirm field clears and status says configured.
3. Toggle CAPTCHA solver ON; confirm `phase3:settings:get { key: 'captcha.solver.enabled' }` returns `'true'`.
4. Restart app; confirm status still says configured and toggle reflects persisted flag.
5. Trigger Story 5.5 manual protocol with a checkpoint profile only after real provider key has credit.

### References

- [Source: _bmad-output/planning-artifacts/epics-phase3.md#Story-5.6] — AC source for user-facing CAPTCHA solver config.
- [Source: _bmad-output/planning-artifacts/architecture.md#ADR-P3-D16] — API key persistence, write-only IPC, status booleans.
- [Source: _bmad-output/implementation-artifacts/5-5-tu-giai-checkpoint-captcha.md] — completed solver key names, gate behavior, and review lessons.
- [Source: automation-desktop/project-context.md] — Electron IPC, safeStorage, no secret leak, Playwright-only testing rules.
- [Source: automation-desktop/CLAUDE.md] — adapter discipline, Zod 2-way IPC, ErrorEnvelope, async button, no direct secret logging rules.
- [Source: automation-desktop/src/main/adapters/electron-safe-storage.ts] — safeStorage adapter behavior.
- [Source: automation-desktop/src/main/ipc/settings-handlers.ts] — current IPC handler validation pattern.
- [Source: automation-desktop/src/renderer/src/views/ProxyView.tsx] — closest UI pattern for write-only API key save.
- [Source: Electron safeStorage docs: https://www.electronjs.org/docs/latest/api/safe-storage] — OS-backed encryption API reference.

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- 2026-06-04: Implemented write-only CAPTCHA IPC schema/handler and registered `phase3:captcha:set-key` + `phase3:captcha:status` in channel registry/bootstrap.
- 2026-06-04: Added Settings CAPTCHA solver UI with CapSolver/2captcha password fields, per-provider save buttons, configured booleans, and explicit OFF-by-default toggle.
- 2026-06-04: First focused E2E run failed because Electron launched stale `out/` build; ran `npm run build`, then focused E2E passed.
- 2026-06-04: Secret grep on `src out` found no raw `CAPSOLVER_SECRET`/`TWO_CAPTCHA_SECRET`; only expected storage key constants/API parameter names and pre-existing `console.warn` in `electron-bootstrap.ts`.

### Completion Notes List

- Added strict Zod request/response contracts for CAPTCHA key write and safe status; success responses reject unknown/secret echo fields.
- Added main IPC handler that trims and stores provider keys via `ElectronSafeStorage` only, returns `{ ok: true }`, and reports status booleans without key material.
- Wired handler into bootstrap without touching Story 5.5 checkpoint solver core; existing solver key names and feature flag remain the integration boundary.
- Added renderer Settings controls for write-only CapSolver/2captcha keys and `captcha.solver.enabled` feature flag. Saving keys does not auto-enable the solver.
- Added unit, integration, and E2E coverage for schema validation, write-only behavior, status booleans, UI field clearing, enabled flag persistence, and no-secret assertions.

### File List

- `automation-desktop/src/shared/ipc-schemas/captcha.ts`
- `automation-desktop/src/shared/ipc-schemas/index.ts`
- `automation-desktop/src/main/ipc/captcha-handlers.ts`
- `automation-desktop/src/main/ipc/index.ts`
- `automation-desktop/src/main/adapters/electron-bootstrap.ts`
- `automation-desktop/src/renderer/src/api/captcha-api.ts`
- `automation-desktop/src/renderer/src/App.tsx`
- `automation-desktop/src/renderer/src/assets/main.css`
- `automation-desktop/tests/integration/captcha-ipc-handlers.spec.ts`
- `automation-desktop/tests/unit/ipc-contracts.spec.ts`
- `automation-desktop/tests/e2e/profiles.spec.ts`

### Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-06-04 | 0.1 | Story created (bmad-create-story) — CAPTCHA solver API key settings + write-only IPC | Codex |
| 2026-06-04 | 1.0 | Implemented CAPTCHA solver API key settings, write-only IPC, Settings UI, and test coverage | Codex |
