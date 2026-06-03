# Story 4.1: Sinh fingerprint diversified per profile

Status: review

Epic: 4 — Lõi Automation Facebook (Self-Comment MVP) · Story: 4.1 · ID: 4.1

## Story

As a user,
I want mỗi profile có fingerprint browser unique và ổn định,
So that Facebook khó mass-detect tài khoản theo cohort (cùng UA/viewport/timezone) — R-D15.

## Acceptance Criteria

- **AC1** — Given một profile (có `id` trong bảng `profiles`), When `fingerprint-generator` chạy cho profile đó, Then sinh ra fingerprint gồm **userAgent, viewport (width/height), timezone (IANA), fonts (subset), WebGL noise** — đầy đủ 5 nhóm field theo FR19.
- **AC2 (Deterministic)** — Given cùng một `profileId`, When gọi `generateFingerprint` nhiều lần, Then output **giống hệt byte-for-byte** (cùng key order). Generator là **pure function** seed CHỈ từ `profileId` — KHÔNG dùng `Math.random()` / `Date.now()` / `crypto.*`. (Lưu ý: `ensureFingerprint` đọc lại qua `FingerprintSchema.parse` nên đảm bảo **deep-equality**, không nhất thiết cùng key-order với chuỗi đã lưu — dùng `toEqual` không dùng so sánh string.)
- **AC3 (Diversified)** — Given **tập id cố định `id-0`..`id-49`** (deterministic, KHÔNG random — tránh test flaky), When generate cho từng id, Then fingerprint **đa dạng**: `Set(webglNoise)` size ≥ 48, ≥2 UA distinct, ≥2 viewport distinct (không phải tất cả trùng 1 giá trị).
- **AC4 (Persist + get-or-create)** — Given profile chưa có fingerprint, When gọi `ensureFingerprint(profileId)`, Then sinh + lưu vào `profile_metadata` (key `fingerprint`, value JSON). When gọi lại lần 2, Then đọc từ DB trả về **đúng giá trị đã lưu** (idempotent, KHÔNG sinh lại / KHÔNG ghi đè vô cớ).
- **AC5 (Self-heal corrupt)** — Given `profile_metadata['fingerprint']` chứa JSON hỏng hoặc sai schema, When gọi `ensureFingerprint`, Then phát hiện invalid → regenerate (deterministic, ra đúng fingerprint chuẩn của profile đó) + ghi đè lại metadata.
- **AC6 (Field validity)** — userAgent non-empty + chứa `Chrome/`; viewport thuộc pool hợp lệ (width/height > 0); timezone là IANA hợp lệ thuộc pool; fonts là mảng non-empty ⊆ font pool; `webglNoise` ∈ [0,1).
- **AC7 (Test coverage)** — Determinism + diversification + field-validity có **unit test**; persist/get-or-create/self-heal có **integration test** (SQLCipher thật + profile-repo thật). Lint + typecheck pass.

## Tasks / Subtasks

- [x] **T1** — `src/shared/types/fingerprint.ts`: định nghĩa `Fingerprint` interface + `FingerprintSchema` (zod) — reusable cho 4.3 (Playwright apply) + IPC tương lai. (AC1, AC6)
- [x] **T2** — `src/main/automation/fingerprint-generator.ts`: PRNG deterministic (hash `profileId` → seed → mulberry32) + `generateFingerprint(profileId: string): Fingerprint` pure. Pool: UA, viewport, timezone, fonts, WebGL. (AC1, AC2, AC3, AC6)
- [x] **T3** — Mở rộng `profile-repo.ts`: thêm `getMetadata(profileId, key): string | undefined` + `setMetadata(profileId, key, value): void` (tái dùng `stmtSetMeta` ON CONFLICT). (AC4)
- [x] **T3b** — 🔴 **MUST**: cập nhật full-mock `createMemoryRepo()` ở `tests/unit/profile-service.spec.ts` — thêm impl in-memory cho `getMetadata`/`setMetadata`, nếu không **typecheck FAIL** (mock thiếu method của interface). Verify bằng `npm run typecheck` ngay sau T3. (M5)
- [x] **T4** — `src/main/automation/fingerprint-service.ts`: `createFingerprintService(deps: { profileRepo: Pick<ProfileRepository, 'getMetadata' | 'setMetadata'> })` → `ensureFingerprint(profileId): Fingerprint` (get-or-create + self-heal qua `FingerprintSchema.safeParse`). **Dùng `Pick<>`** để mock test chỉ cần 2 method (giống `proxy-pool` dùng `Pick<ProxyService,'rotate'>`). (AC4, AC5)
- [x] **T5** — `src/main/automation/index.ts`: barrel export generator + service + types. (rule #21) → để 4.3 import + wire vào bootstrap khi có consumer.
- [x] **T6** — Tests: `tests/unit/fingerprint-generator.spec.ts` (AC2/AC3/AC6) + `tests/integration/fingerprint-service.spec.ts` (AC4/AC5). (AC7)
- [x] **T7** — Verify: `npm run lint` + `npm run typecheck` (gồm mock đã sửa T3b) + chạy 2 file test mới PASS + chạy `profile-service.spec.ts` (regression mock). (AC7)

> **D1 (defer):** KHÔNG wire `fingerprint-service` vào `electron-bootstrap.ts` ở 4.1 — KHÁC `proxyPool` (3.3 có IPC handler nên reachable), fingerprint 4.1 **không có consumer** (no IPC/automation) → wire = dead weight + đụng file security-sensitive vô ích. Epic **4.3** sẽ import từ barrel + wire khi `playwright-runner` thực sự gọi `ensureFingerprint`.

## Dev Notes

### ⚠️ ĐỌC TRƯỚC: `automation-desktop/CLAUDE.md` (25 rules) + `automation-desktop/project-context.md`

Story này là **pure main-process infra** — KHÔNG đụng Electron API trực tiếp (generator/service là pure TS + SQLite repo). KHÔNG cần adapter cho phần này.

### Bản chất: deterministic generator + persistence (get-or-create)

AC2 "deterministic across sessions" đạt bằng **2 lớp**:
1. **Generator pure-deterministic**: `generateFingerprint(profileId)` chỉ phụ thuộc `profileId` → gọi bao nhiêu lần cũng ra y hệt, kể cả khi metadata bị xóa (self-heal AC5 regenerate ra đúng giá trị cũ).
2. **Persistence**: `ensureFingerprint` lưu JSON vào `profile_metadata` để 4.3 đọc nhanh, không phải tính lại mỗi session.

> ⚠️ TUYỆT ĐỐI KHÔNG dùng `Math.random()` / `Date.now()` / `crypto.randomUUID()` trong generator — sẽ phá determinism + phá test. Seed CHỈ từ `profileId`.

### PRNG deterministic (gợi ý implement)

```ts
// hash chuỗi → uint32 seed (FNV-1a hoặc cyrb53). Ví dụ cyrb53:
function seedFromProfileId(profileId: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < profileId.length; i++) {
    const ch = profileId.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  return (h1 >>> 0)
}
// mulberry32: PRNG deterministic, trả [0,1)
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
// pick deterministic từ pool
function pick<T>(rng: () => number, pool: readonly T[]): T {
  return pool[Math.floor(rng() * pool.length)]
}
```

Trong `generateFingerprint`: tạo `const rng = mulberry32(seedFromProfileId(profileId))` rồi `pick(rng, UA_POOL)`, `pick(rng, VIEWPORT_POOL)`, `pick(rng, TIMEZONE_POOL)`, [chọn fonts], cuối cùng `webglNoise = rng()`. **Thứ tự gọi `rng()` PHẢI cố định** (đổi thứ tự = đổi fingerprint của mọi profile đã lưu → vỡ determinism lịch sử). Nếu cần thêm field tương lai → APPEND cuối + bump `FINGERPRINT_VERSION`, KHÔNG chèn giữa.

> 🔴 **M1 (fonts — số draw `rng()` PHẢI cố định):** chọn subset font bằng cách **duyệt TOÀN BỘ `FONT_OPTIONAL_POOL`, mỗi font gọi đúng 1 `rng()`** (include nếu `rng() < 0.5`), rồi `fonts = [...FONT_CORE, ...included]`. KHÔNG dùng vòng lặp biến độ dài kiểu `k = floor(rng()*n); for i<k` — vì tuy `k` deterministic, pattern này dễ khiến dev vô tình đổi số draw → dịch vị trí stream → `webglNoise` (draw cuối) đổi → vỡ determinism. Cố định = `FONT_OPTIONAL_POOL.length` draw, bất kể kết quả include.

### Fingerprint shape (đề xuất — đúng FR19)

```ts
export const FINGERPRINT_VERSION = 1 as const
export interface Fingerprint {
  version: number             // = FINGERPRINT_VERSION; forward-compat cho self-heal migration (M2)
  userAgent: string
  viewport: { width: number; height: number }
  timezone: string            // IANA, vd 'Asia/Ho_Chi_Minh'
  fonts: string[]             // subset deterministic ⊆ FONT_POOL, luôn non-empty
  webglNoise: number          // [0,1), seed cho canvas/WebGL noise khi 4.3 inject
}
```

> **M2 (forward-compat):** `version` cho phép migration sạch. `FingerprintSchema` nên check `version: z.literal(FINGERPRINT_VERSION)` → khi bump generator (đổi pool/thêm field) tăng `FINGERPRINT_VERSION` → JSON cũ `safeParse` fail version → self-heal regenerate (AC5). KHÔNG đặt field mới là `.optional()` nếu muốn regenerate; muốn giữ fingerprint cũ ổn định thì APPEND field + giữ version cũ hợp lệ qua `z.union`. `version` KHÔNG tiêu thụ `rng()` (gán hằng, đặt đầu object).

### Pools (curated, realistic)

- **UA_POOL**: 6–10 UA Chrome-on-Windows **THẬT**. ⚠️ **Cross-story (4.3)**: UA `Chrome/<major>` PHẢI khớp Chromium version Playwright bundle khi 4.3 launch — UA major lệch với engine thật = red flag detect. Dev note: 4.1 dùng pool tĩnh; **4.3 PHẢI reconcile** (hoặc patch UA major theo `chromium.executablePath()` version lúc launch). Ghi rõ ràng comment cảnh báo trong UA_POOL.
- **VIEWPORT_POOL**: desktop phổ biến — `[1920×1080, 1536×864, 1366×768, 1440×900, 1600×900, 1280×720]`.
- **TIMEZONE_POOL**: ⚠️ stealth-coherence — user proxy là **residential VN** (architecture §856/922). VN IP + US timezone = bất thường. → pool **ưu tiên `Asia/Ho_Chi_Minh`** (weight cao), thêm vài tz Đông Nam Á làm nhiễu nhẹ. Coherence chính xác theo proxy geo = **defer** (note Epic sau). KHÔNG dùng tz Âu/Mỹ ngẫu nhiên.
- **FONT_CORE** (luôn có): font Windows mặc định luôn cài — `['Arial', 'Calibri', 'Segoe UI', 'Times New Roman', 'Verdana']`. **FONT_OPTIONAL_POOL** (include theo `rng()`, 1 draw/font — xem M1): `['Cambria', 'Tahoma', 'Georgia', 'Trebuchet MS', 'Consolas', 'Comic Sans MS']`. `fonts = [...FONT_CORE, ...included]` → luôn non-empty (≥5).
- **WEBGL**: `webglNoise = rng()` (float ổn định per profile). (vendor/renderer GPU string → defer 4.3 nếu cần; 4.1 chỉ cần noise seed theo AC).

### profile_metadata — đã sẵn sàng

`src/main/db/client.ts:34` đã tạo `profile_metadata(profile_id, key, value, PRIMARY KEY(profile_id, key))`. `profile-repo.ts` đã có `stmtSetMeta` (ON CONFLICT upsert) nhưng **CHƯA expose public method** → T3 thêm:

```ts
// thêm vào interface ProfileRepository:
getMetadata(profileId: string, key: string): string | undefined
setMetadata(profileId: string, key: string, value: string): void
// impl: dùng stmtSetMeta sẵn có cho set; thêm stmtGetMeta cho get
const stmtGetMeta = db.prepare<[string, string], { value: string }>(
  'SELECT value FROM profile_metadata WHERE profile_id = ? AND key = ?'
)
```

> KHÔNG đổi `insertProfileAtomic` / các method 2.x — chỉ ADD. Giữ regression import-bulk (2.1) + edit/delete (2.3).

### Service get-or-create + self-heal (AC4/AC5)

```ts
const FINGERPRINT_KEY = 'fingerprint'
// deps.profileRepo: Pick<ProfileRepository, 'getMetadata' | 'setMetadata'>  (M5 — giảm mock surface)
function ensureFingerprint(profileId: string): Fingerprint {
  const stored = deps.profileRepo.getMetadata(profileId, FINGERPRINT_KEY)
  if (stored) {
    try {
      const parsed = FingerprintSchema.safeParse(JSON.parse(stored))
      if (parsed.success) return parsed.data            // AC4 idempotent (version khớp → giữ nguyên)
    } catch { /* JSON hỏng → fall through regenerate */ }
  }
  const fp = generateFingerprint(profileId)             // AC5 self-heal (deterministic, version mới)
  deps.profileRepo.setMetadata(profileId, FINGERPRINT_KEY, JSON.stringify(fp))
  return fp
}
```

### Secret marker — KHÔNG cần

Fingerprint KHÔNG phải secret (không cookie/password/2FA). Lưu plaintext `profile_metadata` OK, tương lai qua IPC OK. KHÔNG wrap `Secret<T>` (rule #10 chỉ cho cookie/2FA/password/proxy-cred).

### Edge cases

- **Seed = `profiles.id`** (UUID nội bộ từ import 2.1), KHÔNG phải `uid` (FB account). Caller (4.3 + integration test) truyền `profiles.id`.
- `profileId` rỗng → generator vẫn pure (seed của '' là hằng số) nhưng caller (4.3) luôn truyền id thật; KHÔNG cần validate trong generator. Service `ensureFingerprint` cũng không tự check profile tồn tại (caller's concern — integration test insert profile trước).
- JSON hỏng / `version` không khớp → `safeParse` fail → regenerate (AC5). Generator deterministic nên regenerate ra đúng fingerprint chuẩn (version hiện tại) của profile.
- **Pool đổi KHÔNG hồi tố**: nếu sau này sửa UA_POOL/thêm font, profile **đã có** fingerprint trong DB vẫn giữ giá trị cũ (ensureFingerprint idempotent, không regenerate khi version còn khớp). Chỉ profile mới / version bump mới nhận pool mới. → ổn định cho user hiện hữu (đúng mong muốn).
- Pool index: `Math.floor(rng()*len)` — `rng()` ∈ [0,1) nên index ∈ [0,len-1], không tràn.
- Determinism collision: 2 profileId khác nhau có thể trùng vài field (vd cùng viewport) — bình thường (pool nhỏ); `webglNoise` (float 32-bit) gần như unique → AC3 dùng webglNoise làm thước đo diversification chính.

### Scope — KHÔNG làm

- KHÔNG launch Playwright / apply fingerprint vào BrowserContext (Epic 4.3 playwright-runner — inject UA/viewport/tz/WebGL khi `chromium.launch`).
- KHÔNG patch UA major theo Chromium thật (4.3 reconcile — chỉ ghi note cảnh báo ở 4.1).
- KHÔNG IPC / KHÔNG UI (fingerprint là infra; ProfilesView hiển thị fingerprint = defer nếu cần).
- KHÔNG state machine (4.2), KHÔNG login/cookie (4.3), KHÔNG token (4.4/4.5).
- KHÔNG cài `playwright` / `playwright-extra` dep (Epic 4.3).
- KHÔNG đụng proxy/breaker (3.x), license (1.x).

### Files

| File | Action | Ghi chú |
|---|---|---|
| `src/shared/types/fingerprint.ts` | NEW | `Fingerprint` interface + `FingerprintSchema` (zod v4) |
| `src/main/automation/fingerprint-generator.ts` | NEW | PRNG + pools + `generateFingerprint` pure |
| `src/main/automation/fingerprint-service.ts` | NEW | `createFingerprintService` + `ensureFingerprint` |
| `src/main/automation/index.ts` | UPDATE | barrel export generator + service + types (đang `export {}`) |
| `src/main/db/repositories/profile-repo.ts` | UPDATE | + `getMetadata` / `setMetadata` (chỉ ADD vào interface + impl) |
| `tests/unit/profile-service.spec.ts` | UPDATE | 🔴 M5 — `createMemoryRepo()` thêm impl `getMetadata`/`setMetadata` (nếu không typecheck FAIL) |
| ~~`src/main/adapters/electron-bootstrap.ts`~~ | — | **DEFER 4.3** (D1 — chưa có consumer, không wire ở 4.1) |
| `tests/unit/fingerprint-generator.spec.ts` | NEW | AC2/AC3/AC6 |
| `tests/integration/fingerprint-service.spec.ts` | NEW | AC4/AC5 (SQLCipher + profile-repo thật) |

### Previous story intelligence (3.x + 2.x)

- **profile-repo** (2.1/2.3): `insertProfileAtomic` đã ghi metadata khi import; PK(profile_id,key) + ON CONFLICT upsert sẵn. Tái dùng pattern `stmt*` + `db.prepare`. Test integration mở DB SQLCipher thật (xem `tests/integration/settings-repo.spec.ts` / `proxy-ipc-handlers.spec.ts` làm mẫu setup tmpdir + key).
- **Pure-deterministic + injected-dependency** (3.2 circuit-breaker injected clock): cùng triết lý — generator nhận seed từ input, không side-effect → test ổn định. Áp dụng y hệt.
- **Barrel + 1 folder/domain** (rule #21, proxy/ 3.x): `automation/index.ts` export generator + service + re-export types.
- **138 test đang PASS** — đừng phá. Chạy full unit+integration sau khi xong.

### Testing chi tiết (AC7)

**unit/fingerprint-generator.spec.ts:**
- `[P0] deterministic`: `generateFingerprint('id-x')` toEqual lần 2 (deep) + `JSON.stringify` 2 lần giống nhau byte-for-byte (cùng key order).
- `[P0] diversified`: **id cố định `id-0`..`id-49`** (KHÔNG random) → `Set(webglNoise)` size ≥ 48 + ≥2 UA distinct + ≥2 viewport distinct.
- `[P0] field validity`: `version === FINGERPRINT_VERSION`; UA match `/Chrome\//`; viewport ∈ VIEWPORT_POOL & w/h > 0; timezone ∈ TIMEZONE_POOL & `Intl.DateTimeFormat(undefined,{timeZone})` không throw; fonts ⊇ FONT_CORE & ⊆ (FONT_CORE∪FONT_OPTIONAL_POOL) & length≥5; webglNoise ∈ [0,1).
- `[P0] fonts fixed-draw (M1)`: 2 profile có set include khác nhau nhưng `webglNoise` vẫn là draw cuối ổn định — assert `generateFingerprint(id)` lặp lại bằng nhau (đã cover ở deterministic; thêm comment nhắc rationale).
- `[P0] schema round-trip`: `FingerprintSchema.parse(generateFingerprint(id))` ok.

**integration/fingerprint-service.spec.ts** (mở SQLCipher tmpdir + profile-repo + insert 1 profile):
- `[P0] ensureFingerprint persists + idempotent`: gọi lần 1 → `profile_metadata['fingerprint']` có JSON; gọi lần 2 → toEqual lần 1 & **không đổi DB value** (so sánh string trước/sau).
- `[P0] self-heal corrupt`: `setMetadata(id,'fingerprint','{broken')` → `ensureFingerprint` → trả fp hợp lệ = `generateFingerprint(id)` & DB value đã ghi đè JSON hợp lệ.
- `[P1] getMetadata/setMetadata round-trip`: set rồi get trả đúng value; get key không tồn tại → `undefined`.

## References

- [Source: epics-phase3.md#Story-4.1 (L358-369)] — AC gốc (UA/viewport/timezone/font/WebGL, deterministic)
- [Source: epics-phase3.md#FR19 (L48)] — fingerprint diversified per user
- [Source: architecture.md#R-D15 (L1014-1015)] — fingerprint diversification + canary cohort
- [Source: architecture.md (L1821)] — `main/automation/fingerprint-generator.ts`
- [Source: architecture.md (L1956)] — R-D15 mapping file
- [Source: architecture.md (L1400)] — `profile_metadata(profile_id, key, value)`
- [Source: architecture.md (L856,922)] — residential VN proxy → timezone coherence
- [Source: src/main/db/client.ts:34] — schema profile_metadata PK(profile_id,key)
- [Source: src/main/db/repositories/profile-repo.ts] — stmtSetMeta sẵn (extend get/set)
- [Source: automation-desktop/CLAUDE.md + project-context.md] — 25 rules

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Early G1 verification after T3/T3b: `npm run typecheck` PASS.
- Targeted Story 4.1 + mock regression: `npx playwright test tests/unit/fingerprint-generator.spec.ts tests/integration/fingerprint-service.spec.ts tests/unit/profile-service.spec.ts --reporter=line` PASS `23/23`.
- Lint: `npm run lint` PASS `0 errors` (existing module-type warning only).
- Typecheck: `npm run typecheck` PASS.
- Full non-E2E regression: `npx playwright test tests/unit tests/integration tests/api tests/component --reporter=line` PASS `146/146`.
- Full E2E regression after build: `npm run build && PHASE3_USER_DATA_PATH="$(mktemp -d)" npx playwright test tests/e2e --workers=1 --reporter=line` PASS `19/19`.
- Purity grep: `grep -rE "Math.random|Date.now|crypto\." src/main/automation/` returned no matches.

### Completion Notes List

- Added `Fingerprint` + `FingerprintSchema` with `version: FINGERPRINT_VERSION` guard for future self-heal migrations.
- Implemented deterministic `generateFingerprint(profileId)` using cyrb53-style seed + mulberry32, curated Chrome-on-Windows UA pool, desktop viewport pool, VN/SEA timezone pool, fixed-draw font subset, and final `webglNoise` draw.
- Extended `ProfileRepository` with `getMetadata`/`setMetadata` only; existing import/edit/delete behavior unchanged.
- Updated `createMemoryRepo()` in `profile-service.spec.ts` immediately and verified typecheck to satisfy G1.
- Added `createFingerprintService({ profileRepo: Pick<...> })` with get-or-create persistence and corrupt/version-invalid self-heal.
- Exported automation barrel for Epic 4.3 consumption without wiring bootstrap, IPC, UI, Playwright, proxy, or license.
- Added deterministic/diversification/field/schema unit tests and Electron-runtime SQLCipher integration fixture for real repo/service persistence without native ABI rebuild churn.

### File List

- automation-desktop/src/shared/types/fingerprint.ts
- automation-desktop/src/main/automation/fingerprint-generator.ts
- automation-desktop/src/main/automation/fingerprint-service.ts
- automation-desktop/src/main/automation/index.ts
- automation-desktop/src/main/db/repositories/profile-repo.ts
- automation-desktop/tests/unit/profile-service.spec.ts
- automation-desktop/tests/unit/fingerprint-generator.spec.ts
- automation-desktop/tests/integration/fingerprint-service.spec.ts
- automation-desktop/tests/fixtures/fingerprint-service-electron-entry.ts
- _bmad-output/implementation-artifacts/4-1-sinh-fingerprint-diversified-per-profile.md
- _bmad-output/implementation-artifacts/sprint-status-phase3.yaml

### Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-06-03 | 0.1 | Story created (bmad-create-story) — fingerprint-generator deterministic per profile | Luisphan |
| 2026-06-03 | 0.2 | Story review patches: M5 (mock `createMemoryRepo` + `Pick<>` deps), M1 (fonts fixed rng-draw), M4 (test id cố định), M2 (`version` field forward-compat), M3 (clarify AC2 byte-for-byte vs zod re-parse), D1 (defer bootstrap wiring → 4.3) | Luisphan |
| 2026-06-03 | 1.0 | Implemented deterministic fingerprint generator/service, profile metadata repository methods, and full AC7 test coverage; moved to review | Codex |
