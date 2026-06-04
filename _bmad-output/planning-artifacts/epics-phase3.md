---
stepsCompleted: ['step-01-validate-prerequisites.md', 'step-02-design-epics.md', 'step-03-create-stories.md', 'step-04-final-validation.md']
status: 'complete'
completedAt: '2026-06-01'
inputDocuments: ['_bmad-output/planning-artifacts/prd-phase3.md', '_bmad-output/planning-artifacts/architecture.md (Phase 3 Addendum)']
phase: 'phase-3'
parentEpics: '_bmad-output/planning-artifacts/epics.md'
releaseMode: 'phased'
---

# Phase 3: Facebook Cookie-Based Automation Desktop - Epic Breakdown

## Overview

Document này decompose requirements từ `prd-phase3.md` (37 FR + 30 NFR) và `architecture.md` § Phase 3 Addendum (11 ADR-D + 16 R-D anchor) thành epics & stories implementable. Phased delivery: Phase 3.0 (MVP) → 3.1 → 3.2 → 3.3 → 3.4 (optional).

KHÔNG đụng `epics.md` (Phase 1+2 epics, độc lập).

## Requirements Inventory

### Functional Requirements

**Profile Management**
- FR1: User import bulk profile FB theo format `uid|pass|2fa|cookie|hotmail|passmail`
- FR2: User xem/sửa/xóa profile và metadata (proxy, fingerprint)
- FR3: User xem trạng thái real-time từng profile (idle, running, checkpoint, error)
- FR4: Hệ thống lưu cookie + 2FA seed trong OS keychain, metadata trong DB mã hóa

**Licensing & Access Control**
- FR5: User kích hoạt license bằng key, bind HWID
- FR6: Hệ thống check license online định kỳ + offline grace tier 1
- FR7: Hệ thống cấp token server-side cho action tier 2+ (post/comment/share)
- FR8: User gia hạn, rebind HWID (giới hạn lần/năm), pause license qua self-service portal
- FR9: Admin tạo license key với số ngày tùy chỉnh + thu hồi
- FR10: Hệ thống block action khi license hết hạn, read-only grace 7 ngày để export

**Facebook Automation Engine**
- FR11: Hệ thống login FB bằng cookie + xử lý 2FA/checkpoint
- FR12: Hệ thống trích xuất CSRF token (fb_dtsg/lsd/jazoest) qua HTTP
- FR13: User chạy self-comment trên post của chính profile (validation action)
- FR14: User chạy mass post lên timeline profile *(Phase 3.1)*
- FR15: User chạy mass comment 3rd party post + mass react *(Phase 3.2)*
- FR16: User chạy share + friend request *(Phase 3.3)*
- FR17: Hệ thống warmup behavior trước action thật *(Phase 3.1)*
- FR18: Hệ thống quản lý job automation qua state machine với checkpoint/resume

**Anti-Detection & Resilience**
- FR19: Hệ thống fingerprint diversified per user (UA, viewport, timezone, font, WebGL)
- FR20: Hệ thống resolve selector 4-tier fallback (ARIA → testid → text → visual)
- FR21: Hệ thống pull hot config selector Ed25519 + verify signature
- FR22: Hệ thống apply hot config canary cohort 5% trước rollout
- FR23: Hệ thống canary profile phát hiện detection drift sớm

**Proxy Management**
- FR24: User cấu hình + xoay proxy đa provider (proxyfb, tmproxy, shoplike)
- FR25: Hệ thống health-check proxy + circuit-break provider lỗi
- FR26: Hệ thống bind proxy riêng mỗi profile session

**Updates & Distribution**
- FR27: Hệ thống auto check + cài update qua kênh đã ký số
- FR28: Hệ thống force update khi version < min_supported
- FR29: Admin publish app version + release notes + set min_supported_version

**Telemetry & Observability**
- FR30: Hệ thống gửi beacon ẩn danh bắt buộc sau accept EULA
- FR31: User bật/tắt telemetry chi tiết (opt-in, default off)
- FR32: Admin xem dashboard SLO (success rate, checkpoint rate, drift alert)

**Backup & Recovery**
- FR33: User export profile + state ra file mã hóa với passphrase
- FR34: User import backup khôi phục trên máy mới
- FR35: Hệ thống nhắc backup định kỳ

**Compliance & Onboarding**
- FR36: User accept EULA (acknowledge FB ToS risk) trước khi dùng
- FR37: Hệ thống hiển thị privacy policy + phạm vi telemetry minh bạch

### NonFunctional Requirements

**Performance**: NFR1 cold start <5s; NFR2 self-comment <60s; NFR3 ≥10 profile session/8GB RAM; NFR4 hot config apply <3s; NFR5 IPC <100ms
**Security**: NFR6 cookie safeStorage; NFR7 SQLCipher AES-256; NFR8 log redaction; NFR9 Ed25519 verify; NFR10 cert pinning; NFR11 sandbox+contextIsolation; NFR12 bytenode sensitive; NFR13 backup AES-256-GCM PBKDF2
**Reliability (Adapt Time SLO)**: NFR14 drift detect <24h; NFR15 hot config fix <1h; NFR16 success rate ≥85%; NFR17 crash-free ≥95%; NFR18 license uptime ≥99% + offline grace 24h; NFR19 state machine resume
**Compliance & Privacy**: NFR20 telemetry anonymous; NFR21 EULA gate telemetry; NFR22 Nghị định 13; NFR23 billing entity tách
**Maintainability**: NFR24 adapter layer; NFR25 Zod 2-way; NFR26 coverage ≥70%; NFR27 lint rules
**Localization**: NFR28 VN lock Phase 3.0-3.4
**Compatibility**: NFR29 Win10+/macOS12+; NFR30 update adoption ≥90% trong 7 ngày

### Additional Requirements (từ Architecture)

**Starter Template (CRITICAL — Epic 1 Story 1):**
- `npm create @quick-start/electron@latest automation-desktop -- --template react-ts` (electron-vite scaffold)
- Restructure sang folder layout: `adapters/` + `main/` + `preload/` + `renderer/` + `shared/`
- Security baseline override: sandbox: true, contextIsolation, CSP, cert pinning
- Wire ESLint custom rules (no-restricted-imports, no-secret-in-ipc-payload, no-secret-tostring, no-direct-logger)

**Infrastructure:**
- Backend extend: `backend/app/api/automation.py` router + `backend/app/services/automation/*` + Alembic migration `phase3` schema (6 tables)
- Client SQLite (SQLCipher): profiles, profile_metadata, automation_jobs, job_actions, canary_state, local_telemetry_buffer, local_settings
- Polyglot boundary: Electron (TS) ↔ FastAPI (Python) qua HTTPS REST + cert pinning
- IPC contract: typed adapter + Zod schema, channel format `phase3:<domain>:<verb>`
- 11 ADR-D quyết định (xem architecture.md): D1 Electron, D2 license, D3 storage, D4 hot config, D5 update, D6 telemetry, D7 data model, D8 IPC, D9 backend deploy, D10 distribution, D11 backup
- State machine: PENDING → ACQUIRING_PROXY → LOGGING_IN → SOLVING_CHECKPOINT → WARMING_UP → EXECUTING → DONE/CHECKPOINT_BLOCKED/FAILED/CANCELLED/LICENSE_EXPIRED_READ_ONLY

**Distribution:**
- electron-builder (Mac dmg + Win nsis + Linux AppImage)
- GitHub Releases (private beta/canary + public stable) + S3 mirror
- Code sign: Apple Developer + Windows EV cert; notarization
- 16 R-D risk anchors (xem architecture.md § Risk Mitigation Anchors)

### UX Design Requirements

Không có UX Design document riêng. UX cho Phase 3.0 = 5 view đơn giản (Dashboard, ProfilesView, LicenseView, SettingsView, LogsView) + EulaAcceptanceView, đã mô tả trong PRD § User Journeys + architecture § folder structure. UI lock tiếng Việt (NFR28).

### FR Coverage Map

| Epic | FRs | Phase |
|---|---|---|
| 1 Foundation & Licensing | FR5, FR6, FR9, FR10, FR36, FR37 | 3.0 |
| 2 Profile Management | FR1, FR2, FR3, FR4 | 3.0 |
| 3 Proxy Management | FR24, FR25, FR26 | 3.0 |
| 4 Automation Core (Self-Comment) | FR7, FR11, FR12, FR13, FR18, FR19 | 3.0 |
| 5 Adaptive Resilience | FR20, FR21, FR22, FR23 | 3.0 |
| 6 Observability & Telemetry | FR30, FR31, FR32 | 3.0 |
| 7 Backup & Recovery | FR8, FR33, FR34, FR35 | 3.0 |
| 8 Distribution & Auto-Update | FR27, FR28, FR29 | 3.0 |
| 9 Mass Post & Warmup | FR14, FR17 | 3.1 |
| 10 Mass Comment & React | FR15 | 3.2 |
| 11 Share & Friend Request | FR16 | 3.3 |

✅ 37/37 FR mapped. Feed scrape (3.4) = Vision/optional, không có FR riêng.

## Epic List

### Epic 1: Nền tảng App & Cấp phép (Foundation & Licensing) — Phase 3.0
App chạy được (dev-installable), user accept EULA, activate license bằng key (HWID bind), và thấy trạng thái license. Bao gồm scaffold electron-vite, adapter layer (R-D16), IPC contract + Zod, SQLCipher DB, security baseline (sandbox/CSP/cert pinning), backend `/api/v1/automation/license/*` endpoints. *(Production-installable — signed installer — do Epic 8 hoàn thiện.)*
**FRs covered:** FR5, FR6, FR9, FR10, FR36, FR37

### Epic 2: Quản lý Profile (Profile Management) — Phase 3.0
User import bulk profile FB (format `uid|pass|2fa|cookie|...`), xem/sửa/xóa, xem trạng thái real-time, với cookie + 2FA seed lưu an toàn trong OS keychain (safeStorage) và metadata trong DB mã hóa.
**FRs covered:** FR1, FR2, FR3, FR4

### Epic 3: Quản lý Proxy (Proxy Management) — Phase 3.0
User cấu hình + xoay proxy qua provider (proxyfb cho 3.0), health-check + circuit-break provider lỗi, bind proxy riêng mỗi profile session.
**FRs covered:** FR24, FR25, FR26

### Epic 4: Lõi Automation Facebook — Self-Comment (Automation Core MVP) — Phase 3.0
User chạy self-comment validate toàn stack: login cookie + xử lý 2FA/checkpoint + token extraction (fb_dtsg/lsd/jazoest) + state machine + fingerprint diversified + per-action server token. MVP validation action low blast radius.
**FRs covered:** FR7, FR11, FR12, FR13, FR18, FR19

### Epic 5: Khả năng Tự phục hồi (Adaptive Resilience) — Phase 3.0 ⭐
Tool tự phục hồi khi FB đổi DOM: selector 4-tier fallback (ARIA → testid → text → visual) + hot config Ed25519 signed + canary cohort 5% + drift detection. Đây là differentiator cốt lõi (adapt time < 1h).
**FRs covered:** FR20, FR21, FR22, FR23

### Epic 6: Giám sát & Telemetry (Observability) — Phase 3.0
Admin xem dashboard SLO (success rate, checkpoint rate, drift alert), user kiểm soát telemetry. Mandatory anonymous beacon + opt-in detail, backend telemetry endpoint, Grafana dashboard.
**FRs covered:** FR30, FR31, FR32

### Epic 7: Sao lưu & Khôi phục (Backup & Recovery) — Phase 3.0
User backup/restore profile mã hóa (`.p3backup` AES-256-GCM passphrase), HWID rebind (2 free/năm), gia hạn/pause license qua self-service portal web.
**FRs covered:** FR8, FR33, FR34, FR35

### Epic 8: Phân phối & Tự cập nhật (Distribution & Auto-Update) — Phase 3.0
User nhận installer đã ký số (Mac notarized + Win signed), auto-update, forced update khi version < min_supported. electron-updater + double-sign + cert pinning + GitHub Releases + S3 mirror.
**FRs covered:** FR27, FR28, FR29

### Epic 9: Mass Post & Warmup — Phase 3.1
User chạy mass post lên timeline profile + warmup behavior (mô phỏng người dùng). Thêm proxy provider thứ 2 (tmproxy).
**FRs covered:** FR14, FR17

### Epic 10: Mass Comment & React — Phase 3.2
User chạy mass comment trên post bên thứ ba + mass react. Thêm proxy provider thứ 3 (shoplike).
**FRs covered:** FR15

### Epic 11: Share & Friend Request — Phase 3.3
User chạy share + friend request automation (action pattern rủi ro cao nhất).
**FRs covered:** FR16

> **Phase 3.4 (Vision/optional):** Feed scrape — defer đến khi có use case cụ thể, không có FR riêng.

---

## Epic 1: Nền tảng App & Cấp phép (Foundation & Licensing)

User cài được app, accept EULA, activate license và thấy trạng thái license. Foundational epic thiết lập scaffold + adapter + security baseline + backend license endpoints.

### Story 1.1: Khởi tạo scaffold automation-desktop

As a developer,
I want một Electron desktop app shell chạy được ở dev mode với security baseline và adapter layer,
So that mọi feature sau có nền tảng nhất quán để build.

**Acceptance Criteria:**

**Given** repo mono `auto-crawl-tiktok-post-fb`
**When** chạy `npm create @quick-start/electron@latest automation-desktop -- --template react-ts` và restructure theo layout `adapters/ + main/ + preload/ + renderer/ + shared/`
**Then** app khởi động ở dev mode với Vite HMR hoạt động trên cả 3 layer (main/preload/renderer)
**And** security baseline được áp dụng: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, CSP headers
**And** ESLint custom rules được wire: no-restricted-imports (cấm `electron` ngoài adapters/+preload/), no-secret-in-ipc-payload, no-secret-tostring, no-direct-logger
**And** adapter interfaces (ipc, secure-storage, updater, window) + Electron stub impl tồn tại
**And** SQLCipher client (better-sqlite3-multiple-ciphers) khởi tạo được DB mã hóa

### Story 1.2: Accept EULA lần đầu chạy

As a user,
I want được hiển thị EULA và phải accept trước khi dùng app,
So that tôi hiểu rủi ro FB ToS và trách nhiệm của mình (tool vendor model).

**Acceptance Criteria:**

**Given** app chạy lần đầu (chưa có `local_settings.eula_accepted_version`)
**When** app khởi động
**Then** EulaAcceptanceView hiển thị nội dung EULA tiếng Việt (acknowledge rủi ro FB ToS) + link privacy policy
**And** user không thể sang view khác cho đến khi accept
**When** user accept
**Then** `local_settings.eula_accepted_version` được lưu, mandatory telemetry beacon được kích hoạt (NFR21)
**And** lần khởi động sau không hiện lại EULA trừ khi version EULA tăng

### Story 1.3: Activate license với HWID binding

As a user,
I want kích hoạt app bằng license key gắn với máy của tôi,
So that tôi có quyền sử dụng tool trong số ngày đã mua.

**Acceptance Criteria:**

**Given** user có license key hợp lệ
**When** user nhập key vào LicenseView
**Then** client tính HWID = SHA-256(machine_uuid + mac + cpu_brand) và gửi `POST /api/v1/automation/license/activate`
**And** server bind HWID, compute expires_at theo days, trả activation_id
**And** LicenseView hiển thị "License active: còn N ngày"
**When** key đã activate trên HWID khác
**Then** server trả lỗi `LICENSE_HWID_MISMATCH` và client hiển thị hướng dẫn rebind

### Story 1.4: Kiểm tra license định kỳ + xử lý hết hạn

As a user,
I want app tự kiểm tra license và xử lý hợp lý khi offline hoặc hết hạn,
So that tôi dùng được offline ngắn hạn nhưng không lạm dụng license hết hạn.

**Acceptance Criteria:**

**Given** license đã activate
**When** background worker chạy mỗi 4h
**Then** client gọi `POST /api/v1/automation/license/check`
**And** nếu online check fail, tier 1 action vẫn chạy trong offline grace 24h sau lần success cuối (NFR18)
**When** license hết hạn (quá expires_at)
**Then** mọi action bị block; state machine vào `LICENSE_EXPIRED_READ_ONLY`; cho phép read-only grace 7 ngày để export backup
**And** sau 7 ngày chỉ LicenseView active, các view khác disabled

### Story 1.5: Admin tạo và thu hồi license key

As an admin (Luisphan),
I want tạo license key với số ngày tùy chỉnh và thu hồi key,
So that tôi quản lý được khách hàng và doanh thu.

**Acceptance Criteria:**

**Given** admin đăng nhập web dashboard (reuse Phase 1+2 auth + RBAC)
**When** admin mở LicenseManagement và tạo key với days=N
**Then** `POST /api/v1/automation/admin/license` tạo record trong `phase3.licenses`, trả key cho admin copy
**When** admin thu hồi 1 license
**Then** license bị đánh dấu revoked; lần check tiếp theo của client trả `LICENSE_REVOKED` và block action

## Epic 2: Quản lý Profile (Profile Management)

User import bulk, xem, sửa, xóa profile FB với cookie/2FA lưu an toàn.

### Story 2.1: Import bulk profile

As a user,
I want paste danh sách profile FB theo format `uid|pass|2fa|cookie|hotmail|passmail`,
So that tôi nhập nhanh hàng loạt tài khoản đã nuôi sẵn.

**Acceptance Criteria:**

**Given** user mở BulkImportModal trong ProfilesView
**When** user paste nhiều dòng theo format `uid|pass|2fa|cookie|hotmail|passmail`
**Then** parser tách từng field; cookie + 2FA seed lưu vào OS keychain (safeStorage); metadata (uid, name) lưu SQLCipher `profiles` (FR4, NFR6)
**And** dòng sai format được báo lỗi rõ, không block dòng hợp lệ
**And** cookie KHÔNG bao giờ xuất hiện trong log (qua redaction middleware)

### Story 2.2: Xem danh sách profile với trạng thái real-time

As a user,
I want xem danh sách profile và trạng thái hiện tại của từng cái,
So that tôi biết profile nào đang chạy, lỗi, hay checkpoint.

**Acceptance Criteria:**

**Given** đã có profile trong DB
**When** user mở ProfilesView
**Then** hiển thị list profile với status (idle, running, checkpoint, error) cập nhật real-time
**And** UI poll status qua IPC `phase3:profile:list` + `phase3:automation:status`
**And** không hiển thị cookie/password (chỉ uid + name + status)

### Story 2.3: Sửa và xóa profile

As a user,
I want sửa metadata hoặc xóa profile,
So that tôi quản lý vòng đời tài khoản.

**Acceptance Criteria:**

**Given** profile tồn tại
**When** user sửa proxy assignment hoặc fingerprint metadata
**Then** thay đổi lưu vào `profile_metadata`, không ảnh hưởng cookie trong keychain
**When** user xóa profile
**Then** record DB + cookie trong safeStorage + automation_jobs liên quan đều bị xóa (cleanup đầy đủ)

## Epic 3: Quản lý Proxy (Proxy Management)

User cấu hình + xoay proxy, health-check, bind per session.

### Story 3.1: Tích hợp proxy provider proxyfb

As a user,
I want cấu hình proxy provider proxyfb với API key,
So that automation chạy qua residential IP tránh FB flag.

**Acceptance Criteria:**

**Given** user có API key proxyfb
**When** user nhập key vào SettingsView
**Then** client gọi `GET http://api.proxyfb.com/api/changeProxy.php?key={key}` (port từ C# proxyfb.cs)
**And** parse proxy server/user/pass đúng
**And** key lưu encrypted (safeStorage)

### Story 3.2: Health-check proxy + circuit breaker

As a user,
I want hệ thống tự kiểm tra proxy và tạm ngừng provider lỗi,
So that automation không fail hàng loạt khi provider down.

**Acceptance Criteria:**

**Given** proxy provider đã cấu hình
**When** health-check phát hiện provider trả lỗi vượt ngưỡng
**Then** circuit breaker mở, provider bị quarantine, telemetry ghi `proxy_error`
**And** automation pending chờ provider khác hoặc retry theo RETRY_POLICY

### Story 3.3: Bind proxy riêng mỗi profile session

As a user,
I want mỗi profile session dùng 1 proxy riêng,
So that các profile không share IP (tránh cohort detection).

**Acceptance Criteria:**

**Given** automation job khởi động cho 1 profile
**When** state machine vào `ACQUIRING_PROXY`
**Then** proxy-pool cấp 1 proxy unique, bind vào BrowserContext của profile đó (FR26)
**And** không profile nào khác dùng cùng proxy đồng thời

## Epic 4: Lõi Automation Facebook — Self-Comment (Automation Core MVP)

User chạy self-comment validate toàn stack.

### Story 4.1: Sinh fingerprint diversified per profile

As a user,
I want mỗi profile có fingerprint browser unique,
So that FB khó mass-detect theo cohort (R-D15).

**Acceptance Criteria:**

**Given** profile được activate lần đầu
**When** fingerprint-generator chạy
**Then** sinh UA, viewport, timezone, font, WebGL noise unique và lưu vào `profile_metadata`
**And** cùng profile luôn dùng cùng fingerprint giữa các session (deterministic)

### Story 4.2: State machine cho automation job

As a developer,
I want job automation chạy qua state machine có checkpoint/resume,
So that các story sau (login, action) có khung orchestration và job dài không phải retry-from-scratch khi crash.

**Acceptance Criteria:**

**Given** automation job được tạo
**When** job chạy
**Then** transition qua states PENDING → ACQUIRING_PROXY → LOGGING_IN → SOLVING_CHECKPOINT → WARMING_UP → EXECUTING → DONE/CHECKPOINT_BLOCKED/FAILED/CANCELLED
**And** mỗi transition có guard (canTransition...), persist vào `automation_jobs` SQLite
**When** app crash giữa job
**Then** sau restart, job resume từ state cuối (NFR19), không chạy lại từ đầu

### Story 4.3: Login cookie + xử lý 2FA/checkpoint

As a user,
I want hệ thống login FB bằng cookie và xử lý 2FA/checkpoint,
So that automation truy cập được tài khoản.

**Acceptance Criteria:**

**Given** profile có cookie hợp lệ trong safeStorage + state machine (S4.2) + fingerprint (S4.1)
**When** state machine vào `LOGGING_IN`
**Then** Playwright stealth launch Chromium với proxy + fingerprint, set cookie, navigate FB
**When** gặp 2FA/checkpoint
**Then** checkpoint-handler xử lý (2FA seed từ safeStorage) hoặc chuyển state `CHECKPOINT_BLOCKED` + telemetry `checkpoint`
**And** login success verify qua DOM state

### Story 4.4: Trích xuất CSRF token qua HTTP

As a user,
I want hệ thống trích xuất fb_dtsg/lsd/jazoest,
So that các action HTTP-based hoạt động.

**Acceptance Criteria:**

**Given** đã login thành công (S4.3)
**When** token-extractor gọi HTTP GET facebook.com
**Then** parse fb_dtsg/lsd/jazoest (port từ C# stage 1), lưu in-memory session
**And** nếu parse fail (FB đổi HTML) → emit telemetry `selector_miss` + retry

### Story 4.5: Lấy per-action server token

As a user,
I want mỗi action tier 2+ được cấp token từ server,
So that license crack thuần client-side không hoạt động (R-D9).

**Acceptance Criteria:**

**Given** state machine chuẩn bị execute action tier 2+
**When** action-token-client gọi `POST /api/v1/automation/action/token`
**Then** server verify license + HWID + rate, cấp JWT HS256 (jti, sub, action, exp=60s)
**And** server lưu jti vào Redis SETNX TTL 60s chống reuse
**When** offline hoặc license invalid
**Then** action tier 2+ bị block với lỗi rõ ràng

### Story 4.6: Thực thi self-comment end-to-end

As a user,
I want chạy self-comment trên post của chính profile,
So that tôi validate toàn bộ stack hoạt động (MVP action).

**Acceptance Criteria:**

**Given** profile đã login + có action token
**When** user trigger self-comment qua `phase3:automation:start`
**Then** action-executor dùng **bundled selector tĩnh** (hardcode đủ để validate stack — Epic 5 sẽ nâng cấp lên 4-tier resolver + hot config) comment lên post của chính profile
**And** kết quả (success/checkpoint/error) ghi vào `job_actions` + telemetry beacon
**And** comment thật xuất hiện trên FB (verify read-back)
**And** state machine vào DONE
**And** nội dung comment chọn ngẫu nhiên từ danh sách template lưu trong SQLite (`content_templates` table: id, label, body, created_at); user quản lý template qua UI riêng (thêm/sửa/xóa); KHÔNG đọc từ file .txt

> **Dependency note:** Epic 4 standalone với bundled selector — KHÔNG phụ thuộc Epic 5. Epic 5 thay thế bundled selector bằng 4-tier resolver + hot config (enhancement layer, backward-compatible).
> **Scope note:** Story 4.6 = self-comment ONLY. Messenger Seeding (gửi DM tới người dùng khác qua Messenger) là tính năng riêng → Epic 12.

## Epic 5: Khả năng Tự phục hồi (Adaptive Resilience)

Tool tự phục hồi khi FB đổi DOM — differentiator cốt lõi.

### Story 5.1: Selector resolver 4-tier

As a developer,
I want resolver thử nhiều chiến lược selector theo thứ tự,
So that 1 selector vỡ không làm chết toàn bộ action (R-D2).

**Acceptance Criteria:**

**Given** action cần tìm element FB
**When** selector-resolver chạy
**Then** thử lần lượt tier ARIA → data-testid → text content → visual locator
**And** tier nào thành công thì dùng + ghi telemetry `selector_tier` (tier nào hoạt động)
**When** tất cả tier fail
**Then** emit `selector_miss` + chuyển fallback bundled (selector tĩnh từ Epic 4) hoặc báo lỗi
**And** action-executor (Epic 4) chuyển từ bundled selector sang dùng resolver này (backward-compatible thay thế)

### Story 5.2: Pull hot config + verify Ed25519

As a user,
I want app tải bộ selector mới nhất đã ký số,
So that khi FB đổi DOM, tôi không cần update app (adapt < 1h).

**Acceptance Criteria:**

**Given** app khởi động hoặc refresh mỗi 1h
**When** config-puller gọi `GET /api/v1/automation/selector-config`
**Then** client verify Ed25519 signature trước khi áp dụng
**When** signature invalid
**Then** fallback bundled selector + telemetry alert (R-D11), KHÔNG áp dụng config không hợp lệ

### Story 5.3: Client canary cohort 5% + rollback

As a user,
I want chỉ 5% user nhận config mới trước,
So that 1 config lỗi không phá toàn bộ userbase.

**Acceptance Criteria:**

**Given** config version mới publish với canary_pct=5
**When** client tính `isInCanary(hwid, version, 5)`
**Then** chỉ 5% HWID (deterministic) nhận config mới sớm
**And** dry-run mode: lần đầu chỉ verify element existed, không click
**When** success rate canary sụt > 10%
**Then** tự rollback về config cũ + alert admin

### Story 5.4: Canary profile + drift detection

As an admin,
I want canary profile chạy nền phát hiện FB drift sớm,
So that tôi biết FB siết trước khi user complain (< 24h).

**Acceptance Criteria:**

**Given** canary profile aged được cấu hình
**When** canary chạy low-intensity action định kỳ
**Then** drift-detector so success rate; nếu giảm > 15% trong 24h → telemetry alert tới admin (R-D1)
**And** canary success rate hiển thị trên admin dashboard

## Epic 6: Giám sát & Telemetry (Observability)

Admin xem SLO, user kiểm soát telemetry.

### Story 6.1: Mandatory anonymous beacon

As an admin,
I want mọi app gửi beacon ẩn danh,
So that tôi có SLO data 100% coverage (R-D13).

**Acceptance Criteria:**

**Given** user đã accept EULA
**When** action hoàn thành
**Then** beacon-emitter gửi `{version, hwid_hash, action_outcome_category, timestamp}` mỗi 5 phút (batch + offline buffer)
**And** beacon KHÔNG chứa UID/cookie/content/profile name (NFR20)
**And** `POST /api/v1/automation/telemetry/beacon` lưu vào `phase3.telemetry_events`

### Story 6.2: Opt-in detailed telemetry

As a user,
I want bật/tắt telemetry chi tiết,
So that tôi kiểm soát quyền riêng tư.

**Acceptance Criteria:**

**Given** SettingsView có toggle telemetry detail (default OFF)
**When** user bật
**Then** detail-emitter gửi event log + error stack + per-selector tier breakdown
**When** tắt
**Then** chỉ mandatory beacon chạy, không gửi detail

### Story 6.3: Backend telemetry sink + Grafana SLO dashboard

As an admin,
I want dashboard hiển thị SLO real-time,
So that tôi giám sát sức khỏe hệ thống.

**Acceptance Criteria:**

**Given** beacon + detail đổ về Postgres `phase3.telemetry_events`
**When** admin mở TelemetryDashboard
**Then** Grafana hiển thị action success rate, checkpoint rate, drift alert per cohort
**And** alert tự gửi Telegram/email khi success rate < 85% trong 1h (NFR16)

## Epic 7: Sao lưu & Khôi phục (Backup & Recovery)

User backup/restore + HWID rebind + self-service portal.

### Story 7.1: Export backup mã hóa

As a user,
I want export profile + state ra file mã hóa với passphrase,
So that tôi không mất dữ liệu khi đổi máy.

**Acceptance Criteria:**

**Given** user có profile + automation history
**When** user chọn "Export Backup" và nhập passphrase
**Then** tạo file `.p3backup` mã hóa AES-256-GCM (key PBKDF2 100k iteration từ passphrase), chứa profile + cookie + history
**And** KHÔNG include license private key
**And** UI cảnh báo rõ: mất passphrase = không khôi phục được

### Story 7.2: Import/restore từ backup

As a user,
I want import backup trên máy mới,
So that tôi khôi phục được sau khi đổi máy.

**Acceptance Criteria:**

**Given** user có file `.p3backup` + passphrase
**When** user "Import Backup" và nhập passphrase đúng
**Then** profile + cookie + history khôi phục vào safeStorage + SQLCipher
**When** passphrase sai
**Then** báo lỗi, không khôi phục

### Story 7.3: Nhắc backup định kỳ

As a user,
I want app nhắc tôi backup,
So that tôi không quên.

**Acceptance Criteria:**

**Given** đã quá N ngày từ backup cuối
**When** user mở app
**Then** hiển thị nhắc nhở backup non-blocking

### Story 7.4: Self-service license portal

As a user,
I want gia hạn, rebind HWID, pause license tự phục vụ,
So that tôi không phải nhắn admin từng việc nhỏ.

**Acceptance Criteria:**

**Given** user truy cập web portal với license
**When** user "Rebind HWID"
**Then** nếu còn lượt (2 free/năm) → rebind thành công; nếu MAC đổi nhưng machine_uuid giữ nguyên → auto-rebind
**When** user "Extend" hoặc "Pause"
**Then** gia hạn days (qua payment) hoặc pause expiry không tính ngày

## Epic 8: Phân phối & Tự cập nhật (Distribution & Auto-Update)

User nhận installer ký số + auto-update.

### Story 8.1: Đóng gói + code sign + notarize

As a user,
I want installer đã ký số cho Mac/Windows,
So that OS không cảnh báo và tôi tin tưởng cài đặt.

**Acceptance Criteria:**

**Given** code đã sẵn sàng release
**When** chạy electron-builder
**Then** tạo Mac dmg (notarized qua Apple) + Win nsis (signed EV cert)
**And** Gatekeeper + SmartScreen không block

### Story 8.2: Auto-update double-sign + cert pinning

As a user,
I want app tự cập nhật an toàn,
So that tôi luôn dùng bản mới nhất mà không lo bị tấn công update.

**Acceptance Criteria:**

**Given** có version mới trên update channel
**When** electron-updater check update
**Then** verify code-sign cert + Ed25519 signature (double-sign) + cert pinning endpoint (R-D12)
**When** signature fail
**Then** từ chối update, alert

### Story 8.3: Forced update gate + 3 channel

As an admin,
I want ép user update khi version quá cũ,
So that selector skew không làm user dùng bản lỗi.

**Acceptance Criteria:**

**Given** server set min_supported_version
**When** client version < min_supported
**Then** block toàn bộ action cho đến khi update (NFR30, R-D4)
**And** user chọn được channel stable/beta/canary; non-critical update có opt-in delay 24h

### Story 8.4: Release pipeline + admin version console

As an admin,
I want publish version qua pipeline + quản lý version,
So that tôi kiểm soát rollout.

**Acceptance Criteria:**

**Given** admin tag release
**When** CI release.yml chạy
**Then** build → sign → notarize → push GitHub Releases + S3 mirror
**When** admin mở AppVersionConsole
**Then** set min_supported_version + release notes + channel; client pull qua `GET /api/v1/automation/app-version`

## Epic 9: Mass Post & Warmup — Phase 3.1

### Story 9.1: Warmup behavior runner

As a user,
I want hệ thống warmup profile trước action thật,
So that hành vi giống người dùng, giảm checkpoint.

**Acceptance Criteria:**

**Given** profile chuẩn bị chạy mass action
**When** state machine vào `WARMING_UP`
**Then** warmup-runner thực hiện scroll/delay ngẫu nhiên mô phỏng người dùng
**And** thời lượng warmup randomized, ghi telemetry

### Story 9.2: Mass post executor

As a user,
I want chạy mass post lên timeline profile,
So that tôi phân phối nội dung hàng loạt.

**Acceptance Criteria:**

**Given** profile đã warmup + có action token
**When** user trigger mass post với nội dung
**Then** action-executor post lên timeline qua selector resolver
**And** mỗi post có per-action token riêng + delay randomized
**And** kết quả ghi job_actions + beacon

### Story 9.3: Tích hợp proxy provider tmproxy

As a user,
I want thêm provider tmproxy,
So that tôi có nhiều nguồn proxy hơn.

**Acceptance Criteria:**

**Given** user có API key tmproxy
**When** cấu hình
**Then** client gọi `POST https://tmproxy.com/api/proxy/get-new-proxy` (port C# proxyTM.cs), parse đúng
**And** proxy-pool failover giữa proxyfb + tmproxy

## Epic 10: Mass Comment & React — Phase 3.2

### Story 10.1: Mass comment 3rd party post

As a user,
I want comment hàng loạt lên post bên thứ ba,
So that tôi mở rộng tương tác.

**Acceptance Criteria:**

**Given** danh sách target post + profile
**When** user trigger mass comment
**Then** mỗi profile comment lên target qua selector resolver + per-action token + delay
**And** kết quả ghi job_actions + beacon

### Story 10.2: Mass react

As a user,
I want react hàng loạt (like/love/...),
So that tôi tăng tương tác.

**Acceptance Criteria:**

**Given** danh sách target + reaction type
**When** user trigger mass react
**Then** mỗi profile react đúng type qua selector resolver
**And** delay randomized + per-action token

### Story 10.3: Tích hợp proxy provider shoplike

As a user,
I want thêm provider shoplike,
So that proxy pool đa dạng hơn.

**Acceptance Criteria:**

**Given** user có access token shoplike
**When** cấu hình
**Then** client gọi `GET http://proxy.shoplike.vn/Api/getNewProxy?access_token={key}` (port C# shopLike.cs)
**And** proxy-pool failover 3 provider

## Epic 11: Share & Friend Request — Phase 3.3

### Story 11.1: Share action executor

As a user,
I want share post lên timeline hàng loạt,
So that tôi lan tỏa nội dung.

**Acceptance Criteria:**

**Given** danh sách target post + profile
**When** user trigger mass share
**Then** mỗi profile share qua selector resolver + per-action token + delay
**And** kết quả ghi job_actions + beacon

### Story 11.2: Friend request automation

As a user,
I want gửi/accept friend request theo target list,
So that tôi mở rộng mạng lưới.

**Acceptance Criteria:**

**Given** danh sách target user
**When** user trigger friend request
**Then** mỗi profile gửi request qua selector resolver, throttle theo per-UID rate limit
**And** action pattern aggressive nhất → warmup bắt buộc trước + canary giám sát chặt

---

## Epic 12: Mass Messenger Seeding — Phase 3.4

User gửi tin nhắn qua Messenger tới người dùng Facebook đã tương tác với bài post (like, comment, share) hoặc theo target list UID, dùng nhiều profile luân phiên với proxy riêng.

> **Phân biệt với self-comment (Epic 4):** Epic 4 = comment lên post của chính profile (validation low-blast). Epic 12 = gửi DM Messenger tới người dùng khác — blast radius cao hơn, detection profile khác, cần warmup (Epic 9) trước.

**FRs covered:** FR-P3-12 (Messenger Seeding — mới, không có trong FR1-37 gốc; bổ sung từ gap analysis C# app)

### Story 12.1: Content Templates — Quản lý nội dung gửi

As a user,
I want tạo, sửa, xóa các template nội dung (tin nhắn, comment),
So that automation có thể chọn ngẫu nhiên từ kho template để tránh bị detect spam.

**Acceptance Criteria:**

**Given** user mở màn hình Content Templates
**When** user thêm template mới (label + body)
**Then** template lưu vào SQLite `content_templates(id, label, body, created_at)`, hiển thị trong danh sách
**And** body hỗ trợ placeholder `{uid}`, `{name}` (thay runtime)
**And** user có thể sửa, xóa từng template
**And** IPC `phase3:content:list`, `phase3:content:create`, `phase3:content:update`, `phase3:content:delete`

### Story 12.2: Messenger Seeding Engine

As a user,
I want gửi tin nhắn Messenger tới danh sách target UID tự động,
So that tôi seeding nội dung hàng loạt qua DM với nhiều profile luân phiên.

**Acceptance Criteria:**

**Given** danh sách target UID (import từ file hoặc paste) + template đã chọn
**When** user trigger Messenger Seeding job
**Then** mỗi profile: login cookie → mở Messenger với target UID → gửi nội dung từ template chọn ngẫu nhiên → delay ngẫu nhiên → rotate profile
**And** checkpoint/rate-limit → profile đó dừng, log lý do, profile khác tiếp tục (không crash batch)
**And** kết quả per-message ghi vào `automation_jobs` + telemetry beacon
**And** proxy riêng mỗi profile session (dùng Epic 3 proxy layer)
**And** warmup bắt buộc trước nếu profile chưa warm (link Epic 9.1)

### Story 12.3: Target List Management

As a user,
I want quản lý danh sách target UID để gửi Messenger,
So that tôi tổ chức chiến dịch seeding theo từng nhóm mục tiêu.

**Acceptance Criteria:**

**Given** user mở Target Lists
**When** user tạo list mới + import UID (paste text hoặc file .txt)
**Then** list lưu vào SQLite `target_lists(id, label, created_at)` + `target_list_entries(list_id, uid, sent_at)`
**And** user filter UID đã gửi / chưa gửi / gửi lỗi để không gửi trùng
**And** link list với job khi trigger seeding

### Story 12.4: C# Messenger Share-Link Parity

As a user migrating from the legacy `SST_TOOL_FB` C# tool,
I want the Messenger seeding flow to match the legacy share-link Messenger workflow 100%,
So that existing operators can run the same campaign pattern, inputs, limits, and blocking behavior in the Phase 3 desktop app.

**Acceptance Criteria:**

**Given** user chooses C# parity mode for Messenger seeding
**When** user supplies target UID/page IDs, share links, message content, random-content setting, delay, and optional stop-after-error limit
**Then** each profile follows the legacy flow from `automation-facebook/SST_TOOL_FB/Main.cs`: extract Facebook web tokens, call GraphQL `MWChatBusinessCTAAdsSenderMutation`, require `messenger_business_ads_sender` in response, open a random share link, click share/Messenger through the same fallback selector strategy, type message content line-by-line with Shift+Enter, send, check `Couldn't send`, update per-target status, delay, and stop on checkpoint/logout/error limit without crashing other profiles.

**And** this parity mode is explicitly tested against fake Playwright/GraphQL adapters and does not regress direct-DM 12.2 mode.

**And** backend action-token policy accepts `action_type='message'` so real Messenger seeding is not blocked by license gating.

---

## Final Validation Results

**Validated:** 2026-06-01

### FR Coverage: ✅ 37/37
Mọi FR1→FR37 được cover bởi ít nhất 1 story (xem FR Coverage Map). Không sót.

### Architecture Compliance: ✅
- Starter template → Epic 1 Story 1.1 (đúng yêu cầu architecture)
- DB tạo theo nhu cầu story (`phase3.licenses`@1.3, `profiles`@2.1, `automation_jobs`@4.4), không upfront

### Story Quality: ✅
- Single-dev-session sizing
- Forward dependency 4.6→5.1 đã fix (Epic 4 dùng bundled selector, Epic 5 nâng cấp)
- Story 8.1 phụ thuộc external cert (Apple/Win) — blocker hành chính, track ở PRD Open Questions

### Epic Structure: ✅
- Organize by user value, không technical layer
- **File churn rationale (Epic 9/10/11 cùng modify `action-executor.ts`):** Split JUSTIFIED — mỗi action type (post/comment+react/share+friend) là risk boundary riêng với detection profile khác nhau; phased rollout 3.1/3.2/3.3 + 6-tuần SLO gate là feedback loop thật. Consolidation đã cân nhắc và REJECTED vì sẽ mất khả năng ship-or-kill từng action type độc lập.

### Dependency: ✅
- Epic independence: Epic 2 ⊥ Epic 4; Epic 4 ⊥ Epic 5 (bundled selector); growth epics build on 3.0 complete (expected phased dependency)
- Within-epic stories sequential, no forward dependency

### Summary
- **11 epics, 40 stories** (32 stories Phase 3.0 MVP + 8 stories growth 3.1-3.3)
- Status: **READY FOR DEVELOPMENT**
- Companion: `prd-phase3.md` (37 FR + 30 NFR) + `architecture.md` § Phase 3 Addendum (11 ADR-D + 16 R-D)

### Known External Blockers (từ PRD Open Questions)
1. Apple Developer entity + Win EV cert (block Story 8.1)
2. EULA + ToS legal draft (block Story 1.2 production content)
3. License pricing tier (block Story 7.4 payment)
4. GitHub repo public/private mix (block Story 8.4)
5. Đăng ký công ty nếu sell-as-a-service (block EULA legal entity)
