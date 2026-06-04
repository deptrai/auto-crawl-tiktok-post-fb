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

Document này decompose requirements từ `prd-phase3.md` (37 FR + 30 NFR) và `architecture.md` § Phase 3 Addendum (16 ADR-D + 16 R-D anchor) thành epics & stories implementable. Phased delivery: Phase 3.0 (MVP) → 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8 → 3.9.

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
**Localization**: NFR28 VN lock Phase 3.0-3.9
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
- 16 ADR-D quyết định (xem architecture.md): D1 Electron, D2 license, D3 storage, D4 hot config, D5 update, D6 telemetry, D7 data model, D8 IPC, D9 backend deploy, D10 distribution, D11 backup, D12 checkpoint scope, D13 captcha provider, D14 proxy binding, D15 safety rails, D16 token/telemetry
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
| 12 Mass Messenger Seeding | FR-P3-12 | 3.4 |
| 13 Facebook Group Growth Automation | FR-P3-13 | 3.5 |
| 14 Facebook Page Automation | FR-P3-14 | 3.6 |
| 15 Marketplace Automation | FR-P3-15 | 3.7 |
| 16 Livestream Automation | FR-P3-16 | 3.8 |
| 17 Advanced Account Farming & Risk | FR-P3-17 | 3.9 |
| 18 Lead, Segment & Campaign Operations | FR-P3-18 | 3.9 |

✅ 37/37 original FR mapped. FR-P3-12→18 added post-validation for full Facebook automation suite scope.

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
Tool tự phục hồi khi FB đổi DOM hoặc bung checkpoint: selector 4-tier fallback (ARIA → testid → text → visual) + hot config Ed25519 signed + canary cohort 5% + drift detection + **tự giải checkpoint CAPTCHA (FunCaptcha/reCAPTCHA) qua CapSolver/2captcha với safety rails**. Đây là differentiator cốt lõi (adapt time < 1h, self-recovery).
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

### Epic 12: Mass Messenger Seeding — Phase 3.4
User gửi tin nhắn Messenger tới UID/target lists và chạy C# share-link parity mode.
**FRs covered:** FR-P3-12

### Epic 13: Facebook Group Growth Automation — Phase 3.5
User tìm/lưu/join/post/comment/quét UID/mời/rời/up nhóm và PageAdmin group mode.
**FRs covered:** FR-P3-13

### Epic 14: Facebook Page Automation — Phase 3.6
User quản lý Page identity, Page post, Page comment/reply, và Page inbox auto-reply.
**FRs covered:** FR-P3-14

### Epic 15: Facebook Marketplace Automation — Phase 3.7
User đăng listing, refresh listing, reply buyer/seller messages, và theo dõi listing status.
**FRs covered:** FR-P3-15

### Epic 16: Livestream Automation — Phase 3.8
User chạy live watcher, live comment/react/share, và live safety kill switch.
**FRs covered:** FR-P3-16

### Epic 17: Advanced Account Farming & Risk Orchestration — Phase 3.9
User tạo lịch nuôi nick dài ngày, low-risk behavior runner, risk score, eligibility gate, và global kill switch.
**FRs covered:** FR-P3-17

### Epic 18: Lead, Segment & Campaign Operations — Phase 3.9
User gom lead đa nguồn, segment/suppression, campaign presets, reports, và operator dashboard.
**FRs covered:** FR-P3-18

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
**And** nội dung comment chọn ngẫu nhiên từ danh sách template lưu trong SQLite (`content_templates` table: id, label, body, created_at); quản lý template do Phase 3.0 Story 4.6b sở hữu, Story 12.1 chỉ reuse/extend primitive này, KHÔNG tạo duplicate template manager và KHÔNG đọc từ file .txt

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

### Story 5.5: Tự giải checkpoint CAPTCHA (FunCaptcha/reCAPTCHA)

As a user,
I want hệ thống tự giải checkpoint CAPTCHA giải được (FunCaptcha/reCAPTCHA) thay vì block account ngay,
So that account dính checkpoint vẫn có cơ hội login tiếp thay vì chết (R-D1 self-recovery).

> **Companion:** `architecture.md` § Phase 3 Addendum — Checkpoint Auto-Solver (ADR-P3-D12 → D16).
> **Quan hệ với Story 4.3:** nâng cấp nhánh checkpoint của S4.3 — trước khi fallback `CHECKPOINT_BLOCKED`,
> thử SOLVING_CHECKPOINT nếu loại checkpoint giải được + feature flag ON + có API key.
> **Sequencing note:** Story 5.5 có thể dùng injected fake/manual API key + feature flag trong tests/manual validation. Story 5.6 chỉ bổ sung Settings UI + safeStorage persistence cho user-facing config; 5.5 KHÔNG được phụ thuộc UI 5.6 để compile hoặc pass automated tests.

**Acceptance Criteria:**

**Given** login (S4.3) phát hiện state `CHECKPOINT` + feature flag `captcha.solver.enabled` = ON + có API key trong safeStorage
**When** checkpoint-type-detector phân loại checkpoint
**Then** chỉ `FUNCAPTCHA` và `RECAPTCHA_V2` được coi là giải được (ADR-P3-D12); `OTP`/`IDENTITY`/`UNKNOWN` → fallback `CHECKPOINT_BLOCKED` ngay như cũ
**When** checkpoint thuộc loại giải được
**Then** state machine vào `SOLVING_CHECKPOINT`, extract params (publicKey/siteKey/blob) từ DOM
**And** gọi CapSolver (primary); lỗi/hết credit → fallback 2captcha (ADR-P3-D13)
**And** solver task gửi kèm proxy của profile để token khớp IP session (ADR-P3-D14)
**When** nhận token
**Then** inject token vào page tức thì + re-verify bằng `detectLoginState()` (ADR-P3-D16)
**And** thành công → transition `WARMING_UP`; thất bại → `CHECKPOINT_BLOCKED`
**And** circuit breaker: 1 profile fail solve 2 lần → ngừng thử, mark `CHECKPOINT_BLOCKED` (ADR-P3-D15)
**And** budget cap: tối đa 10 lần solve/phiên bulk; chạm trần → checkpoint còn lại fallback ngay không gọi API
**And** telemetry ghi `{provider, checkpointType, outcome, durationMs}` (outcome khớp enum `action_outcome_category`) — TUYỆT ĐỐI không log token/API key/proxy credential
**And** mặc định feature flag OFF; không có API key cũng coi như OFF (fallback hành vi cũ)

### Story 5.6: Cấu hình API key CAPTCHA solver

As a user,
I want nhập + bật/tắt API key CapSolver/2captcha qua settings,
So that tôi kiểm soát chi phí và chỉ bật khi sẵn sàng.

**Acceptance Criteria:**

**Given** user mở Settings
**When** nhập API key cho CapSolver hoặc 2captcha và lưu
**Then** key lưu qua `safeStorage` (OS keychain), KHÔNG vào SQLite, KHÔNG đi qua IPC payload raw (R-D3)
**And** IPC `phase3:captcha:set-key` write-only — KHÔNG bao giờ trả key về renderer
**And** IPC `phase3:captcha:status` chỉ báo boolean đã-cấu-hình + flag enabled (không lộ key)
**And** Zod validate 2 chiều request + response; lỗi trả ErrorEnvelope `message` tiếng Việt + `retryable` (ADR-P3-D8)
**And** toggle bật/tắt feature flag `captcha.solver.enabled` (mặc định OFF)

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
**And** delay randomized + per-action token + warmup bắt buộc trước nếu profile chưa warm

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
**And** warmup bắt buộc trước nếu profile chưa warm
**And** kết quả ghi job_actions + beacon

### Story 11.2: Friend request automation

As a user,
I want gửi/accept friend request theo target list,
So that tôi mở rộng mạng lưới.

**Acceptance Criteria:**

**Given** danh sách target user
**When** user trigger friend request
**Then** mỗi profile gửi request qua selector resolver + per-action token, throttle theo per-UID rate limit
**And** action pattern aggressive nhất → warmup bắt buộc trước + canary giám sát chặt

---

## Epic 12: Mass Messenger Seeding — Phase 3.4

User gửi tin nhắn qua Messenger tới người dùng Facebook đã tương tác với bài post (like, comment, share) hoặc theo target list UID, dùng nhiều profile luân phiên với proxy riêng.

> **Phân biệt với self-comment (Epic 4):** Epic 4 = comment lên post của chính profile (validation low-blast). Epic 12 = gửi DM Messenger tới người dùng khác — blast radius cao hơn, detection profile khác, cần warmup (Epic 9) trước.

**FRs covered:** FR-P3-12 (Messenger Seeding — mới, không có trong FR1-37 gốc; bổ sung từ gap analysis C# app)

### Story 12.0: High-Blast Safety Primitives & Global Kill Switch Foundation

As an operator,
I want mọi workflow high-blast có cap, cooldown, eligibility gate và kill switch tối thiểu trước khi chạy,
So that Messenger/group/Page/Marketplace/live automation không vượt ngưỡng an toàn trước khi Epic 17 risk orchestration nâng cao được triển khai.

**Acceptance Criteria:**

**Given** bất kỳ action high-blast Phase 3.4-3.9 chuẩn bị start (Messenger, group join/post/comment, Page, Marketplace, live)
**When** scheduler/action-executor validate profile + action
**Then** enforce tối thiểu: warmup eligibility, per-profile daily cap, per-action cooldown, per-target duplicate guard, one high-blast action active/profile, terminal stop khi checkpoint/rate-limit/risk pause
**And** global kill switch có thể bật/tắt toàn bộ high-blast actions ngay lập tức; job đang chạy phải stop ở boundary an toàn kế tiếp và ghi lý do `GLOBAL_KILL_SWITCH`
**And** lưu policy/state qua repository rõ ràng (`safety_policies`, `profile_action_counters`, `global_kill_switch_state` hoặc schema tương đương) để mọi Epic 12-16 dùng chung
**And** expose IPC/API tối thiểu `phase3:safety:get-policy`, `phase3:safety:update-policy`, `phase3:safety:get-kill-switch`, `phase3:safety:set-kill-switch` với Zod + ErrorEnvelope tiếng Việt
**And** token policy guard: action tier 2+ vẫn cần per-action server token trước khi execute; kill switch/cap failure block trước khi consume action token nếu có thể
**And** CI/unit tests KHÔNG gọi live Facebook; test cap exceeded, cooldown active, kill switch ON, checkpoint pause, concurrent high-blast blocked, token guard preserved
**And** Epic 17 được phép mở rộng risk scoring/farming calendar/policy planner, nhưng KHÔNG thay thế safety primitives tối thiểu của Story 12.0

### Story 12.1: Content Templates — Reuse & Messenger Placeholder Enhancements

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
**And** implementation reuse manager/schema đã có từ Phase 3.0 Story 4.6b; Story 12.1 chỉ thêm placeholder semantics + Messenger usage, KHÔNG tạo màn hình/bảng quản lý template thứ hai

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
I want quản lý danh sách target UID dùng lại cho Messenger và các campaign UID-based,
So that tôi tổ chức chiến dịch theo từng nhóm mục tiêu mà không import trùng.

**Acceptance Criteria:**

**Given** user mở Target Lists
**When** user tạo list mới + import UID (paste text hoặc file .txt)
**Then** list lưu vào SQLite `target_lists(id, label, created_at)` + `target_list_entries(list_id, uid, sent_at)`
**And** user filter UID đã gửi / chưa gửi / gửi lỗi để không gửi trùng
**And** link list với job khi trigger seeding hoặc action UID-based; Epic 13 member scan chỉ feed UID vào flow này, không tạo target-list manager riêng

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

## Epic 13: Facebook Group Growth Automation — AutoNuoi/FBGlobal Parity

User tìm nhóm Facebook theo semantic keyword/LLM mode, lưu nhóm theo category, join tuần tự để tránh checkpoint, đăng bài trong nhóm, comment vào post trong nhóm, quét thành viên/UID nhóm, mời thành viên vào nhóm, rời nhóm ít tương tác, chạy PageAdmin group mode, up/làm mới bài nhóm, và theo dõi kết quả theo profile/group/action.

> **Scope note:** Epic này là net-new Phase 3 group automation, tách khỏi Epic 10 mass comment/react, Epic 11 share/friend, và Epic 12 Messenger. Inspiration/research từ Autonuoi/FBGlobal: tìm nhóm theo ngành nghề, tham gia nhóm, đăng bài nhóm, bình luận nhóm, quét thành viên/UID, auto nuôi nick, proxy/kịch bản riêng. Implementation phải theo Phase 3 guardrails: quota, cooldown, no-secret logs, fake DI tests, không live Facebook trong CI.

**Architecture guardrails:**
- Action-token backend MUST accept and audit group action types before live execution: `group_join`, `group_leave`, `group_post`, `group_comment`, `group_up`, `group_member_scan`, `group_invite`, and PageAdmin variants where applicable.
- Safety policy is not optional: join/post/comment/up/invite/member-scan all run through per-profile daily caps, randomized cooldown, warmup gate, checkpoint pause, and no concurrent conflicting group actions on the same profile.
- Semantic/LLM mode is advisory only. LLM adapters receive sanitized keyword/category text only, never cookies, profile secrets, raw member lists, phone numbers, or post/comment bodies; fake LLM/search adapters are mandatory in CI.
- Facebook group UI automation MUST use the Phase 3 selector resolver/hot-config path, not hardcoded selectors inside engines.
- Job logs, telemetry, IPC payloads, and LLM prompts MUST NOT serialize cookie/token/password, post/comment body, phone number, member private data, or raw scraped profile details.
- No duplicate generic engines: content templates, action-token checks, proxy/session binding, checkpoint handling, and target-list import/export reuse existing Phase 3 primitives. Epic 13 only adds group-scoped adapters, registries, and actions.

**FRs covered:** FR-P3-13 (Facebook Group Growth Automation — bổ sung từ AutoNuoi/FBGlobal research + user request)

### Story 13.1: Group Categories & Target Registry

As a user,
I want lưu group Facebook theo category và import group URL/UID,
So that tôi có kho group có tổ chức để chạy join/post/comment campaign.

**Acceptance Criteria:**

**Given** user mở Group Targets
**When** user tạo category và paste/import group URL/UID một hoặc nhiều dòng
**Then** app lưu `group_categories`, `facebook_groups`, `profile_group_memberships`, `group_posts`, và `group_action_history` trong SQLite, gồm `group_uid`, normalized URL, source, category relation, member_count?, privacy?, join_status, interaction_score?, last_seen_at, created_at
**And** validate URL/UID non-empty, normalize `/groups/{id}`, `/groups/{slug}`, query-string URL, mobile URL, and dedupe theo canonical `group_uid` hoặc normalized URL
**And** user filter group theo category/status/member_count
**And** registry lưu audit đủ để dedupe join/post/comment/up/member-scan/invite theo profile/group/post mà không dựa vào in-memory state
**And** IPC dùng `phase3:group:*`, Zod 2-way, ErrorEnvelope tiếng Việt

### Story 13.2: Semantic Group Discovery & Scoring

As a user,
I want tìm group theo keyword/ngành nghề với semantic/LLM mode,
So that tôi nhanh chóng tạo danh sách group liên quan thay vì nhập thủ công.

**Acceptance Criteria:**

**Given** user nhập keyword, ngành nghề, khu vực hoặc prompt mô tả tệp khách hàng
**When** user chạy discovery ở chế độ semantic/LLM
**Then** hệ thống mở rộng keyword, gợi ý category, tìm/capture group candidates qua browser-search adapter fakeable hoặc import/search-result adapter fakeable, rồi lưu candidate vào registry với trạng thái `candidate`
**And** group score gồm tối thiểu: keyword match, member_count nếu có, public/private signal nếu có, duplicate signal, join status
**And** LLM output chỉ là gợi ý keyword/category/scoring; KHÔNG tự join/post/comment khi chưa có user confirm
**And** discovery ghi source (`manual`, `facebook_search`, `similar_group`, `llm_suggestion`) và không ghi raw prompt chứa dữ liệu nhạy cảm
**And** tests fake LLM/search adapter, không gọi Facebook/live LLM trong CI

### Story 13.3: Safe Sequential Group Join Scheduler

As a user,
I want join nhiều group tuần tự theo profile với quota và cooldown,
So that tôi mở rộng group access mà giảm rủi ro checkpoint.

**Acceptance Criteria:**

**Given** user chọn profiles và group/category đã confirm
**When** user trigger Group Join campaign
**Then** mỗi profile join group tuần tự, có delay randomized, daily cap, per-profile cooldown, warmup gate, proxy/session riêng, và không chạy đồng thời với post/comment/member-scan trên cùng profile
**And** checkpoint/login fail/rate-limit dừng profile đó, không crash batch profile khác
**And** mỗi attempt ghi `automation_jobs` + `job_actions` với `actionType:'group_join'`, target group UID/URL, outcome, reason
**And** backend action-token policy accepts `action_type='group_join'` before live execution
**And** status UI hiển thị pending/joining/joined/already_joined/checkpoint/failed
**And** E2E dùng `PHASE3_AUTOMATION_STUB=1`, không gọi Facebook thật

### Story 13.4: Group Post Campaign Engine

As a user,
I want đăng bài vào 1 hoặc nhiều group đã chọn bằng template random,
So that tôi chạy chiến dịch nội dung trong group có kiểm soát.

**Acceptance Criteria:**

**Given** user chọn profiles, groups/categories, content templates và lịch/delay
**When** user trigger Group Post campaign
**Then** mỗi profile mở group đã join, tạo post từ template random, submit, readback/verify nếu có thể, delay giữa group
**And** group chưa join, nhóm yêu cầu phê duyệt, hoặc không có quyền post được mark reason `GROUP_NOT_JOINED`, `GROUP_REQUIRES_APPROVAL`, hoặc `POST_NOT_ALLOWED`, không throw toàn batch
**And** mỗi post ghi `job_actions` với `actionType:'group_post'`, target group, outcome, reason
**And** backend action-token policy accepts `action_type='group_post'` before live execution
**And** không serialize post body/cookie/token vào job result/log/IPC
**And** template engine supports existing random/macro syntax used by Phase 3 content flows, including nested random variants, without storing rendered body in logs
**And** unit/integration tests cover success, selector_miss, not_joined, requires_approval, checkpoint, template_missing

### Story 13.5: Group Comment Campaign Engine

As a user,
I want comment vào post trong một hoặc nhiều group theo target mode,
So that tôi tăng tương tác group theo chiến dịch và không comment trùng.

**Acceptance Criteria:**

**Given** user chọn profiles, groups/categories, comment templates, và target mode
**When** target mode là `latest_posts`, `post_url_list`, hoặc `keyword_filtered_posts`
**Then** engine lấy post targets qua adapter fakeable, dedupe post đã comment, render template random, comment tuần tự, delay, record outcome
**And** mỗi comment ghi `job_actions` với `actionType:'group_comment'`, target post/group, outcome, reason
**And** backend action-token policy accepts `action_type='group_comment'` before live execution
**And** checkpoint/rate-limit dừng profile đó; selector_miss/post_locked/comment_disabled mark lỗi target rồi tiếp tục theo policy
**And** không serialize comment body/cookie/token/member private data vào job result/log/IPC
**And** UI hiển thị progress per profile/group/post: sent/total, skipped, failed
**And** tests cover dedupe, latest mode, post URL list mode, keyword filtered fake adapter, comment_disabled, checkpoint stop

### Story 13.6: Group Automation Surface & Progress Dashboard

As a user,
I want một màn hình điều khiển group automation,
So that tôi chọn category/group/profile/action và theo dõi join/post/comment campaign từ một nơi.

**Acceptance Criteria:**

**Given** user mở Group Automation view
**When** user chọn base action `discover`, `join`, `post`, hoặc `comment`
**Then** UI hiện controls đúng theo action: keyword/category, group selector, profile multi-select, template selector/hint, delay/quota/cooldown, stop conditions
**And** async buttons disable ngay khi click; loading/empty/error states có class/testid riêng
**And** progress dashboard poll status và dừng khi tất cả jobs terminal
**And** invalid config hiển thị message tiếng Việt trước khi gọi IPC
**And** E2E stub covers at least one full discover→join→post→comment configured flow without live Facebook
**And** advanced actions `member_scan`, `invite`, `up`, `leave`, and `pageadmin` are added to this same surface only by Stories 13.8-13.10 after their engines exist

### Story 13.7: AutoNuoi Safety Policy & Campaign Planner

As a user,
I want app lập kế hoạch chạy auto-nuôi group an toàn theo ngày/profile,
So that chiến dịch group growth chạy chậm, có kiểm soát, và ít checkpoint hơn.

**Acceptance Criteria:**

**Given** user có profiles, proxy config, group categories và action mix
**When** user tạo AutoNuoi plan
**Then** planner tạo lịch theo ngày/profile gồm warmup, join quota, post quota, comment quota, cooldown, và randomization window
**And** plan không vượt daily caps; profile bị checkpoint/risk cao bị tạm dừng tự động
**And** planner blocks conflicting actions trên cùng profile, ví dụ đang join group thì không chạy quét UID/dòng thời gian, post, comment, invite cùng lúc
**And** user có thể preview plan trước khi chạy; semantic/LLM suggestions không tự execute
**And** telemetry/job_actions đủ để audit lý do skip/stop
**And** tests cover cap enforcement, cooldown, checkpoint pause, risk score, and dry-run preview

### Story 13.8: Group Member UID Scan & Data Export

As a user,
I want quét thành viên/UID và tương tác trong group theo chế độ có kiểm soát,
So that tôi có tệp khách hàng tiềm năng từ group để dùng cho chiến dịch tiếp theo.

**Acceptance Criteria:**

**Given** user chọn group đã lưu, profile chạy, scan mode, và giới hạn số lượng
**When** user trigger Group Member Scan campaign
**Then** engine liệt kê member/post/comment targets qua adapter fakeable, dedupe theo UID, lưu `group_members`/`group_member_observations` với public fields tối thiểu và source group/action
**And** scan mode hỗ trợ tối thiểu `members_list`, `post_commenters`, `post_reactors`, và `keyword_filtered_commenters` nếu adapter trả được dữ liệu
**And** backend action-token policy accepts `action_type='group_member_scan'` before live execution
**And** export CSV/XLSX chỉ xuất trường user đã chọn; phone/email extraction nếu có phải tách cờ explicit và không ghi vào telemetry/log
**And** exported UIDs can feed the existing target-list/import flow; this story does not create a duplicate generic Messenger target-list manager
**And** Group Automation surface adds `member_scan` controls and one member_scan dry-run E2E stub only after this engine is implemented
**And** checkpoint/rate-limit dừng profile đó; private/unavailable/member_hidden mark reason rồi tiếp tục theo policy
**And** tests cover dedupe, export field selection, private group unavailable, checkpoint stop, and fake adapter scan modes

### Story 13.9: Group Invite, Leave & Up/Refresh Actions

As a user,
I want mời thành viên vào nhóm, rời nhóm ít tương tác, và up/làm mới bài nhóm,
So that tôi quản trị vòng đời group campaign giống AutoNuoi/FBGlobal.

**Acceptance Criteria:**

**Given** user chọn owned/managed group, source UID/member list, target groups, posts, caps, and cooldown
**When** user trigger invite, leave, or up action
**Then** invite action mời tuần tự theo UID/member list, leave action rời nhóm theo rule interaction_score/status, và up action like/comment/refresh bài nhóm theo template safe mode
**And** mỗi action ghi `job_actions` với `actionType:'group_invite'`, `group_leave`, hoặc `group_up`, target group/post/member reference, outcome, reason
**And** backend action-token policy accepts `action_type='group_invite'`, `group_leave`, and `group_up` before live execution
**And** up/comment body không serialize vào log/IPC; invite targets không serialize private fields vào telemetry
**And** Group Automation surface adds `invite`, `leave`, and `up` controls only after this engine is implemented
**And** tests cover cap enforcement, low-interaction leave rule, invite dedupe, up selector_miss, checkpoint pause, and dry-run preview

### Story 13.10: PageAdmin Group Automation Mode

As a user,
I want dùng PageAdmin để tìm nhóm, tham gia nhóm, đăng bài, bình luận, và up tin,
So that tôi chạy group marketing bằng Page theo đúng nhánh FBGlobal.

**Acceptance Criteria:**

**Given** user có profile quản trị Page và chọn Page identity
**When** user chạy PageAdmin group action
**Then** engine resolve Page identity, verify quyền PageAdmin, và chạy discover/join/post/comment/up bằng Page context qua adapter fakeable
**And** PageAdmin outcomes dùng actionType namespace rõ ràng hoặc metadata `actorType:'page'`, `pageId`, không lẫn với profile actor
**And** backend action-token policy accepts PageAdmin group variants or the same group action types with `actor_type='page'`
**And** Page identity, page access state, and failures are shown in UI without exposing page/session secrets
**And** Group Automation surface adds `pageadmin` controls only after this engine is implemented; non-group Page automation remains out of scope
**And** tests cover page identity missing, not admin, join/post/comment/up success via fake adapter, selector_miss, checkpoint stop

---

## Epic 14: Facebook Page Automation — Page Marketing Suite

User quản lý Page identities, đăng bài Page, comment/reply dưới Page, inbox Page, và theo dõi hiệu quả Page campaign mà không trộn với group PageAdmin mode của Epic 13.

> **Scope note:** Epic 14 là non-group Page automation. Epic 13.10 chỉ dùng Page identity để chạy group actions. Epic này thêm Page timeline, Page inbox, Page comment/reply, và Page campaign analytics.

**FRs covered:** FR-P3-14 (Facebook Page Automation — bổ sung để hoàn thiện product suite)

### Story 14.1: Page Identity Registry & Permission Check

As a user,
I want lưu Page identity và kiểm tra quyền quản trị,
So that tôi chọn đúng Page khi chạy Page campaign.

**Acceptance Criteria:**

**Given** user có profile quản trị Page
**When** user import/capture Page identity
**Then** app lưu `facebook_pages` và `profile_page_permissions` gồm `page_id`, `name`, `role?`, `status`, `last_verified_at`
**And** verify quyền PageAdmin qua adapter fakeable trước khi chạy live action
**And** Page/session secrets không đi qua log/telemetry/IPC raw
**And** IPC dùng `phase3:page:*`, Zod 2-way, ErrorEnvelope tiếng Việt

### Story 14.2: Page Post Campaign Engine

As a user,
I want đăng bài lên một hoặc nhiều Page theo template/lịch,
So that tôi chạy nội dung Page marketing có kiểm soát.

**Acceptance Criteria:**

**Given** user chọn Page identities, content templates, lịch/delay, caps
**When** user trigger Page Post campaign
**Then** engine đăng bài bằng Page context qua selector resolver/hot-config, ghi `job_actions` với `actionType:'page_post'`
**And** backend action-token policy accepts `action_type='page_post'`
**And** post body không serialize vào job result/log/IPC
**And** tests cover success, permission_missing, selector_miss, checkpoint, template_missing

### Story 14.3: Page Comment & Reply Engine

As a user,
I want comment/reply bằng Page identity trên post/comment mục tiêu,
So that tôi chăm sóc tương tác Page ở quy mô lớn.

**Acceptance Criteria:**

**Given** user chọn Page, target post/comment list, reply templates, caps
**When** user trigger Page Comment/Reply campaign
**Then** engine comment/reply tuần tự, dedupe theo Page+target, ghi `actionType:'page_comment'` hoặc `page_reply`
**And** backend action-token policy accepts `action_type='page_comment'` và `action_type='page_reply'`
**And** hidden/deleted/permission_missing targets mark reason rồi tiếp tục theo policy
**And** tests cover dedupe, reply_to_comment, permission_missing, comment_disabled, checkpoint stop

### Story 14.4: Page Inbox Triage & Auto-Reply

As a user,
I want gom inbox Page và auto-reply theo template/rule,
So that tôi không bỏ sót lead nhắn Page.

**Acceptance Criteria:**

**Given** user chọn Page và inbox rule set
**When** user run inbox triage
**Then** engine đọc thread metadata qua adapter fakeable, phân loại unread/keyword, và reply theo template nếu rule match
**And** message body không ghi telemetry/log; only redacted outcome/audit stored
**And** backend action-token policy accepts `action_type='page_inbox_reply'`
**And** tests cover unread filter, keyword rule, duplicate reply guard, permission_missing, checkpoint stop

### Story 14.5: Page Automation Surface

As a user,
I want một màn hình Page Automation,
So that tôi chọn Page, action, template, schedule, caps, và xem progress.

**Acceptance Criteria:**

**Given** user mở Page Automation view
**When** user chọn action `post`, `comment`, `reply`, hoặc `inbox_reply`
**Then** UI validate config trước IPC, disable async buttons, hiển thị progress per Page/action/target
**And** E2E stub covers one Page post and one inbox dry-run without live Facebook

---

## Epic 15: Facebook Marketplace Automation — Listing & Buyer/Seller Workflow

User đăng listing Marketplace, làm mới listing, phản hồi buyer/seller message, và theo dõi trạng thái listing theo profile.

> **Scope note:** Marketplace là domain riêng vì selector, policy, media upload, location, và inbox behavior khác timeline/Page/group. Reuse content/media/template primitives; không tạo engine upload/log riêng nếu Phase 3 đã có primitive tương đương.

**FRs covered:** FR-P3-15 (Marketplace Automation — bổ sung để hoàn thiện product suite)

### Story 15.1: Marketplace Listing Template Registry

As a user,
I want tạo listing template gồm title, price, location, category, images, description,
So that tôi đăng Marketplace nhanh và nhất quán.

**Acceptance Criteria:**

**Given** user mở Marketplace Templates
**When** user tạo/sửa template
**Then** app lưu `marketplace_listing_templates` và media references, validate title/price/location/category/images
**And** media path/reference không chứa secret, không upload khi chỉ lưu template
**And** tests cover validation, missing images, invalid price, duplicate label

### Story 15.2: Marketplace Listing Post Engine

As a user,
I want đăng Marketplace listing bằng nhiều profile theo lịch,
So that tôi phân phối sản phẩm/dịch vụ qua Marketplace.

**Acceptance Criteria:**

**Given** user chọn profiles, listing templates, location/category, caps
**When** user trigger Marketplace Listing campaign
**Then** engine đăng listing tuần tự qua selector resolver/hot-config, upload media qua adapter fakeable, ghi `actionType:'marketplace_post'`
**And** backend action-token policy accepts `action_type='marketplace_post'`
**And** listing description/media private paths không serialize vào telemetry/log
**And** tests cover success, media_missing, category_missing, selector_miss, checkpoint stop

### Story 15.3: Marketplace Renew/Refresh & Inventory Status

As a user,
I want làm mới listing và track trạng thái còn bán/đã bán/ẩn,
So that listing không bị chìm và tôi biết listing nào còn hoạt động.

**Acceptance Criteria:**

**Given** app có marketplace listings đã đăng
**When** user trigger refresh/renew
**Then** engine refresh listing theo cap/cooldown, ghi `actionType:'marketplace_refresh'`, update listing status
**And** sold/hidden/unavailable listing mark reason rồi skip
**And** tests cover refresh success, sold skip, unavailable skip, rate_limit pause

### Story 15.4: Marketplace Message Reply Workflow

As a user,
I want trả lời buyer/seller message theo template/rule,
So that tôi xử lý lead Marketplace nhanh.

**Acceptance Criteria:**

**Given** user chọn listing/profile và reply rules
**When** user run Marketplace message reply
**Then** engine đọc thread metadata qua adapter fakeable, dedupe replies, gửi template response, ghi `actionType:'marketplace_reply'`
**And** backend action-token policy accepts `action_type='marketplace_reply'`
**And** message body không ghi telemetry/log; only redacted reason/outcome stored
**And** tests cover unread filter, duplicate guard, template_missing, checkpoint stop

### Story 15.5: Marketplace Surface & Listing Dashboard

As a user,
I want dashboard Marketplace listing/campaign,
So that tôi xem template, listing status, reply queue, và progress.

**Acceptance Criteria:**

**Given** user mở Marketplace view
**When** user chọn post/refresh/reply action
**Then** UI validate config, show listing status, sent/failed/skipped counts, and terminal job states
**And** E2E stub covers listing post dry-run and refresh dry-run without live Facebook

---

## Epic 16: Livestream Automation — Live Interaction & Watcher Campaigns

User chạy comment/share/watch warmup cho livestream, quản lý target live URLs, và theo dõi tương tác live theo profile.

> **Scope note:** Livestream automation có risk profile rất cao. Mọi live action bắt buộc warmup, daily caps, global kill switch, canary, and checkpoint pause. Không dùng live Facebook trong CI.

**FRs covered:** FR-P3-16 (Livestream Automation — bổ sung để hoàn thiện product suite)

### Story 16.1: Live Target Registry

As a user,
I want lưu target livestream URL/ID và metadata,
So that tôi tổ chức campaign live theo Page/profile/source.

**Acceptance Criteria:**

**Given** user paste/import live URLs
**When** app normalize target
**Then** lưu `live_targets` gồm `live_id`, `url`, `source_type`, `owner?`, `status`, `last_seen_at`
**And** dedupe URL/live_id, validate non-empty, support live/post permalink variants
**And** tests cover URL normalization, duplicate, invalid URL

### Story 16.2: Live Watcher Session Engine

As a user,
I want nhiều profile mở livestream và giữ phiên xem theo thời lượng random,
So that tôi tạo watcher behavior có kiểm soát.

**Acceptance Criteria:**

**Given** user chọn profiles, live target, duration window, caps
**When** user trigger watcher campaign
**Then** each profile opens live target, stays for randomized duration, records outcome `live_watch`
**And** backend action-token policy accepts `action_type='live_watch'`
**And** profile checkpoint/rate_limit stops only that profile
**And** tests cover success, live_ended, selector_miss, checkpoint stop, duration cap

### Story 16.3: Live Comment & Reaction Engine

As a user,
I want comment/react livestream theo template và delay,
So that tôi tăng tương tác live mà không spam đồng thời.

**Acceptance Criteria:**

**Given** user chọn live target, profiles, comment templates, reaction mix, caps
**When** user trigger live interaction campaign
**Then** engine comment/react tuần tự theo delay, dedupe per profile/live/template, ghi `live_comment`/`live_react`
**And** backend action-token policy accepts `action_type='live_comment'` và `action_type='live_react'`
**And** comment body không serialize vào logs/telemetry/IPC
**And** tests cover comment success, reaction success, live_ended, duplicate guard, checkpoint stop

### Story 16.4: Live Share Campaign

As a user,
I want share livestream lên timeline/group/Page theo policy,
So that live được phân phối rộng hơn.

**Acceptance Criteria:**

**Given** user chọn live target, actor profiles/Page identities, destination mode, caps
**When** user trigger live share
**Then** engine shares live target through existing share primitives where possible, records `actionType:'live_share'`
**And** backend action-token policy accepts `action_type='live_share'`
**And** unsupported destination marks reason, not crash batch
**And** tests cover profile share, Page actor share fake adapter, unsupported group, checkpoint stop

### Story 16.5: Live Safety Monitor & Kill Switch

As a user,
I want monitor risk và dừng toàn bộ live campaign nhanh,
So that livestream action không làm chết nhiều profile.

**Acceptance Criteria:**

**Given** live campaign đang chạy
**When** checkpoint/rate_limit/error rate vượt threshold
**Then** global live kill switch pauses new live actions, active profiles wind down safely
**And** UI shows reason, affected profiles, and resume requirements
**And** tests cover threshold trigger, manual kill switch, resume guard, telemetry redaction

---

## Epic 17: Advanced Account Farming & Risk Orchestration

User tạo lịch nuôi nick nhiều ngày gồm browse feed, watch video, like/follow/Page/group nhẹ, risk score, canary, và global caps trước khi chạy action mạnh.

> **Scope note:** Epic 9.1 warmup là pre-action runner ngắn. Epic 17 là long-running farming planner để biến profile mới/yếu thành profile đủ điều kiện chạy campaign. Không duplicate action executors; chỉ orchestrate low-risk behaviors qua adapters và policy.

**FRs covered:** FR-P3-17 (Advanced Account Farming & Risk Orchestration)

### Story 17.1: Farming Plan Templates

As a user,
I want tạo template nuôi nick theo ngày/profile tier,
So that profile mới, trung bình, và già chạy hành vi khác nhau.

**Acceptance Criteria:**

**Given** user mở Farming Planner
**When** user tạo plan template
**Then** plan gồm ngày, action mix, caps, cooldown, allowed hours, proxy requirements, stop conditions
**And** validate caps không vượt safety policy global
**And** tests cover invalid caps, allowed hours, profile tier mapping, dry-run preview

### Story 17.2: Low-Risk Behavior Runner

As a user,
I want runner browse feed/watch video/like/follow nhẹ,
So that profile có lịch sử hành vi tự nhiên hơn.

**Acceptance Criteria:**

**Given** profile có farming plan active
**When** scheduler executes low-risk behavior
**Then** runner performs fakeable browse/watch/like/follow steps with random delay and records `farming_behavior`
**And** no post/comment/message/share/friend/group join is executed by this story
**And** tests cover browse, watch, like/follow guard, checkpoint pause, cap enforcement

### Story 17.3: Profile Risk Score & Eligibility Gate

As a user,
I want biết profile nào đủ điều kiện chạy action mạnh,
So that tôi giảm checkpoint và burn rate.

**Acceptance Criteria:**

**Given** app có job history, checkpoint history, proxy health, farming history
**When** risk scorer runs
**Then** each profile gets `risk_score`, `eligibility_status`, and reason codes
**And** high-risk profile is blocked from high-blast actions unless user explicitly overrides in dry-run preview
**And** tests cover checkpoint penalty, proxy penalty, warmup boost, manual pause, override audit

### Story 17.4: Global Safety Policy & Kill Switch

As a user,
I want policy dừng/giới hạn toàn bộ campaign khi risk tăng,
So that một lỗi selector/proxy không phá toàn bộ dàn profile.

**Acceptance Criteria:**

**Given** multiple campaigns are running
**When** global checkpoint/rate-limit/error thresholds exceed policy
**Then** kill switch pauses new high-risk actions and records audit reason
**And** user can resume only after acknowledging risk and policy cooldown
**And** tests cover threshold, manual kill, resume guard, audit event, no-secret logs

### Story 17.5: Farming Calendar & Progress Surface

As a user,
I want xem lịch nuôi nick và trạng thái risk theo ngày,
So that tôi biết profile nào đang nuôi, sẵn sàng, hay bị pause.

**Acceptance Criteria:**

**Given** user opens Farming Calendar
**When** profile plans exist
**Then** UI shows day plan, progress, risk score, eligibility, pause reason, next action time
**And** async controls disable immediately and validate config before IPC
**And** E2E stub covers plan preview, start, pause, and risk gate display

---

## Epic 18: Lead, Segment & Campaign Operations — Product Control Plane

User gom lead từ Messenger/group/Page/Marketplace/live, dedupe/segment, build campaign presets, xem attribution/report, và export dữ liệu an toàn.

> **Scope note:** Đây là control plane để biến automation thành sản phẩm vận hành được. Không tự scrape domain mới; chỉ ingest outcomes/leads từ existing epics and normalize them for campaign planning/reporting.

**FRs covered:** FR-P3-18 (Lead & Campaign Operations)

### Story 18.1: Unified Lead Registry

As a user,
I want gom UID/lead từ mọi nguồn vào một registry,
So that tôi không xử lý trùng lead giữa Messenger, group, Page, Marketplace, và live.

**Acceptance Criteria:**

**Given** jobs từ Epic 12-16 produce target/outcome references
**When** lead ingestion runs
**Then** app stores `leads`, `lead_sources`, and `lead_observations` with dedupe by canonical UID/contact key
**And** private fields are opt-in and never sent in mandatory telemetry
**And** tests cover duplicate UID, multi-source merge, redaction, source audit

### Story 18.2: Segments & Suppression Lists

As a user,
I want tạo segment và suppression list,
So that tôi nhắm đúng tệp và không spam người đã fail/opt-out.

**Acceptance Criteria:**

**Given** lead registry has leads and observations
**When** user creates segment rules
**Then** app filters by source, category, status, last_action, failure reason, and manual tags
**And** suppression list blocks selected leads from future UID-based campaigns
**And** tests cover segment rule, suppression block, manual tag, export selection

### Story 18.3: Campaign Presets & Runbook Builder

As a user,
I want lưu campaign preset gồm action mix, templates, profile group, caps, and schedule,
So that tôi chạy lại campaign chuẩn mà không cấu hình từ đầu.

**Acceptance Criteria:**

**Given** user has profiles, templates, segments, and action engines
**When** user creates campaign preset
**Then** preset stores action sequence, caps, cooldown, stop conditions, target segment, and dry-run preview
**And** preset can reference existing actions only; it cannot execute unsupported action types
**And** tests cover preset validation, unsupported action guard, dry-run preview, no-secret serialization

### Story 18.4: Campaign Attribution & Report Export

As a user,
I want xem report hiệu quả campaign và export an toàn,
So that tôi đánh giá chiến dịch nào đáng chạy tiếp.

**Acceptance Criteria:**

**Given** campaign jobs have outcomes and lead observations
**When** user opens report
**Then** dashboard shows sent/done/skipped/failed/checkpoint by campaign/action/source/profile group
**And** export CSV/XLSX includes only user-selected fields and redacts secrets/content by default
**And** tests cover aggregation, field selection, redaction, failed job attribution

### Story 18.5: Operator Dashboard & Audit Log

As a user,
I want một dashboard vận hành tổng thể,
So that tôi thấy campaign đang chạy, risk, quota, queue, and audit trail từ một nơi.

**Acceptance Criteria:**

**Given** multiple campaigns exist
**When** user opens Operator Dashboard
**Then** UI shows active jobs, queued jobs, profile risk, action quotas, kill switch status, and audit log
**And** audit events include who/when/action/reason but no secret or message/post body
**And** E2E stub covers active campaign, paused risk, quota exceeded, and export report

---

## Final Validation Results

**Validated:** 2026-06-01

### FR Coverage: ✅
Mọi FR1→FR37 ban đầu được cover bởi ít nhất 1 story (xem FR Coverage Map). FR-P3-12 Messenger, FR-P3-13 Group Growth, FR-P3-14 Page Automation, FR-P3-15 Marketplace, FR-P3-16 Livestream, FR-P3-17 Advanced Farming/Risk, và FR-P3-18 Lead/Campaign Ops được bổ sung sau validation ban đầu và đều có epic/story coverage riêng.

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
- Story 4.6/12.1 template ownership resolved: Story 4.6b owns base `content_templates`; Story 12.1 reuses/extends it
- Story 5.5/5.6 sequencing resolved: CAPTCHA solver compiles/tests with injected config; Settings persistence follows in 5.6
- Story 12.0 gates high-blast Epic 12-16 before Epic 17 advanced orchestration
- Within-epic stories sequential, no unresolved forward dependency

### Summary
- **18 epics, 83 stories** (Phase 3.0 MVP + growth 3.1-3.9; Epic 12-18 added post initial validation for full Facebook automation suite scope; Story 12.0 added as high-blast safety gate)
- Status: **READY FOR STORY CREATION / PHASED DEVELOPMENT** — Phase 3.0 remains dev-ready; Phase 3.4-3.9 implementation must pass Story 12.0 safety primitives before live high-blast execution.
- Companion: `prd-phase3.md` (37 FR + 30 NFR) + `architecture.md` § Phase 3 Addendum (16 ADR-D + 16 R-D)

### Known External Blockers (từ PRD Open Questions)
1. Apple Developer entity + Win EV cert (block Story 8.1)
2. EULA + ToS legal draft (block Story 1.2 production content)
3. License pricing tier (block Story 7.4 payment)
4. GitHub repo public/private mix (block Story 8.4)
5. Đăng ký công ty nếu sell-as-a-service (block EULA legal entity)
