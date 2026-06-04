# Story 12.4: C# Messenger Share-Link Parity

Status: ready-for-dev

Epic: 12 — Mass Messenger Seeding (Phase 3.4 Growth) · Story: 12.4 · ID: 12.4

> ⚠️ **SCOPE — ĐỌC TRƯỚC:** Story này tồn tại vì user yêu cầu port đúng 100% flow Messenger trong C# legacy. 12.2a/12.2b đã DONE nhưng là direct-DM redesign (`/messages/t/{uid}`), KHÔNG phải parity với `SST_TOOL_FB/Main.cs`. Story này phải thêm **C# parity mode** mà không phá direct-DM mode hiện có.

## Story

As a user migrating from the legacy `SST_TOOL_FB` C# tool,
I want Messenger seeding to support the exact legacy share-link Messenger workflow,
So that existing operators can run the same campaign pattern, input files/settings, stop conditions, and blocking behavior in the Phase 3 desktop app.

## Acceptance Criteria

1. **Parity mode entrypoint, không phá direct-DM 12.2**
   - Add explicit Messenger mode, e.g. `mode: 'direct_dm' | 'csharp_share_link'`, to IPC/UI/orchestrator surface.
   - Existing 12.2 direct-DM path must remain unchanged and regression tests must still pass.
   - C# parity mode must be selected deliberately in UI; default may remain direct-DM unless UX chooses otherwise.

2. **Legacy inputs mapped 1:1**
   - Target input supports legacy `uid.txt` semantics: one target/page UID per line, processed in order with no silent reordering inside a profile slice.
   - Message content supports legacy `txtnoidung.txt`: multiline text is typed line-by-line; line breaks are sent with `Shift+Enter` between lines.
   - Random content supports legacy `checkBox1`: when enabled, split message source by `**`, remove empty segments, choose one segment with injected `rng` per send.
   - Share link source supports legacy `txtlinkss.txt`: one link per line; choose a random non-empty link with injected `rng` per target.
   - Config supports `numberRun` equivalent, `delaySeconds` equivalent, `stopAfterErrorEnabled`, and `stopAfterErrorCount` equivalent.
   - UI may provide paste textareas instead of literal filesystem files, but behavior must match the file contents exactly.

3. **Facebook token extraction parity**
   - Before per-target loop, extract the same web tokens C# reads from Facebook HTML: `fb_dtsg`, `lsd`, `jazoest`, `hsi`, `__spin_r`, `__spin_t`.
   - Reuse/extend `createTokenExtractor`; do not duplicate brittle regex parsing in multiple places.
   - Missing required token must fail the profile with reason `TOKEN_MISSING` and must not leak token values in result/log/IPC.

4. **GraphQL business CTA mutation parity**
   - For each target UID/page ID, call `https://www.facebook.com/api/graphql/` with friendly name `MWChatBusinessCTAAdsSenderMutation` before opening the share link.
   - Request body must include the legacy semantic fields: actor/profile uid, target `page_id`, `fb_dtsg`, `jazoest`, `lsd`, `__spin_r`, `__spin_t`, and variables `{ input: { page_id, actor_id, client_mutation_id } }`.
   - Treat response containing `messenger_business_ads_sender":"` as success gate, matching C#.
   - If the gate fails, increment per-profile error count, record target outcome `error` with reason `BUSINESS_CTA_FAILED`, and continue/stop according to error-limit settings.
   - Implement GraphQL through an injected adapter/client so unit tests can fake response bodies without real Facebook/network.

5. **Share-link Messenger selector fallback parity**
   - After GraphQL gate success, navigate to a random share link.
   - Click share using the same fallback strategy family as C#: primary dialog share button (`div[data-ad-rendering-role='share_button']`), legacy XPath fallback, parent XPath fallback.
   - Then click Messenger/send-to-Messenger using fallback strategy family: legacy XPath, `div[role='button'][aria-label*='Messenger']`, dialog-scoped Messenger buttons, and `More share options` fallback.
   - Track clicked `aria-label` values per profile to avoid duplicate Messenger targets; duplicate label increments error count, as C# does.
   - Fallback selectors must be bundled and clearly marked fragile for Epic 5 4-tier selector resolver.

6. **Message typing and send parity**
   - Focus the contenteditable composer equivalent to C# `div[contenteditable="true"][style*="font-size: 15px"]`.
   - Remove surrogate pairs from each message line before typing, matching C# `Regex.Replace(line, @"\p{Cs}", "")`.
   - Type each line through keyboard input; use `Shift+Enter` between lines, not simple textarea fill.
   - Send using legacy primary XPath fallback and JS icon fallback (`i[data-visualcompletion="css-img"]` last icon → closest `div[role="button"]`).
   - After send, detect `span:has-text("Couldn't send")`; if present, mark target/profile reason `BLOCKED_COULDNT_SEND` and stop that profile.

7. **Stop conditions and status parity**
   - Check logout markers equivalent to C# `type="password"` and `{"token":"NA` before/inside loop; map to `LOGIN_FAILED`/`OUT_LOGIN` and stop profile.
   - Check URL contains `checkpoint`; transition profile to `CHECKPOINT_BLOCKED`, include processed UID list count but do not serialize target list contents into `automation_jobs.result`.
   - Implement `stopAfterErrorEnabled` + `stopAfterErrorCount`; when error count reaches threshold, stop profile with reason `ERROR_LIMIT_REACHED`.
   - Implement per-target statuses: `success`, `error`, `checkpoint`, plus reasons `BUSINESS_CTA_FAILED`, `MESSENGER_CLICK_FAILED`, `SEND_FAILED`, `BLOCKED_COULDNT_SEND`, `TOKEN_MISSING`, `ERROR_LIMIT_REACHED`.

8. **Backend action token accepts message**
   - Backend action-token policy must accept `action_type='message'` in addition to existing tier-2 actions.
   - Add backend test proving `/api/v1/automation/action/token` issues and consumes a token with `action_type: "message"`.
   - Desktop real-run path must no longer be blocked by the current “comment-only effectively supported” risk noted in 12.2b.

9. **Recording, secret hygiene, and compatibility**
   - Each target attempt records one `job_actions` row with `actionType: 'message'`, target UID/page ID, outcome, and actionTokenJti if issued.
   - `automation_jobs.result`, IPC responses, UI state, logs, and tests must not leak cookie, password, 2FA, `fb_dtsg`, `lsd`, `jazoest`, action token, message body, rendered body, or GraphQL raw body.
   - Status IPC remains `{ jobId, state, sent, total, reason? }`; if additional per-target detail is needed, add a safe separate API or keep it local to tests, but do not leak secrets.

10. **Tests prove parity, not only happy path**
    - Unit tests for pure content parsing: legacy `**` random segment, multiline split, surrogate removal, empty-line trimming for target/link lists.
    - Unit tests for GraphQL adapter/body builder: includes required semantic fields and redacts secrets in thrown errors.
    - Unit tests for share-link executor: selector fallback order, duplicate aria-label handling, `More share options` fallback, `Couldn't send` stop.
    - Orchestrator tests: GraphQL fail increments error, error limit stops, checkpoint stops, logout stops, success records action and delays.
    - IPC integration tests: start with `mode:'csharp_share_link'`, invalid missing links/content rejected with Vietnamese `VALIDATION_ERROR`, direct-DM mode still accepted.
    - E2E stub test: choose parity mode, paste UID/link/content, enable random content, set delay/error limit, trigger, observe progress. Stub must not launch real Facebook/Chromium network.

## Tasks / Subtasks

### Planning and contracts
- [ ] **T1** — Extend shared Messenger IPC schemas with explicit mode and parity inputs: targets, shareLinks, contentText, randomContent, delaySeconds, stopAfterErrorEnabled, stopAfterErrorCount. Keep direct-DM request backward compatible. (AC1/AC2/AC10)
- [ ] **T2** — Add/extend types in `src/main/automation/` for `MessengerSeedMode`, `CsharpShareLinkTarget`, `CsharpShareLinkConfig`, per-target reasons, and safe result metadata. (AC1/AC7/AC9)

### Legacy content/input parser
- [ ] **T3** — Create pure parser helpers for legacy target/link/content behavior; use structured functions instead of ad hoc string handling inside React or orchestrator. (AC2/AC6/AC10)
- [ ] **T4** — Unit tests for target/link trimming, random `**` segment selection via injected rng, multiline `Shift+Enter` line model, and surrogate removal. (AC2/AC6/AC10)

### Token and GraphQL parity
- [ ] **T5** — Extend `token-extractor.ts` to return `hsi`, `spinR`, `spinT` in addition to `fbDtsg`, `lsd`, `jazoest`; keep existing self-comment behavior compatible. (AC3)
- [ ] **T6** — Implement injected GraphQL business CTA adapter/client under `src/main/automation/` or adjacent messenger module. It must build the `MWChatBusinessCTAAdsSenderMutation` request and detect `messenger_business_ads_sender` success. (AC4)
- [ ] **T7** — Add tests for token extraction and GraphQL adapter/body builder, including missing token and no-secret error behavior. (AC3/AC4/AC9/AC10)

### Share-link executor parity
- [ ] **T8** — Add a new executor such as `messenger-share-link-executor.ts` instead of overloading `executeMessengerSeed` beyond clarity. It owns share-click, Messenger fallback, message typing, send, and `Couldn't send` detection. (AC5/AC6)
- [ ] **T9** — Include bundled fragile selector set with comments pointing to Epic 5; preserve fallback order from C# and expose injection for tests. (AC5/AC10)
- [ ] **T10** — Unit tests for fallback click paths, duplicate aria-label increments, `More share options`, send XPath fallback, JS icon fallback, and `Couldn't send`. (AC5/AC6/AC7/AC10)

### Orchestrator and batch integration
- [ ] **T11** — Extend/create orchestrator path for `mode:'csharp_share_link'`: login, token extraction, per-target GraphQL gate, random share link, share-link executor, record action, delay, stop conditions. (AC1/AC3-AC7/AC9)
- [ ] **T12** — Preserve `runMessengerSeedBatch` profile isolation and round-robin. Do not regress no-profile, checkpoint aggregate, missing job status fixes from 12.2a/12.2b. (AC1/AC7)
- [ ] **T13** — Orchestrator tests for GraphQL fail, error limit, checkpoint URL, logout HTML, `Couldn't send`, success, delay, record action, and safe result JSON. (AC7/AC9/AC10)

### Backend action token
- [ ] **T14** — Patch backend `TIER2_ACTIONS` or equivalent action policy to accept `message`; add backend tests for issue/consume `message` token. (AC8)
- [ ] **T15** — Ensure desktop tests using real `ActionTokenClient` fake server include `action_type: 'message'`. (AC8)

### UI and IPC surface
- [ ] **T16** — Update `MessengerSeedingView` with parity mode controls: mode selector, share links input, content input, random content toggle, delay seconds, stop-after-error controls. Existing direct-DM UI remains usable. (AC1/AC2)
- [ ] **T17** — Update `messenger-api.ts`, `messenger-handlers.ts`, and bootstrap stub to pass parity config into orchestrator and provide deterministic stub progress for E2E. (AC1/AC10)
- [ ] **T18** — Integration + E2E tests for parity mode validation and stub flow. (AC10)

### Verification
- [ ] **V** — Run targeted tests: messenger unit/integration/e2e, backend action-token tests, `npm run typecheck`, `npm run lint`, and relevant backend pytest. No `test.fixme`. Document all commands in Dev Agent Record.

## Dev Notes

### Critical Intent

- User explicitly requested **port đúng 100%** from C# legacy. Do not reinterpret this as “improve direct-DM flow”. Implement a parity mode matching observable C# behavior.
- Current 12.2 direct-DM mode is valid but not parity. Keep it as an existing mode and add parity mode.
- “100%” here means behavior-level parity while still obeying Phase 3 security rules: no secret leaks, DI for tests, no raw Electron imports in domain logic, no silent test placeholders.

### C# Source Behavior To Port

- Token extraction from Facebook HTML: `fb_dtsg`, `lsd`, `jazoest`, `hsi`, `__spin_t`, `__spin_r` are parsed before loop. [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:217-248]
- Loop count comes from `nudNumber`; error count `loi`; processed targets `danhSachUID`. [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:480-492]
- Stop conditions: page URL contains `checkpoint`; `cbxError` + `nudError` stops when `loi == error`; `dunglai` stops manually. [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:495-519]
- Logout checks: page content contains `type="password"`; logged-in marker contains `{"token":"NA`. [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:522-539]
- Target/page UID source is `uid.txt`; first non-empty line is consumed and file rewritten. In Phase 3 UI/DB may replace file mutation, but order and content semantics must match. [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:540-555]
- GraphQL gate uses `MWChatBusinessCTAAdsSenderMutation`, `x-fb-lsd`, `fb_dtsg`, `jazoest`, `lsd`, `__spin_r`, `__spin_t`, `page_id`, `actor_id`, and checks response contains `messenger_business_ads_sender":"`. [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:559-581]
- Share link source is `txtlinkss.txt`; random line selected before navigating. [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:586-593]
- Share/Messenger fallbacks include dialog share button, legacy XPath, parent XPath, Messenger aria-label button, dialog-scoped Messenger buttons, and `More share options`. [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:595-740]
- Duplicate Messenger `aria-label` values are tracked in `clickedList`; duplicates increment `loi`. [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:658-690,706-738]
- Message content source is `txtnoidung.txt`; random mode splits by `**`; multiline typing uses keyboard and `Shift+Enter`; surrogate pairs are removed. [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:745-770,829-835]
- Send fallbacks: legacy XPath, then JS clicking closest role button from last `i[data-visualcompletion="css-img"]`. [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:771-785]
- After send, increment OK, delay `nudDelayss` seconds, detect `Couldn't send`, mark blocked, stop profile, then `Escape`. [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:787-797]

### Current TypeScript State To Preserve

- Existing direct-DM executor fills Messenger composer and sends directly. Do not delete or repurpose it into share-link parity if that makes direct-DM tests ambiguous. [Source: `automation-desktop/src/main/automation/messenger-seed-executor.ts`]
- Existing orchestrator navigates to `https://www.facebook.com/messages/t/{uid}` and records actions. Add mode branching or a separate orchestrator helper, but preserve direct-DM behavior. [Source: `automation-desktop/src/main/automation/messenger-seed-orchestrator.ts`]
- Existing batch coordinator does profile round-robin and isolation. Reuse it. [Source: `automation-desktop/src/main/automation/messenger-seed-batch.ts`]
- Existing bootstrap wires `createMessengerSeedOrchestrator` and `PHASE3_AUTOMATION_STUB=1` stub. Extend stub to cover parity mode deterministically. [Source: `automation-desktop/src/main/adapters/electron-bootstrap.ts`:431-456]
- Existing Messenger UI parses `uid` / `uid|name`. Add parity controls without removing current trigger. [Source: `automation-desktop/src/renderer/src/views/MessengerSeedingView.tsx`]

### Backend Action Token Context

- Desktop already sends `action_type: request.actionType` to `/api/v1/automation/action/token`. [Source: `automation-desktop/src/main/license/action-token-client.ts`:83-90]
- Backend currently defines tier-2 actions without `message`: `post`, `comment`, `react`, `share`, `friend`. Add `message`. [Source: `backend/app/services/automation/action_token.py`:17]
- Backend tests currently cover `comment` and invalid `view`; add `message` issue/consume tests. [Source: `backend/tests/automation/test_automation_action_token.py`]

### Architecture And Security Guardrails

- Domain logic under `automation-desktop/src/main/automation/` must not import `electron`.
- Renderer must not import main-process modules; shared schemas/types belong in `src/shared`.
- IPC handlers must safeParse request and `.parse()` response with Vietnamese ErrorEnvelope messages and mandatory `retryable`.
- Do not log raw GraphQL request bodies, cookies, tokens, 2FA, passwords, or message content. Use safe reason codes.
- Do not add `test.fixme`; all verify tasks must pass.
- Keep tests fake/DI-based for Facebook behavior. Do not require real Facebook network in CI.

### Recommended File Changes

| File | Action | Notes |
|---|---|---|
| `automation-desktop/src/shared/ipc-schemas/messenger.ts` | UPDATE | Add parity mode request shape and validation. |
| `automation-desktop/src/main/automation/token-extractor.ts` | UPDATE | Add `hsi`, `spinR`, `spinT` extraction. |
| `automation-desktop/src/main/automation/messenger-share-link-executor.ts` | NEW | C# share-link selector/typing/send executor. |
| `automation-desktop/src/main/automation/messenger-business-cta.ts` | NEW | GraphQL body/client adapter for `MWChatBusinessCTAAdsSenderMutation`. |
| `automation-desktop/src/main/automation/messenger-legacy-input.ts` | NEW | Pure parsing/random/surrogate helpers. |
| `automation-desktop/src/main/automation/messenger-seed-orchestrator.ts` | UPDATE | Branch by mode or delegate parity flow. |
| `automation-desktop/src/main/ipc/messenger-handlers.ts` | UPDATE | Validate/pass parity config; keep direct-DM compatible. |
| `automation-desktop/src/renderer/src/views/MessengerSeedingView.tsx` | UPDATE | Add parity mode controls/states. |
| `automation-desktop/src/main/adapters/electron-bootstrap.ts` | UPDATE | Wire GraphQL/share-link deps and stub parity mode. |
| `backend/app/services/automation/action_token.py` | UPDATE | Add `message` to allowed tier-2 actions. |
| Tests under `automation-desktop/tests/unit`, `tests/integration`, `tests/e2e` | NEW/UPDATE | Parity coverage. |
| `backend/tests/automation/test_automation_action_token.py` | UPDATE | `message` action token coverage. |

### Testing Commands

- `cd automation-desktop && npx playwright test tests/unit/messenger-seed-executor.spec.ts tests/unit/messenger-seed-orchestrator.spec.ts tests/unit/messenger-seed-batch.spec.ts tests/integration/messenger-ipc-handlers.spec.ts tests/e2e/messenger-seeding.spec.ts --reporter=line`
- `cd automation-desktop && npm run typecheck`
- `cd automation-desktop && npm run lint`
- `cd backend && pytest tests/automation/test_automation_action_token.py -q`

### Previous Story Intelligence

- 12.2a review already fixed invalid terminal transitions, parseable checkpoint selector, draft-safe readback, checkpoint aggregate, and no-profile batch failure accounting. Do not regress these.
- 12.2b review already fixed duplicate profileIds validation and missing job status returning terminal `JOB_NOT_FOUND`. Do not regress these.
- 12.1 deferred placeholder robustness remains separate; parity mode should support current exact `{uid}`/`{name}` rendering only if it uses content templates. Legacy text randomization by `**` is required here.

### Project Structure Notes

- This story spans desktop and backend. Keep desktop automation pure/DI-driven; keep backend patch narrow to allowed action type and tests.
- Direct C# magic strings/selectors are intentionally preserved as parity selectors, but they must be isolated in a single bundled selector/config module so Epic 5 can replace them later.
- Do not make GraphQL mutation body construction a string-concatenation mess like C# if structured URLSearchParams can preserve the same fields safely. The semantic fields and success gate must match C#.

## References

- [Source: `_bmad-output/planning-artifacts/epics-phase3.md#Story-12.4`] — new C# parity story added from user request.
- [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:217-248] — legacy web token extraction.
- [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:480-581] — legacy per-profile loop, target consumption, GraphQL gate.
- [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:586-740] — legacy share link and Messenger fallback selectors.
- [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:745-797] — legacy content randomization, typing, send, delay, blocked detection.
- [Source: `automation-facebook/SST_TOOL_FB/Main.cs`:829-835] — legacy `**` segment split helper.
- [Source: `automation-desktop/project-context.md`] — Phase 3 Electron, IPC, security, testing rules.
- [Source: `automation-desktop/src/main/automation/messenger-seed-orchestrator.ts`] — existing direct-DM path to preserve.
- [Source: `automation-desktop/src/renderer/src/views/MessengerSeedingView.tsx`] — existing Messenger UI to extend.
- [Source: `backend/app/services/automation/action_token.py`] — backend action token allow-list to update.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
