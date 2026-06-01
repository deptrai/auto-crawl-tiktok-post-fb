---
stepsCompleted: ['step-01-init.md', 'step-02-discovery.md', 'step-02b-vision.md', 'step-02c-executive-summary.md', 'step-03-success.md', 'step-04-journeys.md', 'step-05-domain.md', 'step-06-innovation.md', 'step-07-project-type.md', 'step-08-scoping.md', 'step-09-functional.md', 'step-10-nonfunctional.md', 'step-11-polish.md', 'step-12-complete.md']
status: 'complete'
completedAt: '2026-06-01'
inputDocuments: ['_bmad-output/planning-artifacts/architecture.md (Phase 3 Addendum)', '_bmad-output/project-context.md', 'automation-facebook/docs/project-overview.md', 'automation-facebook/docs/architecture.md', 'automation-facebook/_bmad-output/project-context.md']
workflowType: 'prd'
workflow: 'create'
releaseMode: 'phased'
phase: 'phase-3'
parentPRD: '_bmad-output/planning-artifacts/prd.md'
classification:
  projectType: 'desktop_licensed_automation_tool'
  domain: 'facebook_cookie_automation'
  complexity: 'high'
  projectContext: 'brownfield-extension'
---

# Product Requirements Document — Phase 3: Facebook Cookie-Based Automation Desktop

**Author:** Luisphan
**Date:** 2026-06-01
**Status:** Draft (in progress)
**Parent product:** auto-crawl-tiktok-post-fb (Phase 1+2 SaaS, độc lập)
**Companion document:** `architecture.md` § Phase 3 Architecture Addendum (READY_FOR_IMPLEMENTATION)

## Executive Summary

Phase 3 chuyển hóa công cụ Facebook automation `SST_TOOL_FB` (C# WinForms legacy, ~4.166 LOC, Windows-only) thành một **desktop application hiện đại đa nền tảng** (Electron, Mac/Windows), phân phối theo mô hình **license key tính theo ngày** (admin set số ngày). Sản phẩm cho phép user cá nhân — affiliate marketer, content creator — quản lý hàng loạt Facebook profile (UID, cookie, 2FA), tự động hóa các hành động (đăng bài, bình luận, react, share, kết bạn) thông qua cookie-based login + Playwright stealth, với proxy rotation và anti-detection.

Khác biệt cốt lõi về kiến trúc so với tool nguồn: thay vì "port một lần rồi cố giữ", Phase 3 được thiết kế xoay quanh **tốc độ thích nghi (adapt time)**. Khi Facebook thay đổi cấu trúc DOM hoặc siết anti-bot, hệ thống push **hot config selector đã ký Ed25519** xuống client trong dưới 1 giờ — user tự cập nhật mà không cần tải lại app. Telemetry beacon ẩn danh bắt buộc cung cấp tín hiệu drift để phát hiện sự cố trong dưới 24 giờ.

Phase 3 vận hành **độc lập** với pipeline TikTok→FB Reels (Phase 1+2, dùng Graph API chính chủ), chỉ chia sẻ backend auth. Mô hình **tool vendor** (user là operator, không phải nền tảng vận hành thay user) dịch chuyển trách nhiệm pháp lý về phía user và bảo vệ tài sản Graph API của Phase 1+2.

### What Makes This Special

1. **Adapt time là vũ khí cạnh tranh.** Trong domain Facebook automation, không tồn tại "giải pháp đúng vĩnh viễn" — chỉ có "ai phục hồi nhanh hơn thì sống". Khi đối thủ mất nhiều ngày để vá selector và phát hành lại app, Phase 3 push hot config trong dưới 1 giờ qua kênh đã ký số, user áp dụng tự động trong vòng 1 giờ tiếp theo. Đây là differentiator được "khắc" vào kiến trúc (hot config + canary cohort 5% + telemetry SLO), không phải tính năng thêm vào sau.

2. **Stealth quality cao hơn SaaS.** Chạy trực tiếp trên máy user với residential IP thật và machine fingerprint thật (diversified per user) — khó bị Facebook mass-detect hơn nhiều so với server farm tập trung của mô hình SaaS.

3. **Anti-crack thực sự, không chỉ trang trí.** License online + HWID binding + per-action server-side token cho hành động rủi ro cao (tier 2+) khiến crack thuần client-side không hoạt động — bảo vệ doanh thu recurring.

4. **Bảo vệ tài sản hiện hữu.** Tách biệt hoàn toàn về product flow, distribution và billing entity với Phase 1+2, ngăn rủi ro Facebook ban liên đới làm mất pipeline Reels chính thống.

### Core Insight

Facebook automation là một cuộc đua vũ trang (arms race) liên tục. Mọi quyết định kiến trúc Phase 3 — hot config thay vì hardcode selector, canary cohort thay vì big-bang rollout, telemetry SLO thay vì phỏng đoán, adapter layer thay vì khóa cứng framework — đều phục vụ một mục tiêu duy nhất: **rút ngắn thời gian thích nghi (adapt time) xuống dưới thời gian Facebook phát hiện (detection time)**.

## Project Classification

- **Project Type:** Desktop licensed automation tool (Electron, time-based license key, phân phối qua GitHub Releases + S3 mirror)
- **Domain:** Facebook cookie-based automation (cookie login, mass actions, proxy rotation, anti-detection stealth)
- **Complexity:** HIGH — browser automation + anti-detection + license system + polyglot (Python backend + TypeScript Electron) + 16 risk mitigation anchors
- **Project Context:** Brownfield extension — mở rộng từ codebase auto-crawl-tiktok-post-fb (Phase 1+2), chia sẻ backend auth, nhưng product flow / distribution / billing tách biệt
- **Target User:** Cá nhân (affiliate marketer, content creator, small operator) — KHÔNG phải agency/enterprise
- **Distribution Model:** Tool vendor (user là operator, vendor cung cấp công cụ — tương tự AdsPower, MultiLogin, JetBrains)

## Success Criteria

### User Success

User cá nhân (affiliate/creator) cảm thấy tool "đáng tiền" khi:
- Chạy được ≥ 10 profile FB song song mà không bị mass-checkpoint
- Khi FB siết, tool tự phục hồi trong vài giờ (không phải chờ vài ngày) — user nhận thông báo "đã cập nhật selector" thay vì "tool hỏng"
- Setup từ lúc cài đến lúc chạy action đầu tiên < 15 phút (import profile bulk + activate license)
- Cookie/2FA an toàn — user tin tưởng giao credential cho tool (không lo bị lộ)

"Aha moment": lần đầu thấy 1 profile tự login → comment thành công mà không phải thao tác tay.

### Business Success

- **3 tháng (Phase 3.0 launch)**: `[TBD]` user trả tiền license đang active — *assumption cần Luisphan validate*
- **12 tháng**: `[TBD]` user recurring, churn < `[TBD]`% — *assumption cần validate*
- License renewal rate > 60% (user gia hạn = tool thực sự hữu ích)
- Crack rate < 15% (R-D9 server-side action token hiệu quả)
- **Pricing reference**: `[TBD]` VND/$ per license-30-ngày — *cần Luisphan quyết, ảnh hưởng revenue target*

### Technical Success (từ architecture SLO)

- **Adapt Time SLO**: selector regression detect < 24h (telemetry beacon), hot config fix push < 1h
- **Action success rate** ≥ 85% (không tính checkpoint do account user quá "bẩn")
- **Checkpoint rate** < 10% trên canary profile aged
- **License online check** uptime ≥ 99% (block write action nếu down)
- **App crash-free session** ≥ 95%
- **Update adoption**: ≥ 90% user lên min_supported_version trong 7 ngày forced update

### Measurable Outcomes

| Metric | Target | Đo bằng |
|---|---|---|
| Selector drift detection | < 24h | Telemetry beacon SLO alert |
| Hot config fix deployment | < 1h | Config publish → canary apply timestamp |
| Action success rate | ≥ 85% | Beacon `action_outcome_category` aggregate |
| Crack rate | < 15% | License activation vs telemetry HWID mismatch |
| License renewal rate | > 60% | Backend `phase3.license_activations` renewal count |
| Time-to-first-action | < 15 phút | Onboarding telemetry (opt-in) |
| Checkpoint rate (canary) | < 10% | Canary `automation_canary_health` |

> **Chi tiết scope theo sub-phase**: xem § Project Scoping & Phased Development bên dưới.

## User Journeys

### Journey 1 — End User Happy Path: "Minh chạy chiến dịch comment đầu tiên"

**Persona**: Minh, 26 tuổi, affiliate marketer bán mỹ phẩm. Có 15 tài khoản FB nuôi sẵn (mua cookie + 2FA). Trước đây dùng tool C# trên 1 máy Windows cũ, hay crash, mỗi lần FB update là đứng hình cả tuần.

- **Opening Scene**: Minh tải Phase 3 desktop app từ link mua license. Mở app lần đầu → màn hình EULA (acknowledge rủi ro FB ToS) → nhập license key → app bind HWID, hiện "License active: còn 30 ngày".
- **Rising Action**: Minh paste danh sách 15 profile theo format `uid|pass|2fa|cookie|...` vào Bulk Import. App lưu cookie vào OS keychain (safeStorage), profile metadata vào SQLCipher. Minh chọn 1 profile, bấm "Test self-comment".
- **Climax**: App acquire proxy (proxyfb) → launch Chromium stealth → login bằng cookie → tự comment lên post của chính profile đó. Status PENDING → ... → DONE. Minh thấy comment thật xuất hiện trên FB.
- **Resolution**: Minh tin tưởng, import nốt 14 profile, lên lịch chạy. Cảm giác "cuối cùng cũng có tool không sợ FB update".

**Reveals**: License activation, EULA gate, bulk import parser, safeStorage, proxy acquisition, state machine, self-comment executor, status UI.

### Journey 2 — End User Edge Case: "FB siết, tool tự phục hồi"

**Persona**: Minh (tiếp), 3 tuần sau.

- **Opening Scene**: Sáng thứ Hai, mở app → 3/15 profile báo `SELECTOR_MISS` (FB đổi DOM nút comment đêm qua).
- **Rising Action**: App tự động: telemetry beacon gửi `selector_miss` → backend SLO alert cho Admin. Đồng thời selector-resolver thử 4-tier fallback (ARIA → testid → text → visual). Tier `text` vẫn hoạt động → 12/15 profile vẫn chạy, 3 profile khó thì retry.
- **Climax**: Trong vòng 1 giờ, Admin push hot config selector mới (Ed25519 signed). App pull config, verify signature, canary apply → comment hoạt động lại 15/15.
- **Resolution**: Minh nhận notification "Đã cập nhật bộ chọn, hệ thống hoạt động bình thường" — không cần làm gì, không cần update app. Khoảnh khắc Minh quyết định renew license.

**Reveals**: 4-tier selector fallback, telemetry drift detection, hot config pull + signature verify + canary apply, in-app notification, retry policy.

### Journey 3 — Admin (Luisphan): "Tạo license và giám sát SLO"

**Persona**: Luisphan, vendor/admin, dùng web dashboard (frontend Phase 1+2 extended).

- **Opening Scene**: Khách mua license 90 ngày. Luisphan mở LicenseManagement → tạo key, set days=90 → gửi key.
- **Rising Action**: Vài ngày sau, TelemetryDashboard cảnh báo: action success rate sụt 92% → 71% trong 1h trên cohort canary. Luisphan biết FB vừa siết.
- **Climax**: Mở SelectorConfigEditor → sửa selector → ký Ed25519 offline (scripts/sign-config.ts) → publish canary_pct=5%. Theo dõi 1h → phục hồi → tăng canary 100%.
- **Resolution**: Toàn bộ user phục hồi < 2h. Check AppVersionConsole — không cần force update, chỉ hot config.

**Reveals**: Admin license CRUD, telemetry SLO alert, selector config editor, Ed25519 signing, canary rollout control, app version console.

### Journey 4 — Support/Recovery: "User mất máy, cần khôi phục"

**Persona**: Minh đổi laptop mới (laptop cũ hỏng).

- **Opening Scene**: Cài app máy mới → license báo `HWID_MISMATCH`.
- **Rising Action**: Minh vào self-service portal → "Rebind HWID" (2 lần free/năm). Nhưng profile + cookie nằm trên máy cũ đã hỏng.
- **Climax**: May mắn đã export `.p3backup` (AES-256-GCM, passphrase) tuần trước. Máy mới: Import Backup → nhập passphrase → profile + cookie + history khôi phục.
- **Resolution**: Chạy lại bình thường. Bài học: app nhắc backup định kỳ.

**Reveals**: HWID rebind (R-D14), self-service portal, backup export/import (ADR-D11), passphrase recovery, backup reminder UX.

### Journey Requirements Summary

| Journey | Capabilities revealed |
|---|---|
| J1 Happy path | EULA gate, license activate, HWID bind, bulk import, safeStorage, proxy, state machine, self-comment, status UI |
| J2 FB siết | 4-tier selector, telemetry drift, hot config + signature + canary, notification, retry |
| J3 Admin | License CRUD, SLO dashboard, selector editor, Ed25519 sign, canary control, version console |
| J4 Recovery | HWID rebind, self-service portal, backup export/import, passphrase recovery |

→ Toàn bộ 13 FR + 16 R-D anchor đều được "kích hoạt" bởi ít nhất 1 journey. Không có FR mồ côi.

## Domain-Specific Requirements

### Compliance & Regulatory

- **Facebook ToS risk (CORE)**: Cookie-based automation có thể vi phạm Facebook Terms of Service. Mô hình tool vendor dịch chuyển trách nhiệm: EULA bắt buộc user acknowledge rủi ro tài khoản trước khi import profile. Vendor cung cấp công cụ, user là operator.
- **Nghị định 13/2023/NĐ-CP (PDPL Việt Nam)**: Tool xử lý dữ liệu cá nhân (cookie, credential FB của user). Bắt buộc: mã hóa at rest (safeStorage + SQLCipher), không thu thập telemetry chứa PII, privacy policy minh bạch.
- **Phân tách trách nhiệm pháp lý với Phase 1+2**: Phase 1+2 dùng Graph API chính chủ. Phase 3 tách billing entity + EULA riêng để rủi ro Phase 3 không lan sang giấy phép FB App của Phase 1+2.

### Technical Constraints (Anti-Detection — domain-defining)

- **Fingerprint diversification (R-D15)**: Mỗi user fingerprint unique (UA, viewport, timezone, font, WebGL noise) tránh cohort detection. Constraint sống còn — bỏ qua = mass ban.
- **Residential IP qua proxy**: Datacenter IP bị FB flag ngay. Bắt buộc residential proxy (proxyfb/tmproxy/shoplike).
- **Behavioral mimicry (warmup)**: Action mô phỏng hành vi người thật (delay ngẫu nhiên, scroll). Bot-like timing = checkpoint.
- **Selector brittleness**: FB obfuscate CSS hash đổi mỗi build → 4-tier selector strategy + hot config (không hardcode).
- **Session isolation**: 1 BrowserContext per profile, không share cookie/storage.

### Privacy & Security Requirements

- **Secret at rest**: Cookie + 2FA seed CHỈ trong OS keychain (safeStorage), không plaintext SQLite/log (lỗi tool C# nguồn).
- **Log redaction mandatory**: Mọi log qua middleware redact cookie/c_user/xs/datr/password/2FA/fb_dtsg.
- **Telemetry anonymization**: Beacon chỉ count + outcome category, không UID/content/cookie.
- **Backup encryption**: `.p3backup` AES-256-GCM với passphrase user-chosen.

### Integration Requirements

- **Facebook (consumed)**: HTTP token extraction + browser automation qua Playwright stealth bundled Chromium.
- **Proxy providers**: proxyfb (GET), tmproxy (POST), shoplike (GET) — circuit breaker + health check.
- **Own backend**: license + per-action token + selector config + telemetry + version.
- **Code signing**: Apple Developer (notarization) + Microsoft Authenticode.
- **Distribution**: GitHub Releases + S3 mirror (DMCA resilience).

### Domain Risks & Mitigations

| Risk | Mitigation | Anchor |
|---|---|---|
| FB detection wave → mass checkpoint | Aged canary + drift detect < 24h + fingerprint diversification | R-D1, R-D15 |
| Selector break → tool "hỏng" | 4-tier fallback + hot config < 1h | R-D2, R-D11 |
| Cookie leak → user data breach | safeStorage + log redaction + `Secret<T>` marker | R-D3 |
| License crack → revenue loss | Server-side per-action token + HWID bind | R-D9 |
| Liability spillover → mất FB App Phase 1+2 | Tool vendor EULA + billing entity tách | R-D7 |
| Proxy provider MITM | Cert pinning với FB endpoints | NFR-Security |
| Code sign cert revoked | 2 cert active + fallback distribution | R-D10 |
| Supply chain (npm) | pnpm audit + Snyk + Renovate + pin version | R-D12 |

### Domain Anti-Patterns (phải tránh)

- ❌ Hardcode selector (tool C# nguồn mắc lỗi này)
- ❌ Datacenter IP (instant flag)
- ❌ Cùng fingerprint cho nhiều profile (cohort detection)
- ❌ Action không delay/randomization (bot-like → checkpoint)
- ❌ Plaintext credential storage (tool C# nguồn mắc lỗi này)
- ❌ Big-bang selector rollout không canary (1 lỗi → mass break)

## Innovation & Novel Patterns

### Detected Innovation Areas

1. **Adapt-time as architecture, not feature** — Phần lớn FB automation tool (kể cả AdsPower, MultiLogin) coi cập nhật selector là maintenance thủ công. Phase 3 biến nó thành kiến trúc cốt lõi: hot config Ed25519 signed + client canary cohort + telemetry SLO tạo vòng lặp tự phục hồi < 1h.
2. **Hybrid trust model** — Per-action server-side token (R-D9) cho desktop app: kết hợp offline-capability của desktop với revenue protection của SaaS. Crack thuần client-side vô hiệu mà vẫn giữ stealth local execution.
3. **Brownfield polyglot reuse** — Tận dụng backend FastAPI Phase 1+2 làm license/telemetry server cho desktop Electron, share auth nhưng tách product.

### Market Context & Competitive Landscape

Đối thủ (AdsPower, MultiLogin, GoLogin, Dolphin{anty}): desktop + license, anti-detect browser. Differentiator Phase 3:
- **Adapt time < 1h** (đối thủ release-cycle ngày) — competitive edge chính
- **Việt Nam-first**: UI tiếng Việt, proxy provider VN, giá theo thị trường VN
- **Niche Facebook**: selector quality sâu hơn (đối thủ đa nền tảng)

### Validation Approach

- **Phase 3.0 self-comment** validate toàn stack với action low blast radius trước write action rủi ro cao
- **Canary cohort 5%** validate mỗi hot config + version trước rollout 100%
- **Aged canary profile** validate detection drift trước khi ảnh hưởng user thật
- **6-tuần SLO stability gate** giữa mỗi sub-phase

### Risk Mitigation

- Adapt-time không đủ (FB siết nhanh hơn 1h): fallback bundled selector + 4-tier resolver
- Market quá nhỏ (VN niche): i18n SEA expansion (Vision)
- FB thay đổi căn bản (mobile-only): R-D16 adapter layer cho pivot

## Desktop Licensed Automation Tool — Specific Requirements

### Project-Type Overview

Electron desktop app distributed qua license-by-days, target cá nhân, cross-platform Mac/Windows (Linux Phase 3.1+). Khác SaaS: execution trên máy user, không server-side. Khác mobile: full filesystem + bundled Chromium + OS keychain access.

### Technical Architecture Considerations

**Platform Requirements:**
- Windows 10+ (x64), macOS 12+ (Apple Silicon + Intel)
- Linux AppImage (Phase 3.1+ optional)
- Min RAM 8GB (bundled Chromium + N profile session)
- Disk ~500MB (app + Chromium) + profile data

**Desktop-Specific Capabilities:**
- OS keychain (safeStorage): macOS Keychain / Windows Credential Manager / Linux libsecret
- Encrypted local DB (SQLCipher)
- Background scheduler (local cron)
- Auto-update (electron-updater + Squirrel)
- Code signing + notarization (Gatekeeper + SmartScreen)

**Licensing Model:**
- Time-based key (admin set days)
- HWID binding: SHA-256(machine_uuid + mac + cpu_brand)
- Online check 4h, offline grace 24h tier 1
- Per-action token tier 2+ (JWT HS256, jti nonce, 60s TTL)
- Self-service portal: extend, rebind (2 free/năm), pause

**Update & Distribution:**
- 3 channel: stable / beta / canary
- Forced update khi version < min_supported
- Double-sign: code-sign cert + Ed25519
- GitHub Releases + S3 mirror fallback
- Opt-in delay 24h non-critical

### Browser Automation Considerations

- Playwright + playwright-extra + stealth plugin
- Bundled Chromium (pinned version, fingerprint diversified per user)
- 1 BrowserContext per profile (isolation)
- Proxy binding per context
- 4-tier selector resolver + hot config

### Implementation Considerations

- **Polyglot boundary**: Electron (TS) client ↔ FastAPI (Python) backend qua HTTPS REST + cert pinning
- **Adapter layer (R-D16)**: ipc/storage/updater/window decoupled từ Electron
- **State machine**: automation_jobs local SQLite, 10 states + LICENSE_EXPIRED_READ_ONLY
- **Telemetry**: mandatory beacon + opt-in detail
- **Security baseline**: sandbox: true, contextIsolation, CSP, bytenode sensitive logic

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach**: Risk-validation MVP — Phase 3.0 chứng minh toàn bộ stack hoạt động (polyglot + stealth + license + state machine + checkpoint flow) với 1 action **low blast radius** (self-comment), trước khi mở write action rủi ro cao.

**Resource Requirements**: Solo dev + AI agent (Claude Code, Codex). Không hire team.

### MVP Feature Set (Phase 3.0)

**Core Journeys Supported**: J1 (happy path), J3 (admin), J4 (recovery), một phần J2 (selector fallback).

**Must-Have Capabilities** (block launch):
- FR-P3-01 Profile CRUD + bulk import
- FR-P3-02 License activate + HWID + per-action token
- FR-P3-03 Hot config selector (Ed25519 + canary)
- FR-P3-04 Auto-update + forced update
- FR-P3-05 Cookie login + 2FA
- FR-P3-06 Token extraction
- FR-P3-07 Self-comment (validation action)
- FR-P3-08 Proxy rotation (1 provider: proxyfb)
- FR-P3-09 Canary + drift detection
- EULA acceptance flow
- Backup/recovery (ADR-D11)
- Telemetry (mandatory beacon + opt-in detail)

**Ship gate**: 6 tuần SLO stability.

### Post-MVP Features

**Phase 3.1 (Core value)**: FR-P3-10 Mass post + warmup; proxy provider thứ 2 (tmproxy); self-service license portal.

**Phase 3.2 (Expand reach)**: FR-P3-11 Mass comment 3rd party + react; proxy provider thứ 3 (shoplike).

**Phase 3.3 (Power users)**: FR-P3-12 Share + friend request.

**Phase 3.4 (Optional, deferred)**: FR-P3-13 Feed scrape (chỉ khi có use case cụ thể).

### Risk Mitigation Strategy

**Technical Risks**: Selector brittleness → 4-tier resolver + hot config (R-D2); stealth detection → fingerprint diversification + aged canary (R-D15, R-D1); license crack → server-side per-action token (R-D9).

**Market Risks**: VN niche → architecture cho i18n SEA expansion; user churn về tool C# → migration path + parallel support đến Q4/2027.

**Resource Risks (solo)**: Mỗi sub-phase ship-or-kill độc lập; AI agent giảm dev bottleneck; 6-tuần SLO gate ngăn over-extend.

## Functional Requirements

> **CAPABILITY CONTRACT** — 37 FR binding. Tính năng không có ở đây sẽ KHÔNG tồn tại trừ khi thêm vào explicitly.

### Profile Management

- FR1: User có thể import hàng loạt profile Facebook theo định dạng `uid|pass|2fa|cookie|hotmail|passmail`
- FR2: User có thể xem, sửa, xóa từng profile và metadata (proxy assignment, fingerprint)
- FR3: User có thể xem trạng thái real-time của từng profile (idle, running, checkpoint, error)
- FR4: Hệ thống lưu cookie + 2FA seed trong OS keychain, profile metadata trong DB mã hóa

### Licensing & Access Control

- FR5: User có thể kích hoạt license bằng key, ràng buộc với HWID của máy
- FR6: Hệ thống kiểm tra license định kỳ online và cho phép offline grace cho hành động tier 1
- FR7: Hệ thống cấp token server-side cho mỗi hành động tier 2+ (post, comment, share)
- FR8: User có thể gia hạn, rebind HWID (giới hạn lần/năm), pause license qua self-service portal
- FR9: Admin có thể tạo license key với số ngày tùy chỉnh và thu hồi license
- FR10: Hệ thống block toàn bộ hành động khi license hết hạn, cho phép read-only grace 7 ngày để export

### Facebook Automation Engine

- FR11: Hệ thống đăng nhập Facebook bằng cookie và xử lý 2FA/checkpoint
- FR12: Hệ thống trích xuất CSRF token (fb_dtsg/lsd/jazoest) qua HTTP
- FR13: User có thể chạy self-comment trên post của chính profile (validation action)
- FR14: User có thể chạy mass post lên timeline profile *(Phase 3.1)*
- FR15: User có thể chạy mass comment trên post bên thứ ba và mass react *(Phase 3.2)*
- FR16: User có thể chạy share và friend request *(Phase 3.3)*
- FR17: Hệ thống thực hiện warmup behavior (mô phỏng người dùng) trước action thật *(Phase 3.1)*
- FR18: Hệ thống quản lý job automation qua state machine với checkpoint/resume

### Anti-Detection & Resilience

- FR19: Hệ thống áp dụng fingerprint diversified per user (UA, viewport, timezone, font, WebGL)
- FR20: Hệ thống resolve selector qua 4-tier fallback (ARIA → testid → text → visual)
- FR21: Hệ thống pull hot config selector đã ký Ed25519 và verify signature trước khi áp dụng
- FR22: Hệ thống áp dụng hot config theo canary cohort 5% trước khi rollout toàn bộ
- FR23: Hệ thống chạy canary profile để phát hiện detection drift sớm

### Proxy Management

- FR24: User có thể cấu hình và xoay proxy qua nhiều provider (proxyfb, tmproxy, shoplike)
- FR25: Hệ thống health-check proxy và circuit-break provider lỗi
- FR26: Hệ thống bind proxy riêng cho mỗi profile session

### Updates & Distribution

- FR27: Hệ thống tự động kiểm tra và cài đặt update qua kênh đã ký số
- FR28: Hệ thống force update khi version dưới ngưỡng tối thiểu do server quy định
- FR29: Admin có thể publish app version mới với release notes và đặt min_supported_version

### Telemetry & Observability

- FR30: Hệ thống gửi beacon ẩn danh bắt buộc (version, outcome category) sau khi user accept EULA
- FR31: User có thể bật/tắt telemetry chi tiết (opt-in, mặc định tắt)
- FR32: Admin có thể xem dashboard SLO (action success rate, checkpoint rate, drift alert)

### Backup & Recovery

- FR33: User có thể export profile + automation state ra file mã hóa với passphrase
- FR34: User có thể import backup file để khôi phục trên máy mới
- FR35: Hệ thống nhắc user backup định kỳ

### Compliance & Onboarding

- FR36: User phải accept EULA (acknowledge rủi ro FB ToS) trước khi sử dụng
- FR37: Hệ thống hiển thị privacy policy và phạm vi telemetry minh bạch

## Non-Functional Requirements

### Performance

- NFR1: App khởi động (cold start) < 5 giây trên máy đạt min spec
- NFR2: Self-comment action hoàn thành end-to-end < 60 giây (login + execute)
- NFR3: Hỗ trợ ≥ 10 profile session đồng thời trên máy 8GB RAM mà không OOM
- NFR4: Hot config pull + verify + apply < 3 giây
- NFR5: IPC round-trip (renderer ↔ main) < 100ms cho thao tác UI

### Security

- NFR6: Cookie + 2FA seed mã hóa at rest qua OS keychain (safeStorage), không bao giờ plaintext
- NFR7: Profile DB mã hóa SQLCipher (AES-256), key derived từ safeStorage master
- NFR8: Mọi log đi qua redaction middleware — không chứa cookie/password/2FA/CSRF token
- NFR9: Hot config + update package verify Ed25519 signature trước khi áp dụng
- NFR10: Cert pinning với update endpoint và FB endpoints
- NFR11: Renderer chạy sandbox: true + contextIsolation, không truy cập Node API trực tiếp
- NFR12: Sensitive logic (license check, token signing) compile bytenode
- NFR13: Backup file mã hóa AES-256-GCM với passphrase user-chosen (PBKDF2 100k iteration)

### Reliability (Adapt Time SLO)

- NFR14: Selector regression detect < 24 giờ qua telemetry beacon
- NFR15: Hot config fix push deployment < 1 giờ
- NFR16: Action success rate ≥ 85% (không tính account user quá "bẩn")
- NFR17: App crash-free session rate ≥ 95%
- NFR18: License online check uptime ≥ 99%; offline grace 24h tier 1 action
- NFR19: State machine job có thể resume sau crash (không retry-from-scratch)

### Compliance & Privacy

- NFR20: Telemetry beacon ẩn danh — không chứa UID, cookie, content, profile name
- NFR21: User phải accept EULA trước khi telemetry beacon được kích hoạt
- NFR22: Tuân thủ Nghị định 13/2023 — mã hóa dữ liệu cá nhân, privacy policy minh bạch
- NFR23: Phân tách billing entity + EULA với Phase 1+2 (tool vendor liability isolation)

### Maintainability (Agent-Velocity)

- NFR24: Mọi business logic truy cập framework qua adapter layer (R-D16), không import `electron` trực tiếp
- NFR25: Mọi IPC payload validate Zod schema 2 chiều
- NFR26: Test coverage ≥ 70% cho main process service logic (cho AI agent tự verify)
- NFR27: Lint rule enforce: no-restricted-imports, no-secret-in-ipc-payload, no-secret-tostring, no-direct-logger

### Localization

- NFR28: Phase 3.0 → 3.4 UI + error message + EULA + privacy policy lock tiếng Việt (i18n defer Phase 3.5+)

### Compatibility

- NFR29: Hỗ trợ Windows 10+ (x64) và macOS 12+ (Apple Silicon + Intel)
- NFR30: Update adoption ≥ 90% user lên min_supported_version trong 7 ngày forced update

## Open Questions & Working Assumptions

Các điểm cần Luisphan quyết/validate trước hoặc trong quá trình implement (không block tạo epics & stories, nhưng block public launch).

### Working Assumptions (chưa confirm — có thể điều chỉnh)

1. **Adapt-time là differentiator chính** (không phải giá rẻ / nhiều feature)
2. **Tool C# `SST_TOOL_FB` đã có user thật** → Phase 3 là migration path cho họ
3. **Business goal**: recurring revenue qua license-by-days

### Business Metrics cần quyết (`[TBD]`)

- 3-month paid user target
- 12-month user target + churn ngưỡng
- Pricing reference per license-30-ngày (VND/$)

### Pending Business Actions (từ Architecture)

| Action | Block | Status |
|---|---|---|
| Setup separate Apple Developer entity ($99/year) | Release pipeline (ADR-D5) | OPEN |
| Draft EULA + ToS Phase 3 với legal advisor | Public release | OPEN |
| Decide license pricing tier (30/90/180/365 ngày) | Self-service portal | OPEN |
| Decide GitHub repo public/private mix | Distribution channel | OPEN |
| Đăng ký công ty (TNHH 1TV VN / offshore) — nếu sell-as-a-service | EULA legal entity | OPEN |

## References

- **Architecture**: `architecture.md` § Phase 3 Architecture Addendum (11 ADR-D, 16 R-D anchor, status READY_FOR_IMPLEMENTATION)
- **Source tool**: `automation-facebook/SST_TOOL_FB/` (C# WinForms) + `automation-facebook/docs/`
- **POC**: `automation-facebook/poc-nodejs/` (Playwright + stealth verified)
- **Parent PRD**: `prd.md` (Phase 1+2 SaaS, độc lập)
