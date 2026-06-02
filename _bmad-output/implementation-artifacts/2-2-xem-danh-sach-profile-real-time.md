# Story 2.2: Xem danh sách profile với trạng thái real-time

Status: ready-for-dev

<!-- Phase 3 story (Epic 2 — Profile Management, story 2/3). Sources: epics-phase3.md#Story-2.2 (L282-294), prd-phase3.md#FR3 (L343), architecture.md (DB schema L1399-1401, automation FSM L1553-1554, poll status L1984). ⚠️ automation-desktop/ (Electron client) — 25 rules CLAUDE.md ÁP DỤNG. Previous: 2.1 done (re-review round2, 8 patch + cookie-export accepted). -->

## Story

As a user (affiliate marketer như Minh),
I want xem danh sách profile đã import kèm trạng thái hiện tại (idle/running/checkpoint/error) cập nhật real-time,
so that tôi biết profile nào đang chạy, lỗi, hay checkpoint mà KHÔNG bao giờ thấy cookie/password.

> ⚠️ **PHẠM VI**: Story này ở **`automation-desktop/`** (Electron client). `automation-desktop/CLAUDE.md` (25 rules) ÁP DỤNG. Story 2.2 = **đọc + hiển thị danh sách profile từ DB + polling real-time** (FR3). Import (FR1+FR4) = 2.1 done; sửa/xóa (FR2) = 2.3 — KHÔNG làm ở đây.

## Acceptance Criteria

1. **IPC `phase3:profile:list`**: Request `{}` (Zod object rỗng). Response `{ ok:true, profiles: Array<{id, uid, displayName, status, createdAt}> }` sắp xếp theo `created_at DESC` — **KHÔNG chứa cookie/2fa/password/email** (chỉ 5 field trên). Lỗi → ErrorEnvelope `{ok:false, error:{code,message,retryable}}` message tiếng Việt. Zod validate CẢ request lẫn response (rule #7,#8,#9). **BẮT BUỘC đăng ký vào `channelRegistry`** — preload throw `Unregistered IPC channel` nếu thiếu (preload/index.ts:45-48).
2. **`ProfileService.listProfiles()`**: Method mới trong `ProfileService` wrap `repo.listProfiles()`, map `ProfileRow` → summary `{id, uid, displayName, status, createdAt}`. **KHÔNG đọc safeStorage / KHÔNG chạm secret** (list thuần từ bảng `profiles`). `deps` của service KHÔNG đổi (đã có `repo`).
3. **ProfilesView — section danh sách**: Thêm khu "Danh sách profile" (tách khỏi khu kết quả import của 2.1) load từ `phase3:profile:list` khi mount. Mỗi profile hiển thị: `uid` + `displayName` + **status badge**. KHÔNG hiển thị secret. Empty state rõ ràng ("Chưa có profile nào.") khi list rỗng. Hardcode tiếng Việt. KHÔNG phá vỡ luồng import + clear-textarea + loading của 2.1.
4. **Real-time qua polling**: Poll `phase3:profile:list` định kỳ (interval ~5000ms) khi ProfilesView mounted. **Cleanup bắt buộc**: `clearInterval` khi unmount + `cancelled` flag chống `setState` sau unmount (mirror App.tsx:87-123). **Không overlap**: bỏ qua tick mới nếu request trước chưa xong. Sau **import thành công** (2.1) → refresh list ngay để profile mới xuất hiện.
5. **Status badge tolerant**: Map status → nhãn + style tiếng Việt: `idle`→"Nhàn rỗi", `running`→"Đang chạy", `checkpoint`→"Checkpoint", `error`→"Lỗi". Giá trị lạ (vd Epic 4 ghi state khác) → fallback badge "Không xác định" (KHÔNG crash). Trong schema, `status` = `z.string().min(1)` (tolerant — KHÔNG strict-enum để tránh Zod parse fail khi Epic 4 mở rộng trạng thái). KHÔNG sửa `ImportedProfileSchema` của 2.1.
6. **Loading / error states**: Lần load đầu → loading indicator có `data-testid`/class RIÊNG (rule #16, không trùng `main-shell`/`loading-shell`). List fetch lỗi → hiển thị message tiếng Việt + **giữ list cũ** (không xóa, không crash). Poll lỗi → không spam/không reset list.

## Tasks / Subtasks

### Main process (Electron — TypeScript)

- [ ] **Task 1: Schema + channel `phase3:profile:list`** (AC: #1)
  - [ ] `src/shared/ipc-schemas/profile.ts`: thêm `ProfileListRequestSchema = z.object({})`, `ProfileSummarySchema = z.object({ id, uid, displayName: min(1), status: z.string().min(1), createdAt: min(1) })`, `ProfileListSuccessResponseSchema = z.object({ ok: z.literal(true), profiles: z.array(ProfileSummarySchema) })`, `ProfileListResponseSchema = z.union([success, IpcErrorResponseSchema])` + export types. GIỮ NGUYÊN các schema import-bulk của 2.1.
  - [ ] `src/shared/ipc-schemas/index.ts`: thêm entry `{ channel:'phase3:profile:list', requestSchema, responseSchema } satisfies ChannelRegistryEntry<...>` vào `channelRegistry` + import schemas. (re-export `./profile` đã có.)
- [ ] **Task 2: `ProfileService.listProfiles`** (AC: #2)
  - [ ] `src/main/profile/profile-service.ts`: thêm `listProfiles(): ProfileSummary[]` vào interface `ProfileService` + impl trong `createProfileService` — `return repo.listProfiles().map(r => ({ id:r.id, uid:r.uid, displayName:r.displayName, status:r.status, createdAt:r.createdAt }))`. KHÔNG đọc safeStorage.
- [ ] **Task 3: IPC handler list** (AC: #1)
  - [ ] `src/main/ipc/profile-handlers.ts`: trong `registerProfileHandlers`, thêm `ipcMain.handle('phase3:profile:list', ...)`: safeParse request → `parseError` nếu fail; `try { return ResponseSchema.parse({ ok:true, profiles: service.listProfiles() }) } catch (e) { return ResponseSchema.parse(normalizeError(e)) }`. Tái dùng `toErrorResponse`/`normalizeError`/`parseError` sẵn có (KHÔNG viết lại). `registerProfileHandlers(ipcMain, service)` — KHÔNG cần param mới.
- [ ] **Task 4: Bootstrap** (AC: #1)
  - [ ] `electron-bootstrap.ts`: **KHÔNG cần đổi** — `registerProfileHandlers` đã nhận `profile` service. Verify list handler được đăng ký (chạy cùng `registerProfileHandlers`).
- [ ] **Task 5: Renderer API** (AC: #3,#4)
  - [ ] `src/renderer/src/api/profile-api.ts`: thêm `listProfiles(): Promise<ProfileSummary[]>` gọi `window.api.ipc.call('phase3:profile:list', {})` + `assertOk` → `return response.profiles`. Tái dùng `assertOk` sẵn có.
- [ ] **Task 6: ProfilesView list + polling** (AC: #3,#4,#5,#6)
  - [ ] `ProfilesView.tsx`: thêm state `profiles`, `listError`, `listLoading`. `useEffect` mount: load lần đầu + `setInterval(5000)` poll + `clearInterval` + `cancelled` flag + in-flight guard (ref/biến) chống overlap. Sau `handleImport` success → gọi refresh list. Render section danh sách: empty state, loading testid riêng (rule #16), error giữ list cũ. Status badge map (AC5) với fallback. Hardcode tiếng Việt. KHÔNG đụng khu import-result/clear-textarea của 2.1.
- [ ] **Task 7: Tests** (AC: tất cả)
  - [ ] Unit `tests/unit/profile-service.spec.ts` (thêm): `listProfiles` map đúng + KHÔNG gọi storage (fake storage.get/set không được gọi) + response shape không secret.
  - [ ] Integration `tests/integration/profile-ipc-handlers.spec.ts` (thêm, FakeIpcMain): `phase3:profile:list` Zod 2-way; response không secret; ErrorEnvelope khi service throw (retryable đúng).
  - [ ] E2E `tests/e2e/profiles.spec.ts` (thêm): import 2 profile → list hiển thị 2 uid + status badge "Nhàn rỗi" (idle); empty state khi DB rỗng; (tùy chọn) poll refresh. Tái dùng `launchWithActiveLicense`/`closeServer`/`setTextareaValue` của 2.1.
  - [ ] `typecheck` PASS, `lint` 0 errors, toàn bộ test cũ (2.1) vẫn xanh.

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules)
- **Rule #7,#8,#9**: IPC Zod validate 2 chiều + ErrorEnvelope có `retryable` + KHÔNG throw raw Error qua boundary.
- **Rule #10,#11**: KHÔNG đưa secret vào response/log. List CHỈ id/uid/displayName/status/createdAt — bảng `profiles` vốn không chứa secret, nhưng KHÔNG được join `profile_metadata`/safeStorage để thêm field nhạy cảm.
- **Rule #15**: ErrorEnvelope `message` tiếng Việt; `code` SCREAMING_SNAKE English.
- **Rule #16**: loading state class/testid RIÊNG (vd `data-testid="profiles-list-loading"`), không trùng `main-shell`/`loading-shell`.
- **Rule #5**: try/catch quanh I/O (repo read).
- **Rule #14**: Zod non-optional string có `.min(1)`.

### ⚠️ CRITICAL: channelRegistry là bắt buộc
`window.api.ipc.call(channel, req)` trong preload **tra `channelRegistry` trước**; nếu channel chưa đăng ký → `throw new Error('Unregistered IPC channel: ...')` (preload/index.ts:45-48) VÀ nó safeParse request/response bằng schema trong registry. → Quên đăng ký `phase3:profile:list` = renderer call chết ngay. [Source: src/preload/index.ts:44-68]

### Files để sửa (UPDATE) — current state + điều phải giữ
| File | Hiện trạng | 2.2 đổi gì | Giữ nguyên |
|---|---|---|---|
| `src/shared/ipc-schemas/profile.ts` | import-bulk schemas (Request/Imported/Skipped/Failed/ImportResult/Response) | + list schemas | toàn bộ import-bulk schemas |
| `src/shared/ipc-schemas/index.ts` | channelRegistry 7 entry (settings/shell/license/profile:import-bulk) | + entry `profile:list` + import | các entry cũ + re-export |
| `src/main/profile/profile-service.ts` | `importBulk` + brandSecret/revealSecret (2.1 patch P8) | + `listProfiles()` interface+impl | `importBulk`, secret handling |
| `src/main/ipc/profile-handlers.ts` | `registerProfileHandlers` đăng ký import-bulk; có `toErrorResponse`/`parseError`/`normalizeError` (normalizeError unknown→retryable:false, 2.1 patch P1) | + handler list (tái dùng helpers) | import-bulk handler + helpers |
| `src/renderer/src/api/profile-api.ts` | `importBulkProfiles` + `assertOk` | + `listProfiles()` | `importBulkProfiles`, `assertOk` |
| `src/renderer/src/views/ProfilesView.tsx` | import form + import-result list + clear-textarea (D2: clear-always) + loading testid (2.1) | + section danh sách + useEffect polling + refresh-after-import | import flow + clear-textarea + import-loading |
| `src/main/db/repositories/profile-repo.ts` | **đã có `listProfiles(): ProfileRow[]`** (id/uid/displayName/status/createdAt, ORDER BY created_at DESC) | **KHÔNG đổi — TÁI DÙNG** | listProfiles |
| `electron-bootstrap.ts` | `registerProfileHandlers(ipcMain, profileService)` đã wire | **KHÔNG đổi** | wiring |

**Anti-reinvention**: `profile-repo.listProfiles()` ĐÃ TỒN TẠI và trả đúng shape cần — KHÔNG viết query mới. [Source: src/main/db/repositories/profile-repo.ts:46-49,76-84]

### Status model — discrepancy + tolerant approach
- DB `profiles.status` = free `TEXT`; 2.1 ghi `'idle'` lúc import. [Source: architecture.md#L1399, src/main/db/client.ts]
- `automation_jobs.state` (Epic 4, CHƯA build) = FSM SCREAMING_SNAKE: `PENDING|ACQUIRING_PROXY|LOGGING_IN|SOLVING_CHECKPOINT|WARMING_UP|EXECUTING|DONE|CHECKPOINT_BLOCKED|FAILED|CANCELLED`. [Source: architecture.md#L1553-1554]
- Epic 2.2 AC nêu status hiển thị: `idle/running/checkpoint/error`. 2.1 `ImportedProfileSchema.status` lại là enum `['idle','active','error']` (lệch — `active` vs `running`).
- → **2.2 dùng `status: z.string().min(1)` (tolerant)** cho list response + UI map các giá trị đã biết, fallback "Không xác định". KHÔNG strict-enum (tránh Zod parse fail khi Epic 4/automation ghi state mới). KHÔNG sửa `ImportedProfileSchema` (ngoài scope). Khi Epic 4 cập nhật `profiles.status`, polling tự phản ánh.

### Real-time mechanism — polling (KHÔNG push, KHÔNG automation)
- Renderer Phase 3 = React thuần (KHÔNG TanStack Query). Dùng `useEffect` + `setInterval(~5000ms)` + `clearInterval` on unmount + `cancelled` flag — mirror pattern license của App.tsx. [Source: src/renderer/src/App.tsx:87-123]
- **In-flight guard**: dùng 1 biến/ref `isFetching` để bỏ qua tick chồng lấn (poll chậm hơn 5s không dồn).
- NFR5: IPC <100ms → poll 5s rất nhẹ. NFR3 ≥10 profile/8GB.
- ⚠️ **`phase3:automation:status` (Epic AC nhắc) DEFER sang Epic 4** — automation engine chưa tồn tại. 2.2 chỉ poll `phase3:profile:list` (đọc `profiles.status`). Đây là cách đáp ứng "real-time status display" mà không fabricate automation. Push event (main→renderer, như `phase3:license:changed` ở preload) là lựa chọn tương lai nếu cần đẩy tức thời.

### Previous story intelligence (2.1 — automation-desktop)
- IPC Zod 2-way + ErrorEnvelope retryable tiếng Việt đã chuẩn hóa. `normalizeError` unknown error → `retryable:false` (patch P1) — tái dùng cho handler list.
- E2E helpers SẴN CÓ trong `tests/e2e/profiles.spec.ts`: `launchWithActiveLicense(dbPath, extraEnv?)` (trả `{app, window, server}`), `closeServer(server)` (đóng trong finally), `setTextareaValue(textarea, value)` — TÁI DÙNG cho test list. [Source: tests/e2e/profiles.spec.ts:12-88]
- Integration handler test dùng `FakeIpcMain` (không launch electron). [Source: tests/integration/profile-ipc-handlers.spec.ts]
- Secret handling: `brandSecret`/`revealSecret` cho cookie/2fa/pass (2.1 P8). **List KHÔNG có secret** → KHÔNG cần đụng, nhưng tuyệt đối KHÔNG đọc safeStorage trong đường list.
- `parser.ts` có `parseCookieExport` (cookie-export accepted) — KHÔNG liên quan list.
- KHÔNG commit `automation-desktop/.phase3-manual/` (đã gitignore — chứa secret test thủ công). [bài học review 2.1 R2]

### Edge cases cần xử lý
- List rỗng (chưa import) → empty state, không lỗi.
- List fetch / poll lỗi (IPC fail) → message tiếng Việt, GIỮ list cũ, không crash, không xóa.
- Unmount giữa lúc poll → cleanup interval + cancelled flag (không `setState` sau unmount → tránh warning + leak).
- Status value lạ → fallback badge.
- Import xong → list phải refresh (profile mới hiện) — gọi reload sau success thay vì chỉ chờ tick poll kế.
- List lớn (vài nghìn) → render toàn bộ ở 2.2; ghi nhận virtualization là tối ưu tương lai (KHÔNG làm giờ).
- Đua import + poll: poll đọc DB, import ghi DB — better-sqlite3 sync, không tranh chấp; refresh-after-import đảm bảo nhất quán hiển thị.

### Scope — KHÔNG làm
- KHÔNG implement automation engine / state machine / `phase3:automation:status` (Epic 4).
- KHÔNG sửa/xóa profile (FR2 → Story 2.3).
- KHÔNG hiển thị/sửa proxy/fingerprint metadata (2.3 / Epic 3).
- KHÔNG push event status (poll-only ở 2.2).
- KHÔNG sửa `ImportedProfileSchema` / luồng import của 2.1.
- KHÔNG đụng `backend/`/`frontend/` (web).

### References
- [Source: epics-phase3.md#Story-2.2 (L282-294)] — AC gốc
- [Source: prd-phase3.md#FR3 (L343)] — trạng thái real-time idle/running/checkpoint/error
- [Source: architecture.md#L1399-1401] — DB schema `profiles`/`profile_metadata`/`automation_jobs`
- [Source: architecture.md#L1553-1554] — automation_jobs FSM states (Epic 4)
- [Source: architecture.md#L1984] — "renderer poll status qua phase3:automation:status"
- [Source: src/preload/index.ts:44-68] — generic ipc.call + channelRegistry guard
- [Source: src/renderer/src/App.tsx:87-123] — useEffect + cancelled cleanup pattern
- [Source: src/main/db/repositories/profile-repo.ts:46-49,76-84] — listProfiles sẵn có
- [Source: src/shared/ipc-schemas/index.ts:51-87] — channelRegistry pattern
- [Source: src/main/ipc/profile-handlers.ts] — handler + helpers (P1 normalizeError)
- [Source: automation-desktop/CLAUDE.md (25 rules)], [Source: _bmad-output/implementation-artifacts/2-1-import-bulk-profile.md (Review Findings)]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
