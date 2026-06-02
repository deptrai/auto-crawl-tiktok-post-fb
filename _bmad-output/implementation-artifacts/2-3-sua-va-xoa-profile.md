# Story 2.3: Sửa và xóa profile

Status: review

<!-- Phase 3 story (Epic 2 — Profile Management, story cuối 3/3). Sources: epics-phase3.md#Story-2.3 (L296-308), prd-phase3.md#FR2 (L342), architecture.md (DB schema L1399-1401 CASCADE, R-D3 secret hygiene). ⚠️ automation-desktop/ (Electron client) — 25 rules CLAUDE.md ÁP DỤNG. Previous: 2.1 done (8 patch + cookie-export), 2.2 done (list+polling, 3 patch). -->

## Story

As a user (affiliate marketer như Minh),
I want sửa tên hiển thị của profile và xóa hẳn profile không dùng nữa,
so that tôi quản lý vòng đời tài khoản, và khi xóa thì cookie + dữ liệu nhạy cảm bị xóa SẠCH khỏi máy (không để rò rỉ).

> ⚠️ **PHẠM VI**: Story này ở **`automation-desktop/`** (Electron client). `automation-desktop/CLAUDE.md` (25 rules) + R-D3 ÁP DỤNG. Story 2.3 = **sửa displayName + xóa profile với cleanup đầy đủ** (FR2). Import (FR1+FR4)=2.1 done; list real-time (FR3)=2.2 done. Sửa proxy/fingerprint metadata = defer (Epic 3/4 mới có giá trị/UI).

## Acceptance Criteria

1. **IPC `phase3:profile:update`** (sửa): Request `{ id: string(min1), displayName: string(min1) }` (Zod). Cập nhật `profiles.display_name`. **KHÔNG sửa `uid`** (immutable — định danh FB gắn với cookie). **KHÔNG chạm secret/safeStorage**. Response `{ ok:true, profile: ProfileSummary }` (đã cập nhật, KHÔNG secret). `id` không tồn tại → ErrorEnvelope `PROFILE_NOT_FOUND` (retryable:false) message tiếng Việt. Zod validate 2 chiều + đăng ký `channelRegistry` (rule #7,#8,#9; preload throw nếu thiếu registry).
2. **IPC `phase3:profile:delete`** (xóa + cleanup đầy đủ): Request `{ id: string(min1) }`. Cleanup: (a) xóa 4 secret key `profile.<id>.cookie/.twofa/.fb_password/.mail_password` khỏi safeStorage; (b) xóa row `profiles` → FK `ON DELETE CASCADE` tự xóa `profile_metadata`. Response `{ ok:true }`. Lỗi → ErrorEnvelope VN. Zod 2-way + registry. **Idempotent**: `id` không tồn tại → vẫn `ok:true` (xóa cái không có = thành công).
3. **Thứ tự delete (R-D3 security-critical)**: Xóa secrets **TRƯỚC**, xóa DB row **SAU**, và CHỈ xóa row khi tất cả secret delete thành công. Nếu BẤT KỲ secret delete nào fail → **abort, throw ErrorEnvelope retryable, KHÔNG xóa row** (profile giữ nguyên → user retry). Lý do: success phải đảm bảo cookie/2fa đã biến mất khỏi máy (đúng intent bảo mật); KHÔNG để trạng thái "row đã xóa nhưng cookie còn" (orphan secret rò rỉ). `safeStorage.delete` đã idempotent (xóa key không tồn tại = no-op) nên xóa cả 4 key an toàn dù profile chỉ có vài key.
4. **ProfileService methods**: `updateProfile(id, { displayName }): ProfileSummary` — verify tồn tại (`repo.updateDisplayName` trả `changes===0` → throw `ProfileServiceError('PROFILE_NOT_FOUND', ..., false)`), apply, trả summary đã cập nhật (`repo.getProfileById` → map). `deleteProfile(id): void` — secrets-first-then-row (AC3). **KHÔNG log/return secret value** (chỉ delete theo key). Tên method KHÔNG trùng repo.deleteProfile (service wrap repo).
5. **profile-repo mở rộng**: thêm `updateDisplayName(id, displayName): number` (UPDATE profiles SET display_name=? WHERE id=?; trả `info.changes` để detect not-found), `getProfileById(id): ProfileRow | undefined` (SELECT ... WHERE id=?). `deleteProfile(id)` ĐÃ CÓ (DELETE FROM profiles WHERE id, CASCADE xóa metadata) — **REUSE, không viết lại**. Prepared statements.
6. **ProfilesView — action Sửa/Xóa mỗi row**: Mỗi row danh sách (2.2) thêm nút "Sửa" + "Xóa". **Sửa** → inline edit form (input displayName pre-fill từ `row.displayName`, KHÔNG field secret) + "Lưu"/"Hủy" → call update → `refreshProfiles` (2.2 coalesced). **Xóa** → **confirm 2 bước inline** (hiện "Xóa profile <uid>? Cookie + dữ liệu sẽ bị xóa vĩnh viễn." + nút [Xóa]/[Hủy], `data-testid` riêng) → call delete → `refreshProfiles`. KHÔNG dùng `window.confirm` (khó e2e + block). Nút disable khi đang xử lý (rule #17). Hardcode tiếng Việt.
7. **Error/loading**: update/delete lỗi → message tiếng Việt, KHÔNG crash, giữ list. Đang xử lý → disable nút + indicator. KHÔNG hiển thị secret ở bất kỳ đâu (edit form chỉ có displayName).

## Tasks / Subtasks

### Main process (Electron — TypeScript)

- [x] **Task 1: Schema + 2 channel** (AC: #1,#2)
  - [x] `src/shared/ipc-schemas/profile.ts`: thêm `ProfileUpdateRequestSchema = z.object({ id: z.string().min(1), displayName: z.string().min(1) })`, `ProfileUpdateSuccessResponseSchema = z.object({ ok: z.literal(true), profile: ProfileSummarySchema })`, `ProfileUpdateResponseSchema = union([success, IpcErrorResponseSchema])`; `ProfileDeleteRequestSchema = z.object({ id: z.string().min(1) })`, `ProfileDeleteSuccessResponseSchema = z.object({ ok: z.literal(true) })`, `ProfileDeleteResponseSchema = union([success, IpcErrorResponseSchema])` + export types. GIỮ NGUYÊN schema 2.1/2.2.
  - [x] `src/shared/ipc-schemas/index.ts`: thêm 2 entry `phase3:profile:update` + `phase3:profile:delete` vào `channelRegistry` + import.
- [x] **Task 2: profile-repo mở rộng** (AC: #5)
  - [x] `src/main/db/repositories/profile-repo.ts`: thêm vào interface + impl: `updateDisplayName(id, displayName): number` (prepared UPDATE, trả `.changes`), `getProfileById(id): ProfileRow | undefined` (prepared SELECT). `deleteProfile` reuse.
- [x] **Task 3: ProfileService update + delete** (AC: #1,#2,#3,#4)
  - [x] `src/main/profile/profile-service.ts`: thêm vào interface `ProfileService`: `updateProfile(id: string, fields: { displayName: string }): ProfileSummary` + `deleteProfile(id: string): Promise<void>`. Impl: update verify-not-found→throw; delete secrets-first (loop 4 field, `await storage.delete(secretKey(id,field))`, gom lỗi → nếu có → throw `ProfileServiceError('PROFILE_DELETE_FAILED','Không thể xóa dữ liệu nhạy cảm của profile. Vui lòng thử lại.', true)` KHÔNG xóa row) → `repo.deleteProfile(id)`. Reuse `secretKey` helper sẵn có.
- [x] **Task 4: IPC handlers** (AC: #1,#2)
  - [x] `src/main/ipc/profile-handlers.ts`: trong `registerProfileHandlers` thêm 2 `ipcMain.handle` cho update + delete: safeParse request → `parseError`; `try { ... ResponseSchema.parse(...) } catch { normalizeError }`. Reuse `toErrorResponse`/`parseError`/`normalizeError`. `registerProfileHandlers(ipcMain, service)` — KHÔNG đổi param.
- [x] **Task 5: Bootstrap** (AC: #1,#2)
  - [x] `electron-bootstrap.ts`: **KHÔNG cần đổi** (handlers chạy cùng `registerProfileHandlers`). Verify đăng ký.
- [x] **Task 6: Renderer API** (AC: #6)
  - [x] `src/renderer/src/api/profile-api.ts`: thêm `updateProfile(id, displayName): Promise<ProfileSummary>` + `deleteProfile(id): Promise<void>` (gọi `window.api.ipc.call` + `assertOk`). Reuse `assertOk`.
- [x] **Task 7: ProfilesView actions** (AC: #6,#7)
  - [x] `ProfilesView.tsx`: thêm per-row state (editingId, confirmDeleteId, rowBusy). Nút Sửa→inline edit displayName + Lưu/Hủy; nút Xóa→confirm inline + Xóa/Hủy. Handlers gọi update/delete API rồi `refreshProfiles(false)`. Disable khi busy (rule #17). testid: `profile-edit-<uid>`, `profile-delete-<uid>`, `profile-edit-input-<uid>`, `profile-edit-save-<uid>`, `profile-delete-confirm-<uid>`. KHÔNG đụng khu import.
- [x] **Task 8: Tests** (AC: tất cả)
  - [x] Unit `tests/unit/profile-service.spec.ts` (thêm): `updateProfile` đổi displayName + trả summary; update id không tồn tại → throw PROFILE_NOT_FOUND; **`deleteProfile` xóa CẢ 4 secret key + gọi repo.deleteProfile** (verify fake storage.delete nhận đủ 4 key); **delete secret-fail → throw + repo.deleteProfile KHÔNG được gọi** (row giữ); delete id không tồn tại → vẫn resolve (idempotent); KHÔNG log secret.
  - [x] Integration `tests/integration/profile-ipc-handlers.spec.ts` (thêm, FakeIpcMain): update Zod 2-way + PROFILE_NOT_FOUND ErrorEnvelope; delete Zod 2-way + ok; response không secret.
  - [x] Integration real SQLCipher: mở rộng `runProfileRepoSmoke` (electron-bootstrap, `PHASE3_PROFILE_REPO_SMOKE`) — sau insert: `updateDisplayName` đổi tên + `getProfileById` xác nhận; delete → `profile_metadata` của profile đó bị CASCADE xóa (đã có sẵn check cascade ở 2.1 smoke — verify lại).
  - [x] E2E `tests/e2e/profiles.spec.ts` (thêm): import 1 profile → Sửa displayName → list hiển thị tên mới; Xóa (confirm) → row biến mất + empty state. Reuse `launchWithActiveLicense`/`closeServer`/`setTextareaValue`.
  - [x] `typecheck` PASS, `lint` 0 errors, toàn bộ test 2.1/2.2 vẫn xanh.

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules)
- **R-D3 / Rule #10,#11**: delete PHẢI xóa cookie/2fa/password khỏi safeStorage; KHÔNG log secret value; update KHÔNG chạm secret.
- **Rule #7,#8,#9**: IPC Zod 2 chiều + ErrorEnvelope có `retryable` + KHÔNG throw raw Error qua boundary.
- **Rule #15**: ErrorEnvelope `message` tiếng Việt; `code` SCREAMING_SNAKE.
- **Rule #16,#17**: loading testid riêng + disable nút async ngay khi click.
- **Rule #14**: Zod non-optional string `.min(1)`.
- **Rule #5**: try/catch quanh I/O (safeStorage, DB).

### ⚠️ Delete cleanup — thiết kế chính xác (AC2,AC3)
```
async deleteProfile(id):
  const fields = ['cookie','twofa','fb_password','mail_password'] as const
  let secretErr: unknown = null
  for (const f of fields) {
    try { await storage.delete(secretKey(id, f)) } catch (e) { secretErr = e }  // idempotent
  }
  if (secretErr) throw new ProfileServiceError('PROFILE_DELETE_FAILED',
    'Không thể xóa dữ liệu nhạy cảm của profile. Vui lòng thử lại.', true)  // ROW NOT deleted → retryable
  repo.deleteProfile(id)  // sync; CASCADE xóa profile_metadata
```
- **secrets-first** vì: success ⟹ cookie/2fa đã gone (đúng intent bảo mật xóa). DB-first sẽ tạo nguy cơ "row đã xóa nhưng cookie còn trong safeStorage" (orphan rò rỉ) nếu secret delete fail.
- `safeStorage.delete(key)` idempotent (`delete store[key]` + atomic write) → xóa cả 4 key dù profile chỉ có cookie là an toàn. [Source: src/main/adapters/electron-safe-storage.ts:38-42]
- Retry-safe: nếu secret-fail giữ row → user retry; nếu repo.deleteProfile fail sau khi secrets đã xóa → retry: secret delete no-op (idempotent) + row delete lại. Không kẹt.

### ⚠️ automation_jobs cleanup — DEFER Epic 4
- AC epic gốc nhắc "automation_jobs liên quan đều bị xóa". **Bảng `automation_jobs` CHƯA tồn tại** (Epic 4). [Source: src/main/db/client.ts — chỉ có profiles + profile_metadata]
- → 2.3 cleanup = secrets + profiles row (CASCADE metadata). **Forward-guidance ghi `deferred-work.md`**: khi Epic 4 tạo `automation_jobs`, NÊN khai báo FK `profile_id ... REFERENCES profiles(id) ON DELETE CASCADE` để delete của 2.3 tự động dọn jobs (giống profile_metadata). Nếu không CASCADE → phải bổ sung xóa jobs vào `deleteProfile` service.

### DB hiện trạng (đã khảo sát)
- `profiles(id PK, uid UNIQUE NOT NULL, display_name NOT NULL, status DEFAULT 'idle', created_at)` + `profile_metadata(profile_id FK ON DELETE CASCADE, key, value, PK(profile_id,key))` + `foreign_keys = ON`. [Source: src/main/db/client.ts:22-41]
- `profile-repo`: `uidExists`, `insertProfileAtomic`, `deleteProfile` (DELETE WHERE id — CASCADE), `listProfiles`, `countProfiles`. **Thiếu** `updateDisplayName`/`getProfileById` → thêm (Task 2). `ProfileRow = {id,uid,displayName,status,createdAt}`. [Source: src/main/db/repositories/profile-repo.ts]
- `SecureStorage { get/set/delete }` — delete idempotent crash-safe. `secretKey(id,field)` = `profile.<id>.<field>` (helper private trong profile-service). [Source: src/adapters/secure-storage.ts, src/main/profile/profile-service.ts]

### IPC + renderer (đã khảo sát)
- `ProfileSummary` single-source = Zod-inferred ở `shared/ipc-schemas/profile.ts` (2.2 patch P3 — service import từ shared). Update response trả ProfileSummary. [Source: src/shared/ipc-schemas/profile.ts]
- Handler pattern: `registerProfileHandlers(ipcMain, service)` + helpers `toErrorResponse`/`parseError`/`normalizeError` (unknown→retryable:false, 2.1 P1). [Source: src/main/ipc/profile-handlers.ts]
- channelRegistry: mỗi channel mới PHẢI thêm entry (preload throw `Unregistered IPC channel` nếu thiếu). [Source: src/shared/ipc-schemas/index.ts, src/preload/index.ts:45-48]
- `assertOk` + `window.api.ipc.call` ở `profile-api.ts`. [Source: src/renderer/src/api/profile-api.ts]
- `ProfilesView` đã có list + `refreshProfiles(initialLoad)` coalesced (2.2 P2: pending-refresh ref) + polling + status badge. Update/delete xong → gọi `refreshProfiles(false)` (đừng tự viết refetch mới). [Source: src/renderer/src/views/ProfilesView.tsx]

### Previous story intelligence (2.1, 2.2)
- 2.1: `brandSecret`/`revealSecret`, atomicity cleanup per-profile, `normalizeError` unknown→retryable:false, `secretKey` convention, e2e helpers `launchWithActiveLicense`/`closeServer`/`setTextareaValue`, `FakeIpcMain` integration, real-DB smoke `PHASE3_PROFILE_REPO_SMOKE` (electron-bootstrap), `.phase3-manual/` gitignored (KHÔNG commit secret), DF1 orphan-cleanup defer.
- 2.2: `ProfileSummary` single-source shared; list+polling; `refreshProfiles` coalesced (pending-refresh); empty-state gate `!listError`; status tolerant string + badge map; channelRegistry mandatory.
- ⚠️ KHÔNG commit `.phase3-manual/` (bài học 2.1 R2 — check `git diff --cached --name-only | grep -iE "phase3-manual|secure-storage|\.db$"` rỗng trước commit).

### Edge cases cần xử lý
- update id không tồn tại → PROFILE_NOT_FOUND (không crash).
- delete id không tồn tại → ok:true (idempotent), vẫn gọi 4 storage.delete (no-op).
- delete secret-delete fail (disk/permission) → throw retryable, row giữ nguyên (không zombie row-without-cookie).
- displayName rỗng/whitespace → Zod `.min(1)` chặn (trim ở renderer trước khi gửi nếu cần).
- Sửa/xóa đang chạy + poll 5s đồng thời → `refreshProfiles` coalesced (2.2) xử lý; nút disable tránh double-action.
- Xóa nhầm → confirm 2 bước inline bắt buộc (không xóa 1-click).
- Response update/delete KHÔNG chứa secret (update chỉ ProfileSummary; delete chỉ ok).
- uid KHÔNG sửa được (không có field uid trong update request).

### Scope — KHÔNG làm
- KHÔNG sửa proxy/fingerprint metadata (Epic 3/4 — chưa có giá trị/UI; `profile_metadata` infra sẵn nhưng 2.3 chỉ sửa displayName).
- KHÔNG sửa `uid` (immutable).
- KHÔNG implement automation_jobs cleanup (Epic 4 — defer, xem note).
- KHÔNG bulk-delete/bulk-edit (single profile; bulk = future).
- KHÔNG đụng luồng import (2.1) / list+polling core (2.2) — chỉ thêm action + reuse refresh.
- KHÔNG thêm `phase3:profile:get` (edit displayName pre-fill từ list data sẵn có; email/metadata edit defer).
- KHÔNG đụng `backend/`/`frontend/`.

### References
- [Source: epics-phase3.md#Story-2.3 (L296-308)] — AC gốc (sửa metadata, xóa cleanup đầy đủ)
- [Source: prd-phase3.md#FR2 (L342)] — xem/sửa/xóa profile + metadata
- [Source: architecture.md#L1399-1401] — DB schema profiles/profile_metadata/automation_jobs; #R-D3 secret hygiene
- [Source: src/main/db/client.ts:22-41] — schema + CASCADE + foreign_keys ON
- [Source: src/main/db/repositories/profile-repo.ts] — repo methods (deleteProfile reuse)
- [Source: src/main/adapters/electron-safe-storage.ts:38-42] — delete idempotent
- [Source: src/main/profile/profile-service.ts] — secretKey, ProfileService, ProfileServiceError
- [Source: src/main/ipc/profile-handlers.ts] — handler + helpers
- [Source: src/shared/ipc-schemas/profile.ts, index.ts] — schemas + registry
- [Source: src/renderer/src/views/ProfilesView.tsx, api/profile-api.ts] — list + refreshProfiles + assertOk
- [Source: automation-desktop/CLAUDE.md (25 rules)], [Source: 2-1-import-bulk-profile.md + 2-2-xem-danh-sach-profile-real-time.md Review Findings]

## Dev Agent Record

### Agent Model Used
Codex GPT-5

### Debug Log References
- RED baseline: `npx playwright test tests/unit/profile-service.spec.ts tests/integration/profile-ipc-handlers.spec.ts tests/e2e/profiles.spec.ts --reporter=line` failed as expected on missing `phase3:profile:update`, `phase3:profile:delete`, `service.updateProfile`, `service.deleteProfile`.
- Targeted unit/integration: `npx playwright test tests/unit/profile-service.spec.ts tests/integration/profile-ipc-handlers.spec.ts tests/integration/profile-repo.spec.ts --reporter=line` -> 32 passed.
- Typecheck: `npm run typecheck` -> passed.
- Lint: `npm run lint` -> passed (Node warning only about existing eslint-rules module type).
- Build + profile E2E: `npx electron-vite build && npx playwright test tests/e2e/profiles.spec.ts --reporter=line` -> build passed, 6 passed.
- Full unit/integration: `npx playwright test tests/unit tests/integration --reporter=line` -> 86 passed.
- Full E2E: `npx playwright test tests/e2e --reporter=line` -> 14 passed.

### Completion Notes List
- Added typed IPC schemas and registry entries for `phase3:profile:update` and `phase3:profile:delete` with Vietnamese ErrorEnvelope handling.
- Extended profile repository with prepared `updateDisplayName` and `getProfileById`; extended real SQLCipher smoke to verify update/get plus existing uniqueness/FK/cascade behavior.
- Implemented ProfileService update/delete. Delete removes all 4 known safeStorage secret keys before deleting the DB row, aborts row delete on any secret-delete failure, and remains idempotent for missing IDs.
- Added renderer API and ProfilesView per-row inline edit + inline two-step delete confirmation with required testids, busy-state disabling, and no secret display.
- Excluded local `.phase3-manual/` from ESLint scanning so manual smoke data that may contain secrets stays outside normal code validation.
- Added/kept regression coverage for service, IPC, real SQLCipher repo smoke, and E2E import -> edit -> delete.

### File List
- `automation-desktop/eslint.config.mjs`
- `automation-desktop/src/main/adapters/electron-bootstrap.ts`
- `automation-desktop/src/main/db/repositories/profile-repo.ts`
- `automation-desktop/src/main/ipc/profile-handlers.ts`
- `automation-desktop/src/main/profile/profile-service.ts`
- `automation-desktop/src/renderer/src/api/profile-api.ts`
- `automation-desktop/src/renderer/src/assets/main.css`
- `automation-desktop/src/renderer/src/views/ProfilesView.tsx`
- `automation-desktop/src/shared/ipc-schemas/index.ts`
- `automation-desktop/src/shared/ipc-schemas/profile.ts`
- `automation-desktop/tests/e2e/profiles.spec.ts`
- `automation-desktop/tests/integration/profile-ipc-handlers.spec.ts`
- `automation-desktop/tests/unit/profile-service.spec.ts`

### Change Log
- 2026-06-03: Implemented Story 2.3 edit/delete profile flow with secrets-first cleanup, UI actions, IPC schemas/handlers, repository/service support, and full validation pass.
