# Story 2.1: Import bulk profile

Status: done

<!-- Phase 3 story (Epic 2 — Profile Management, story đầu). Sources: prd-phase3.md FR1+FR4 + Journey 1, architecture.md § Phase 3 (R-D3, ADR-P3-D3, DB schema, Secret marker), epics-phase3.md Epic 2. ⚠️ QUAY LẠI automation-desktop/ (Electron client) — 25 rules CLAUDE.md ÁP DỤNG LẠI. Previous app stories: 1.1-1.4 done (1.5 backend/web, review). -->

## Story

As a user (affiliate marketer như Minh),
I want import hàng loạt profile Facebook bằng cách paste danh sách theo định dạng `uid|pass|2fa|cookie|hotmail|passmail` hoặc JSON cookie export từ browser,
so that tôi nạp nhanh nhiều tài khoản đã nuôi sẵn vào tool mà cookie + 2FA được lưu an toàn.

> ⚠️ **PHẠM VI**: Story này ở **`automation-desktop/`** (Electron client). `automation-desktop/CLAUDE.md` (25 rules) + Secret<T> (R-D3) ÁP DỤNG. Story 2.1 = **import + lưu trữ an toàn** (FR1 + FR4). Xem danh sách real-time (FR3) = Story 2.2; sửa/xóa (FR2) = Story 2.3 — KHÔNG làm ở đây.

## Acceptance Criteria

1. **Bulk parser (service, pure function)**: Parse text nhiều dòng, mỗi dòng `uid|pass|2fa|cookie|hotmail|passmail` (split `|`). Tolerant: bỏ dòng trống + dòng bắt đầu `#` (comment); `trim` mỗi field. **Bắt buộc**: `uid` (field 0) + `cookie` (field 3) không rỗng — thiếu → dòng đó `failed` với lý do rõ ràng (tiếng Việt), KHÔNG abort cả batch. Hỗ trợ cả biến thể 7-field (architecture FR-P3-01 `uid|pass|2fa|cookie|token|hotmail|passmail`): nếu ≥7 field → field[4]=token, field[5]=hotmail, field[6]=passmail; nếu =6 field → field[4]=hotmail, field[5]=passmail. Ngoài format pipe, textarea cũng nhận **JSON cookie export Facebook** (array/object có `name` + `value`): parser tự lấy `uid` từ cookie `c_user` và convert thành cookie string `name=value; name2=value2`. Trả per-line/result rõ ràng; JSON invalid hoặc thiếu `c_user` → failed/error tiếng Việt.
2. **Dedupe theo `uid`**: `profiles.uid` UNIQUE. Import uid đã tồn tại (trong DB hoặc trùng trong cùng batch) → `skipped` + lý do "uid đã tồn tại", KHÔNG tạo trùng, KHÔNG ghi đè secret cũ.
3. **Persist metadata → SQLCipher**: Mỗi profile hợp lệ → row `profiles(id, uid, display_name, status='idle', created_at)` (id = `crypto.randomUUID()`, display_name mặc định = uid). Email (`hotmail`) nếu có → `profile_metadata(profile_id, key='email', value)`. `token` (nếu biến thể 7-field) → `profile_metadata key='token'`.
4. **Persist secret → safeStorage (R-D3)**: `cookie`, `2fa` seed, `pass` (FB password), `passmail` (email password) lưu vào safeStorage key `profile.<id>.cookie` / `.twofa` / `.fb_password` / `.mail_password`. **TUYỆT ĐỐI KHÔNG** lưu các field này vào SQLite, KHÔNG đưa vào IPC response, KHÔNG log (rule #10, #11). Field rỗng (vd không có 2fa) → bỏ qua key đó.
5. **Atomicity per-profile**: Mỗi profile persist như 1 đơn vị: ghi secret (safeStorage) + row DB; nếu BẤT KỲ bước nào fail → cleanup (xóa các secret key đã ghi cho id đó + xóa/không-commit row) → profile đó `failed`, KHÔNG để trạng thái half-created (cookie mồ côi hoặc profile không cookie). Các profile khác trong batch vẫn tiếp tục.
6. **IPC `phase3:profile:import-bulk`**: Request `{ text: string }` (Zod, max length hợp lý vd 1_000_000 chars; cap số dòng vd ≤ 5000 → vượt trả lỗi rõ). Response `{ ok:true, result: { total, imported, skipped, failed: Array<{line:number, reason:string}>, profiles: Array<{id, uid, displayName, status}> } }` — **KHÔNG chứa cookie/2fa/password**. Lỗi → ErrorEnvelope `{ok:false, error:{code,message,retryable}}` message tiếng Việt. Zod validate cả request lẫn response (rule #7,#8,#9).
7. **ProfilesView (renderer)**: View mới hiển thị khi `gateState === 'ready'` (license active/offline-grace — tier-1). Gồm: textarea paste danh sách + nút "Import" (disable khi đang xử lý — rule #17) + khu kết quả summary (số imported / skipped / failed + danh sách lỗi theo dòng) + danh sách profile vừa import (id/uid/status — KHÔNG secret). Sau import thành công → **clear textarea** (không giữ secret trong DOM). Hardcode tiếng Việt. `loading` state dùng class/testid riêng (rule #16).

## Tasks / Subtasks

### Main process (Electron — TypeScript)

- [x] **Task 1: DB schema profiles + profile_metadata** (AC: #2, #3)
  - [x] `src/main/db/client.ts`: thêm bảng `profiles` + `profile_metadata` + `PRAGMA foreign_keys = ON`.
- [x] **Task 2: profile-repo** (AC: #2, #3)
  - [x] `src/main/db/repositories/profile-repo.ts`: `uidExists`, `insertProfileAtomic(params, metadata)` (transaction), `deleteProfile`, `listProfiles`, `countProfiles`. Prepared statements.
- [x] **Task 3: profile-service + bulk parser** (AC: #1, #2, #4, #5)
  - [x] `src/main/profile/parser.ts`: pure `parseBulkProfiles` — skip trống/comment, trim, validate uid+cookie, 6-field vs 7-field, nhận JSON cookie export Facebook (derive uid từ `c_user`, convert cookie string), cap 5000 dòng.
  - [x] `src/main/profile/profile-service.ts`: `importBulk` — parse, dedupe (batch Set + uidExists), write secrets to safeStorage, insertProfileAtomic, atomicity per-profile (cleanup trên fail).
  - [x] `src/main/profile/index.ts` barrel export.
- [x] **Task 4: IPC channel + handler** (AC: #6)
  - [x] `src/shared/ipc-schemas/profile.ts`: Zod schemas + types. `channelRegistry` + re-export.
  - [x] `src/main/ipc/profile-handlers.ts`: Zod 2-way + ErrorEnvelope retryable tiếng Việt. Barrel export.
  - [x] `src/renderer/src/api/profile-api.ts`: `importBulkProfiles(text)` + `assertOk`.
- [x] **Task 5: Bootstrap wiring** (AC: #6)
  - [x] `electron-bootstrap.ts`: `profileRepo`, `profile` service, `registerProfileHandlers`.
- [x] **Task 6: ProfilesView + App.tsx** (AC: #7)
  - [x] `ProfilesView.tsx`: textarea + Import button (disabled khi importing, rule #17) + summary + danh sách. Clear textarea sau success. Loading testid riêng (rule #16).
  - [x] `App.tsx`: import `ProfilesView`, render trong `MainShell` khi `gateState === 'ready'`.
- [x] **Task 7: Tests** (AC: tất cả)
  - [x] Unit `tests/unit/profile-parser.spec.ts` (12 tests): happy 6/7-field, skip empty/comment, missing uid/cookie, trim, JSON cookie export valid/invalid/missing `c_user`, batch error, line cap.
  - [x] Unit `tests/unit/profile-service.spec.ts` (11 tests): secret → storage, JSON cookie export → converted cookie string, response no-secret, dedupe batch/db, atomicity cleanup, empty fields, line counting, sanitized storage/DB errors.
  - [x] Integration `tests/integration/profile-ipc-handlers.spec.ts` (3 tests): Zod 2-way, no-secret, ErrorEnvelope.
  - [x] E2E `tests/e2e/profiles.spec.ts` (2 tests): profiles-view visible, 2 imports → summary + textarea cleared.
  - [x] `typecheck` PASS, `lint` 0 errors (15 prettier warnings, không có security errors).

### Review Findings (2026-06-02 — bmad-code-review, 3 reviewers)

> Diff source: commit `c96cac7`. Reviewers: Blind Hunter + Edge Case Hunter + Acceptance Auditor. Scorecard AC: AC1✅ AC2✅ AC3✅ AC4⚠️ AC5⚠️ AC6⚠️ AC7⚠️.

**Decision-needed (cần Luis quyết trước khi patch):**

- [x] [Review][Decision✓→Patch P8] Secret<T>: Luis chọn ENFORCE wrap (xem Patch P8). Gốc: KHÔNG được wrap in-memory — `profile-service.ts:91-95` giữ cookie/2fa/pass dạng plain `string` trong `secretEntries`. R-D3 / Rule #10 + Dev Notes story yêu cầu `brandSecret()`. Rủi ro thực tế thấp (sink ngay vào safeStorage, không log/không return) nhưng lệch rule + Dev Notes. `brandSecret` dùng `Object(value)` → String object, cần unwrap tại biên `storage.set`. Enforce wrap (defense-in-depth) hay formally waive?
- [x] [Review][Decision✓→Dismiss] Clear textarea: Luis chọn CLEAR-ALWAYS (giữ hiện tại, ưu tiên secret-hygiene). Gốc: khi import 0-imported / all-failed — `ProfilesView.tsx:17-20` luôn `setText('')` khi IPC `ok:true`, kể cả `imported=0` + `failed>0`. Secret-hygiene (Dev Notes: không giữ secret trong DOM) ⟷ UX (user mất input không retry được). Clear-always (hiện tại, hygiene) hay clear-chỉ-khi-imported>0 (UX, nhưng giữ secret trong DOM khi fail)?
- [x] [Review][Decision✓→Dismiss] Parser: Luis chọn GIỮ TOLERANT (giữ hiện tại, đúng Dev Notes). Gốc: tolerant với field count ≠ 6/7 — `parser.ts:81-90`: 5-field xử lý như 6-field (passmail=''), 8+ field drop field thừa im lặng. AC1 nói "6/7-field" nhưng Dev Notes nói "field thiếu OK nếu uid+cookie có". Giữ tolerant (hiện tại) hay enforce đúng 6/7 (reject + báo lỗi rõ với typo)?

**Patch (fix không cần input):**

- [x] [Review][Patch] `normalizeError` trả `retryable:true` cho lỗi unknown → nên `false` (lỗi lập trình retry vô hạn) [profile-handlers.ts:28]
- [x] [Review][Patch] `failed[].reason` lộ raw `err.message` (DB error tiếng Anh, vi phạm Rule #15 + lộ schema internals) → map sang message tiếng Việt generic; UNIQUE-constraint TOCTOU → "uid đã tồn tại" [profile-service.ts:124]
- [x] [Review][Patch] Line-cap >5000 trả `ok:true` + `failed:[{line:1}]` + `total:1` (sai lệch 5001 dòng) → nên `ok:false` ErrorEnvelope `LINE_CAP_EXCEEDED` retryable:false (Rule #8, AC6 "vượt trả lỗi rõ") [parser.ts:45-55 + profile-service.ts + profile-handlers.ts]
- [x] [Review][Patch] `FailedEntrySchema.uid` là `optional()` thiếu `.min(1)` → `''` lọt Zod (Rule #14) → `z.string().min(1).optional()` [profile.ts:27]
- [x] [Review][Patch] E2E `launchWithActiveLicense` không `server.close()` → leak port/fd trong CI → return server handle + close trong `finally` [tests/e2e/profiles.spec.ts:11-54,69-72,110-113]
- [x] [Review][Patch] Thiếu integration test với SQLCipher DB thật cho `profile-repo` (Rule #18: DB read/write = integration real DB). Test "integration" hiện dùng FakeIpcMain + memory repo → insertProfileAtomic transaction / UNIQUE / CASCADE / `foreign_keys=ON` chưa được test thật → thêm `tests/integration/profile-repo.spec.ts`
- [x] [Review][Patch] Thiếu E2E/coverage cho: button-disable khi importing (#17), loading testid (#16), reject >1MB (Zod), error-path giữ textarea (gắn với Decision #2)
- [x] [Review][Patch] (P8, từ Decision D1) Wrap cookie/2fa/pass/passmail bằng `brandSecret()` trong profile-service in-memory, unwrap tại biên `storage.set`; test kỹ biên `encryptString` (String-object) [profile-service.ts:91-107]

**Defer (ghi nhận, chưa làm):**

- [x] [Review][Defer] Orphan safeStorage key nếu `storage.delete` trong cleanup TỰ throw (double-fault) — code đã attempt cleanup (đạt ý AC5); key mồ côi là encrypted + không-referenced (không phải leak). Cần reconciliation/observability sau [profile-service.ts:118-120] — deferred, edge ngoài AC5

**Dismissed (false-positive / handled, không hành động):** token→SQLite (đúng AC3 + Dev Notes, SQLCipher encrypt at rest); Zod `details` flatten "lộ secret" (flatten trả message string, KHÔNG chứa giá trị `text`); `.parse()` error-path "throw" (output khớp schema `details: z.unknown().optional()`); double-click race (đã theo Rule #17 + guard `if(importing)`); token empty-string (guard `if(p.token)`); `foreign_keys=ON` ordering (pragma per-connection, enforce tại DML); `batchUids.add` reason cosmetic (vẫn skip đúng); `assertOk` message (đã VN-controlled — phần raw reason đã tách thành Patch); `response.result` union (main validate schema trước return); id không hiển thị UI (UUID nội bộ, uid+status đã đủ).

### Re-review round 2 (2026-06-02 — sau khi dev apply patch)

> Diff: working-tree vs HEAD (uncommitted). **Lint ✅ 0 errors · Typecheck ✅ · 48 unit + 6 integration PASS.** E2E (4 test) cấu trúc đúng, chưa exec trong môi trường review (cần `electron-vite build`).

**Patch verification — TẤT CẢ 8/8 ✅:**
- P1 ✅ `normalizeError` unknown → `retryable:false` [profile-handlers.ts:28] + test "non-retryable"
- P2 ✅ `failed[].reason` sanitize VN, UNIQUE→"uid đã tồn tại" [profile-service.ts:166-169] + 2 test
- P3 ✅ line-cap → ErrorEnvelope `LINE_CAP_EXCEEDED` (parser flag + service throw + handler) + 3 test (unit/service/IPC)
- P4 ✅ `FailedEntrySchema.uid` `.min(1).optional()` [profile.ts:27]
- P5 ✅ E2E `closeServer()` + server đóng trong `finally` cả 4 test
- P6 ✅ profile-repo real-SQLCipher qua `runProfileRepoSmoke` (electron-launch, verify FK/UNIQUE/CASCADE/transaction)
- P7 ✅ E2E loading/disable (#16/#17 qua `PHASE3_PROFILE_IMPORT_DELAY_MS`) + error-path giữ textarea + IPC >1MB rejection
- P8 ✅ `brandSecret` wrap + `revealSecret` unwrap tại `storage.set` [profile-service.ts:121-141, secret.ts:17-19] + test

**Findings MỚI (do dev tạo trong lúc patch — round 2):**

- [x] [Re-review][Decision✓→Accept] **SCOPE CREEP** JSON cookie-export — ✅ Luis chọn ACCEPT vào 2.1. AC1 đã cập nhật phản ánh feature (parser tự lấy uid từ `c_user`, convert cookie string). PM sign-off = Luis (owner). ⚠️ Follow-up đã ghi `deferred-work.md`: verify format cookie `name=value; …` khớp login/automation Epic 4. Gốc: dev tự thêm `parser.ts:parseCookieExport` + UI + 4 test, ngoài 8 patch.
- [x] [Re-review][Patch✓] **Secrets + rác staged** — ✅ ĐÃ XỬ LÝ: `git rm --cached -r automation-desktop/.phase3-manual` + gỡ `.review-2.1*.diff` khỏi index (file giữ trên disk, đã gitignore). Verify: 0 secret staged, 16 file staged đều hợp lệ. (KHÔNG commit — để Luis commit.)

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules)
- **R-D3 / Rule #10**: cookie + 2FA seed (+ ở story này: FB password, mail password) CHỈ trong safeStorage, KHÔNG plaintext SQLite. Dùng `Secret<T>` (`brandSecret`) trong bộ nhớ.
- **Rule #11 + ESLint `no-direct-logger`**: KHÔNG log cookie/password/2fa/text import. Nếu log kết quả → chỉ counts.
- **Rule #7,#8,#9**: IPC Zod validate 2 chiều + ErrorEnvelope có `retryable` + message tiếng Việt.
- **Rule #5**: try/catch quanh I/O external (safeStorage, DB).
- **Rule #13**: multi-step persist — atomicity per-profile (xem AC5).
- **Rule #16**: loading state class/testid riêng (không trùng main-shell).
- **Rule #21**: mỗi service = 1 folder + `index.ts` barrel (`src/main/profile/` đã có placeholder rỗng).
- **Rule #14**: Zod non-optional string có `.min(1)`.

### ⚠️ Exception có kiểm soát cho Rule #10 (import = paste)
Rule #10 nói "cookie KHÔNG đi qua IPC payload raw, dùng `cookie_ref`". Nhưng **bulk import từ paste** không có ref sẵn — text (chứa cookie) BẮT BUỘC qua IPC 1 lần từ renderer → main. Đây là **điểm vào hợp lệ duy nhất**. Ràng buộc bù để an toàn:
- Main parse + sink secret vào safeStorage NGAY, không giữ/forward.
- **Response KHÔNG chứa secret** (chỉ id/uid/status + counts).
- **KHÔNG log** text import hay secret (rule #11).
- Renderer **clear textarea** sau import (không giữ secret trong DOM/React state lâu).
Reviewer: đây là exception CÓ CHỦ Ý, không phải vi phạm — verify 4 ràng buộc trên thay vì đòi `cookie_ref`.

### Phân loại Secret vs Metadata (R-D3)
| Field | Lưu ở đâu | Lý do |
|---|---|---|
| `cookie`, `2fa`, `pass` (FB pw), `passmail` (mail pw) | **safeStorage** `profile.<id>.*` | Credential — R-D3 bắt buộc keychain |
| `uid`, `display_name`, `status`, `created_at` | `profiles` (SQLCipher) | Identity/metadata, hiển thị được |
| `hotmail` (email), `token` (nếu có) | `profile_metadata` (SQLCipher, mã hóa at rest) | Định danh phụ/extensible; SQLCipher đã encrypt DB |

### Định dạng import — discrepancy đã giải quyết
- **FR1 (epic, canonical)**: `uid|pass|2fa|cookie|hotmail|passmail` (6 field).
- **Architecture FR-P3-01**: `uid|pass|2fa|cookie|token|hotmail|passmail` (7 field, thêm `token`).
- → Parser xử lý cả 2 theo số field (xem AC1). uid (0) + cookie (3) luôn cố định + bắt buộc.
- **Manual/browser cookie export**: textarea cũng nhận JSON cookie export Facebook dạng array/object `{name,value,...}`. Parser tự lấy `uid` từ cookie `c_user`, convert toàn bộ entries hợp lệ thành cookie string `name=value; name2=value2`, rồi đi tiếp qua cùng flow safeStorage. Nếu JSON hỏng, không có cookie hợp lệ, hoặc thiếu `c_user` → trả lỗi tiếng Việt rõ ràng.

### DB hiện trạng (đã khảo sát)
- `src/main/db/client.ts`: KHÔNG có migration system — schema tạo bằng `CREATE TABLE IF NOT EXISTS` inline khi `openEncryptedDatabase`. Thêm 2 bảng mới Ở ĐÂY. [Source: src/main/db/client.ts]
- Repo factory pattern: `createSettingsRepository(db)` trả object literal closure-capture `db`. Copy cho profile-repo. [Source: src/main/db/repositories/settings-repo.ts]
- ⚠️ better-sqlite3 mặc định `foreign_keys=OFF` — để `ON DELETE CASCADE` hoạt động phải `db.pragma('foreign_keys = ON')`. Verify/ thêm trong client.ts.
- `db.transaction(fn)` của better-sqlite3 là SYNC — dùng cho phần insert profile+metadata. safeStorage là ASYNC, KHÔNG nằm trong transaction đó → atomicity cross-store xử lý thủ công (AC5).

### Secret<T> (đã khảo sát)
- `src/shared/types/secret.ts`: `Secret<T> = T & {[SECRET_TAG]:true}`, `brandSecret(value)` block `toString` (throw). Unwrap = truy cập field. [Source: src/shared/types/secret.ts, tests/unit/secret.spec.ts]
- safeStorage adapter `SecureStorage { get/set/delete(key) }` — `ElectronSafeStorage` crash-safe (patch 1.3: atomic write + isEncryptionAvailable guard + try/catch). [Source: src/adapters/secure-storage.ts, src/main/adapters/electron-safe-storage.ts]

### IPC + renderer (đã khảo sát)
- channelRegistry + Zod schema: copy `settings.ts`/`license.ts`. ErrorEnvelope ở `common.ts` (`{code,message,retryable,details?}`). [Source: src/shared/ipc-schemas/]
- Handler pattern `registerLicenseHandlers` + `normalizeError` (typed error → envelope). [Source: src/main/ipc/license-handlers.ts]
- preload `window.api.ipc.call(channel, request)`. renderer api `assertOk` pattern. [Source: src/preload/index.ts, src/renderer/src/api/settings-api.ts]
- App.tsx `gateState === 'ready'` → MainShell (hiện là placeholder h1+lead, CHƯA có navigation). ProfilesView render khi ready. [Source: src/renderer/src/App.tsx:67-71,200-204]

### Previous story intelligence (1.1-1.4 — automation-desktop)
- IPC Zod 2-way + ErrorEnvelope retryable tiếng Việt đã chuẩn hóa (1.2-1.4). safeStorage crash-safe + atomic (1.3 patch C1). Multi-step persist atomicity = bài học review 1.3 (C2). Mọi nhánh + edge case PHẢI có test = bài học 1.2-1.4 (đặc biệt: nhánh secret/error không test → bug lọt). [Source: memory `phase3-review-rules`]
- KHÔNG `parseInt` lỏng (rule #12) — số dòng/cap parse strict.

### Scope — KHÔNG làm
- KHÔNG làm danh sách real-time + trạng thái live (FR3 → Story 2.2). 2.1 chỉ hiển thị kết quả import + danh sách tĩnh vừa import.
- KHÔNG làm sửa/xóa profile (FR2 → Story 2.3).
- KHÔNG làm proxy assignment / fingerprint (Epic 3 / Story 4.1) — `profile_metadata` để sẵn key/value nhưng KHÔNG implement proxy/fingerprint giờ.
- KHÔNG làm login/automation/cookie test (Epic 4).
- KHÔNG đụng `backend/` hay `frontend/` (web) — story này thuần `automation-desktop/`.
- KHÔNG implement logger mới nếu chưa có — chỉ đảm bảo KHÔNG log secret.

### Edge cases cần xử lý (bài học review 1.2-1.4)
- Dòng trống / chỉ whitespace / comment `#` → bỏ qua, không tính failed.
- Field thiếu (vd `uid||2fa|cookie` → pass rỗng) → OK nếu uid+cookie có; pass rỗng → không ghi key fb_password.
- Thiếu uid hoặc cookie → failed với line number + lý do.
- uid trùng (trong batch / đã có DB) → skipped, không ghi đè.
- Quá nhiều dòng (> cap 5000) → trả lỗi rõ, không OOM.
- safeStorage unavailable / set fail giữa chừng → profile đó failed + cleanup, không orphan secret/profile.
- Text cực lớn → giới hạn max length ở Zod.
- Ký tự `|` trong cookie value? Cookie thường không chứa `|` raw, nhưng nếu có → split sai. Note: split theo số field cố định từ trái; cookie là field[3] — nếu cookie chứa `|` parser sẽ lệch. Chấp nhận giả định cookie không chứa `|` (format nguồn C# cũng vậy); KHÔNG cần xử lý escape ở 2.1 nhưng ghi nhận giới hạn.
- JSON cookie export Facebook: invalid JSON → `JSON cookie export không hợp lệ.`; không có `{name,value}` hợp lệ → `JSON cookie export không có cookie hợp lệ.`; thiếu `c_user` → `JSON cookie export thiếu cookie c_user để lấy uid.`
- Response/throw KHÔNG được lộ secret kể cả trong `details` của ErrorEnvelope.

### References
- [Source: epics-phase3.md#Epic-2 Story-2.1]
- [Source: prd-phase3.md#FR1, #FR4, #Journey-1 (Minh bulk import), #L107-108, #L175 Secret at rest]
- [Source: architecture.md#R-D3 Cookie & Secret Hygiene, #ADR-P3-D3 (safeStorage+SQLCipher), #L1399-1407 DB schema profiles/profile_metadata, #FR-P3-01]
- [Source: src/main/db/client.ts, src/main/db/repositories/settings-repo.ts, src/shared/types/secret.ts, src/adapters/secure-storage.ts]
- [Source: src/shared/ipc-schemas/ (settings.ts/license.ts/index.ts/common.ts), src/main/ipc/license-handlers.ts, src/preload/index.ts, src/renderer/src/api/settings-api.ts, src/renderer/src/App.tsx]
- [Source: automation-desktop/CLAUDE.md (25 rules)], [Source: _bmad-output/project-context.md], [Source: memory phase3-review-rules]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- E2E tests chạy từ `./out/main/index.js` (built output). Cần `npx electron-vite build` trước khi chạy E2E tests sau khi sửa source.
- `ProfilesView` dùng `<div>` thay `<main>` để tránh nested `<main>` element trong `MainShell`.
- Fake `ProfileRepository` trong unit tests dùng `insertProfileAtomic` (không phải `insertProfile`+`setMetadata` riêng lẻ) vì service dùng atomic interface.
- E2E mock server phải trả `activation_id` là valid UUID (Zod schema `z.string().uuid()`).
- Review patch P6: `better-sqlite3-multiple-ciphers` native module trong Playwright Node worker lệch ABI với Electron; test repo SQLCipher thật chạy qua Electron dev-only smoke (`PHASE3_PROFILE_REPO_SMOKE=1`) để dùng đúng runtime production.
- Review patch P7: loading E2E dùng dev-only guarded delay (`PHASE3_PROFILE_IMPORT_DELAY_MS`) thay vì import 5000 dòng thật để tránh flaky/chậm CI; vẫn assert button disabled + `import-loading` visible qua UI.
- Verify 2026-06-02: `npm run lint` PASS (chỉ warning MODULE_TYPELESS_PACKAGE_JSON có sẵn), `npm run typecheck` PASS, `npx playwright test tests/unit tests/integration` PASS 68/68, `npx electron-vite build && npx playwright test tests/e2e` PASS 12/12.
- Manual patch 2026-06-02: sau khi test live với JSON cookie export thật, parser được mở rộng nhận JSON cookie export Facebook; targeted verify `profile-parser.spec.ts` + `profile-service.spec.ts` PASS 23/23, `npm run typecheck` PASS, `npm run lint` PASS (chỉ warning MODULE_TYPELESS_PACKAGE_JSON có sẵn), `npx electron-vite build` PASS.

### Completion Notes List

- **Task 1**: `client.ts` thêm 2 bảng `profiles`/`profile_metadata` + `foreign_keys = ON`.
- **Task 2**: `profile-repo.ts` factory, `insertProfileAtomic` dùng `db.transaction()` để wrap insert+metadata sync.
- **Task 3**: `parser.ts` pure function handle 6-field/7-field, skip empty/comment, cap 5000 dòng, per-line errors. `profile-service.ts` dedupe (batchUids Set + uidExists), write secret → safeStorage ngay, insertProfileAtomic, cleanup trên fail (secret keys + deleteProfile).
- **Task 4**: Zod schemas với max 1_000_000 chars, channelRegistry entry, handler normalizeError, renderer API assertOk pattern.
- **Task 5**: `electron-bootstrap.ts` thêm `profileRepo`, `profile` service, `registerProfileHandlers` sau license handlers.
- **Task 6**: `ProfilesView.tsx` self-managed state + `importBulkProfiles`, clear textarea sau success, `data-testid` riêng cho loading/view/result. App.tsx render ProfilesView trong MainShell khi ready + giữ license status text.
- **Task 7**: 70 tests PASS (9 parser unit + 7 service unit + 3 IPC integration + 2 profiles E2E + all regression). Typecheck PASS. Lint 0 errors.
- **Review P1-P8**: Đã apply đủ 8 patches: unknown profile IPC error `retryable:false`; failed reason sanitize tiếng Việt; line-cap >5000 thành `LINE_CAP_EXCEEDED` ErrorEnvelope; `FailedEntrySchema.uid.min(1)`; E2E close HTTP server; SQLCipher profile-repo integration smoke trong Electron runtime; coverage >1MB/loading/error-path; Secret<T> wrap + `revealSecret()` unwrap primitive tại biên storage.
- **Manual JSON cookie export patch**: `parseBulkProfiles()` nhận JSON cookie export Facebook trực tiếp, derive `uid` từ `c_user`, convert thành cookie string, và reuse flow safeStorage hiện có. UI `ProfilesView` cập nhật hướng dẫn/placeholder để user biết có thể paste JSON export trực tiếp.

### File List

- `src/main/db/client.ts` (UPDATE)
- `src/main/db/repositories/profile-repo.ts` (NEW)
- `src/main/profile/parser.ts` (NEW)
- `src/main/profile/profile-service.ts` (NEW)
- `src/main/profile/index.ts` (UPDATE — barrel)
- `src/shared/ipc-schemas/profile.ts` (NEW)
- `src/shared/ipc-schemas/index.ts` (UPDATE — registry + re-export)
- `src/main/ipc/profile-handlers.ts` (NEW)
- `src/main/ipc/index.ts` (UPDATE — barrel)
- `src/main/adapters/electron-bootstrap.ts` (UPDATE)
- `src/renderer/src/api/profile-api.ts` (NEW)
- `src/renderer/src/views/ProfilesView.tsx` (NEW)
- `automation-desktop/.gitignore` (UPDATE — ignore `.phase3-manual/` local manual test data)
- `src/shared/types/secret.ts` (UPDATE — `revealSecret`)
- `src/renderer/src/App.tsx` (UPDATE)
- `tests/unit/profile-parser.spec.ts` (NEW)
- `tests/unit/profile-service.spec.ts` (NEW)
- `tests/unit/secret.spec.ts` (UPDATE)
- `tests/integration/profile-ipc-handlers.spec.ts` (NEW)
- `tests/integration/profile-repo.spec.ts` (NEW)
- `tests/e2e/profiles.spec.ts` (NEW)

### Change Log

- 2026-06-02: Implement story 2.1 — bulk profile import với parser 6/7-field, profile-repo (SQLCipher), profile-service (atomicity, dedupe, secret sink), IPC `phase3:profile:import-bulk`, ProfilesView renderer. 70 tests PASS.
- 2026-06-02: Apply 8 review patches (P1–P8): retryable fix, sanitize failed reason, line-cap→ErrorEnvelope, schema min(1), e2e server close, integration profile-repo real DB, coverage #16/#17/>1MB/error-path, Secret<T> enforce wrap.
- 2026-06-02: Add manual JSON cookie export import support — textarea accepts Facebook JSON cookie export, derives uid from `c_user`, converts to cookie string, updates UI guidance, adds parser/service tests; `.phase3-manual/` ignored to avoid committing local encrypted cookies/secrets.
