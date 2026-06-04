import { useEffect, useState } from 'react'
import { EULA_VERSION, needsEulaAcceptance } from '../../shared/eula-version'
import type { LicensePublicStatus } from '../../shared/ipc-schemas'
import type { CaptchaProvider } from '../../shared/ipc-schemas'
import { activateLicense, getLicenseStatus, subscribeLicenseChanges } from './api/license-api'
import { getCaptchaStatus, setCaptchaEnabled, setCaptchaKey } from './api/captcha-api'
import { getSetting, openPrivacyPolicy, setSetting } from './api/settings-api'
import { EulaAcceptanceView } from './views/EulaAcceptanceView'
import { LicenseView } from './views/LicenseView'
import { ContentTemplatesView } from './views/ContentTemplatesView'
import { MessengerSeedingView } from './views/MessengerSeedingView'
import { ProfilesView } from './views/ProfilesView'
import { ProxyView } from './views/ProxyView'
import { AppShell } from './components/AppShell'
import { EmptyState } from './components/EmptyState'
import { StatusCounter } from './components/StatusCounter'
import type { ConsoleView } from './components/Sidebar'
import type { StatusCounts } from './components/StatusCounter'

const AUTOMATION_BROWSER_HEADLESS_SETTING = 'automation_browser_headless'

type GateState =
  | 'loading'
  | 'needs-eula'
  | 'needs-license'
  | 'ready'
  | 'license-expired-readonly'
  | 'license-locked'

function MainShell({
  licenseStatus,
  offlineGrace = false
}: {
  licenseStatus: LicensePublicStatus | null
  offlineGrace?: boolean
}): React.JSX.Element {
  const [activeView, setActiveView] = useState<ConsoleView>('profiles')
  const [profileCounts, setProfileCounts] = useState<StatusCounts>({
    idle: 0,
    running: 0,
    checkpoint: 0,
    error: 0
  })
  const [automationBrowserHeadless, setAutomationBrowserHeadless] = useState(false)
  const [automationBrowserModeSaving, setAutomationBrowserModeSaving] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [captchaCapsolverKey, setCaptchaCapsolverKey] = useState('')
  const [captchaTwoCaptchaKey, setCaptchaTwoCaptchaKey] = useState('')
  const [captchaCapsolverConfigured, setCaptchaCapsolverConfigured] = useState(false)
  const [captchaTwoCaptchaConfigured, setCaptchaTwoCaptchaConfigured] = useState(false)
  const [captchaEnabled, setCaptchaEnabledState] = useState(false)
  const [captchaSavingProvider, setCaptchaSavingProvider] = useState<CaptchaProvider | null>(null)
  const [captchaEnabledSaving, setCaptchaEnabledSaving] = useState(false)
  const [captchaLoading, setCaptchaLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void getSetting(AUTOMATION_BROWSER_HEADLESS_SETTING)
      .then((value) => {
        if (!cancelled) setAutomationBrowserHeadless(value === 'true')
      })
      .catch((err) => {
        if (!cancelled) {
          setSettingsError(
            err instanceof Error ? err.message : 'Không thể đọc cài đặt trình duyệt.'
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void getCaptchaStatus()
      .then((status) => {
        if (!cancelled) {
          setCaptchaCapsolverConfigured(status.capsolverConfigured)
          setCaptchaTwoCaptchaConfigured(status.twoCaptchaConfigured)
          setCaptchaEnabledState(status.enabled)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSettingsError(
            err instanceof Error ? err.message : 'Không thể đọc trạng thái CAPTCHA solver.'
          )
        }
      })
      .finally(() => {
        if (!cancelled) setCaptchaLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleAutomationBrowserModeChange(nextHeadless: boolean): Promise<void> {
    if (automationBrowserModeSaving) return
    const previous = automationBrowserHeadless
    setAutomationBrowserHeadless(nextHeadless)
    setAutomationBrowserModeSaving(true)
    setSettingsError(null)
    try {
      await setSetting(AUTOMATION_BROWSER_HEADLESS_SETTING, String(nextHeadless))
    } catch (err) {
      setAutomationBrowserHeadless(previous)
      setSettingsError(err instanceof Error ? err.message : 'Không thể lưu chế độ trình duyệt.')
    } finally {
      setAutomationBrowserModeSaving(false)
    }
  }

  async function handleCaptchaKeySave(provider: CaptchaProvider): Promise<void> {
    if (captchaSavingProvider) return
    const value = provider === 'capsolver' ? captchaCapsolverKey : captchaTwoCaptchaKey
    const trimmed = value.trim()
    if (!trimmed) return

    setCaptchaSavingProvider(provider)
    setSettingsError(null)
    try {
      await setCaptchaKey(provider, trimmed)
      if (provider === 'capsolver') {
        setCaptchaCapsolverConfigured(true)
        setCaptchaCapsolverKey('')
      } else {
        setCaptchaTwoCaptchaConfigured(true)
        setCaptchaTwoCaptchaKey('')
      }
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Không thể lưu API key CAPTCHA.')
    } finally {
      setCaptchaSavingProvider(null)
    }
  }

  async function handleCaptchaEnabledChange(nextEnabled: boolean): Promise<void> {
    if (captchaEnabledSaving) return
    const previous = captchaEnabled
    setCaptchaEnabledState(nextEnabled)
    setCaptchaEnabledSaving(true)
    setSettingsError(null)
    try {
      await setCaptchaEnabled(nextEnabled)
    } catch (err) {
      setCaptchaEnabledState(previous)
      setSettingsError(
        err instanceof Error ? err.message : 'Không thể lưu trạng thái CAPTCHA solver.'
      )
    } finally {
      setCaptchaEnabledSaving(false)
    }
  }

  function handleNavigate(view: ConsoleView): void {
    setSettingsError(null)
    setActiveView(view)
  }

  // Các view phụ render có điều kiện. ProfilesView KHÔNG render ở đây — nó được giữ
  // mounted liên tục (ẩn bằng `hidden`) để job polling + selection không mất khi đổi tab.
  function renderSecondaryView(): React.JSX.Element | null {
    if (activeView === 'dashboard') {
      const totalProfiles = Object.values(profileCounts).reduce((sum, value) => sum + value, 0)

      return (
        <section className="dashboard-panel" data-testid="dashboard-view">
          {totalProfiles === 0 ? (
            <div className="dashboard-onboarding" data-testid="dashboard-onboarding">
              <EmptyState
                icon="①"
                title="Cấu hình proxy"
                description="Lưu API key proxyfb trước để mỗi profile có proxy riêng khi chạy."
                testId="dashboard-step-proxy"
                action={{
                  label: 'Mở Proxy',
                  testId: 'dashboard-proxy-cta',
                  onClick: () => handleNavigate('proxy')
                }}
              />
              <EmptyState
                icon="②"
                title="Import profile"
                description="Dán danh sách profile hoặc JSON cookie export để tạo đội tài khoản."
                testId="dashboard-step-import"
                action={{
                  label: 'Mở Profiles',
                  testId: 'dashboard-import-cta',
                  onClick: () => handleNavigate('profiles')
                }}
              />
              <EmptyState
                icon="③"
                title="Chạy self-comment"
                description="Chọn nhiều profile, nhập URL post đích rồi chạy batch có theo dõi trạng thái."
                testId="dashboard-step-run"
              />
            </div>
          ) : (
            <div className="dashboard-summary" data-testid="dashboard-summary">
              <p className="eyebrow">Tổng quan</p>
              <h2>Đội tài khoản</h2>
              <StatusCounter counts={profileCounts} />
              <p className="profiles-list-subtitle">
                License:{' '}
                {licenseStatus?.active
                  ? `còn ${licenseStatus.daysRemaining ?? 0} ngày`
                  : 'chưa kích hoạt'}
              </p>
            </div>
          )}
        </section>
      )
    }
    if (activeView === 'templates') return <ContentTemplatesView />
    if (activeView === 'messenger') return <MessengerSeedingView />
    if (activeView === 'proxy') return <ProxyView />
    if (activeView === 'settings') {
      return (
        <section className="settings-panel" data-testid="settings-view">
          <p className="eyebrow">Cài đặt</p>
          <h2>Thiết lập vận hành</h2>
          <div className="settings-grid">
            <div className="settings-row">
              <div>
                <strong>Chế độ trình duyệt mặc định</strong>
                <p className="profiles-list-subtitle">
                  Áp dụng cho self-comment từng profile và bulk-run.
                </p>
              </div>
              <label className="settings-toggle" htmlFor="settings-headless-toggle">
                <input
                  id="settings-headless-toggle"
                  data-testid="settings-headless-toggle"
                  type="checkbox"
                  checked={automationBrowserHeadless}
                  disabled={automationBrowserModeSaving}
                  onChange={(event) => {
                    void handleAutomationBrowserModeChange(event.target.checked)
                  }}
                />
                <span>Chạy ẩn trình duyệt</span>
              </label>
            </div>
            <div className="settings-row settings-row-disabled" aria-disabled="true">
              <div>
                <strong>Chia sẻ chẩn đoán</strong>
                <p className="profiles-list-subtitle">Sắp có.</p>
              </div>
              <label className="settings-toggle" htmlFor="settings-telemetry-toggle">
                <input
                  id="settings-telemetry-toggle"
                  data-testid="settings-telemetry-toggle"
                  type="checkbox"
                  disabled
                />
                <span>Gửi dữ liệu ẩn danh</span>
              </label>
            </div>
            <div className="settings-row settings-row-captcha">
              <div>
                <strong>CAPTCHA solver</strong>
                <p className="profiles-list-subtitle">
                  Mặc định tắt. Khi bật, solver có thể tốn tiền thật và gửi proxy đang dùng sang
                  provider trong lúc giải CAPTCHA.
                </p>
                <p className="profiles-list-subtitle" data-testid="captcha-capsolver-status">
                  CapSolver:{' '}
                  {captchaLoading
                    ? 'đang kiểm tra'
                    : captchaCapsolverConfigured
                      ? 'đã cấu hình'
                      : 'chưa cấu hình'}
                </p>
                <p className="profiles-list-subtitle" data-testid="captcha-2captcha-status">
                  2captcha:{' '}
                  {captchaLoading
                    ? 'đang kiểm tra'
                    : captchaTwoCaptchaConfigured
                      ? 'đã cấu hình'
                      : 'chưa cấu hình'}
                </p>
              </div>
              <div className="settings-captcha-controls">
                <label className="field-label proxy-field-label" htmlFor="captcha-capsolver-key">
                  API key CapSolver
                  <input
                    id="captcha-capsolver-key"
                    data-testid="captcha-capsolver-key-input"
                    className="license-input"
                    type="password"
                    value={captchaCapsolverKey}
                    placeholder="Dán API key CapSolver"
                    disabled={captchaSavingProvider === 'capsolver'}
                    onChange={(event) => setCaptchaCapsolverKey(event.target.value)}
                  />
                </label>
                <button
                  data-testid="captcha-capsolver-save-button"
                  className="secondary-button proxy-action-button"
                  type="button"
                  disabled={captchaSavingProvider !== null || !captchaCapsolverKey.trim()}
                  onClick={(event) => {
                    ;(event.currentTarget as HTMLButtonElement).disabled = true
                    void handleCaptchaKeySave('capsolver')
                  }}
                >
                  {captchaSavingProvider === 'capsolver' ? 'Đang lưu...' : 'Lưu CapSolver'}
                </button>
                <label className="field-label proxy-field-label" htmlFor="captcha-2captcha-key">
                  API key 2captcha
                  <input
                    id="captcha-2captcha-key"
                    data-testid="captcha-2captcha-key-input"
                    className="license-input"
                    type="password"
                    value={captchaTwoCaptchaKey}
                    placeholder="Dán API key 2captcha"
                    disabled={captchaSavingProvider === '2captcha'}
                    onChange={(event) => setCaptchaTwoCaptchaKey(event.target.value)}
                  />
                </label>
                <button
                  data-testid="captcha-2captcha-save-button"
                  className="secondary-button proxy-action-button"
                  type="button"
                  disabled={captchaSavingProvider !== null || !captchaTwoCaptchaKey.trim()}
                  onClick={(event) => {
                    ;(event.currentTarget as HTMLButtonElement).disabled = true
                    void handleCaptchaKeySave('2captcha')
                  }}
                >
                  {captchaSavingProvider === '2captcha' ? 'Đang lưu...' : 'Lưu 2captcha'}
                </button>
                <label className="settings-toggle" htmlFor="captcha-solver-enabled-toggle">
                  <input
                    id="captcha-solver-enabled-toggle"
                    data-testid="captcha-solver-enabled-toggle"
                    type="checkbox"
                    checked={captchaEnabled}
                    disabled={captchaEnabledSaving}
                    onChange={(event) => {
                      void handleCaptchaEnabledChange(event.target.checked)
                    }}
                  />
                  <span>Bật CAPTCHA solver</span>
                </label>
              </div>
            </div>
          </div>
          {settingsError ? (
            <p className="error-message list-error" data-testid="settings-error">
              {settingsError}
            </p>
          ) : null}
          <p className="settings-shortcuts" data-testid="settings-shortcuts">
            Phím tắt: Ctrl/Cmd+A chọn tất cả trong bảng, Enter chạy bulk khi đã chọn, / focus URL.
          </p>
        </section>
      )
    }
    return null
  }

  return (
    <AppShell
      activeView={activeView}
      counts={profileCounts}
      licenseStatus={licenseStatus}
      offlineGrace={offlineGrace}
      onNavigate={handleNavigate}
    >
      {offlineGrace ? (
        <p className="warning-banner" data-testid="offline-grace-banner">
          Không kết nối được máy chủ license. Bạn vẫn có thể dùng các tác vụ đọc trong 24 giờ sau
          lần kiểm tra thành công gần nhất.
        </p>
      ) : null}
      {renderSecondaryView()}
      {/* Giữ ProfilesView luôn mounted: poll job (1s) + danh sách (5s) + selection vẫn
          duy trì khi operator chuyển sang tab khác rồi quay lại giữa batch. */}
      <div hidden={activeView !== 'profiles'}>
        <ProfilesView
          activeView={activeView}
          automationBrowserHeadless={automationBrowserHeadless}
          automationBrowserModeSaving={automationBrowserModeSaving}
          onAutomationBrowserHeadlessChange={(next) => void handleAutomationBrowserModeChange(next)}
          onStatusCountsChange={setProfileCounts}
          settingsError={settingsError}
        />
      </div>
    </AppShell>
  )
}

function ReadonlyShell({
  licenseStatus
}: {
  licenseStatus: LicensePublicStatus | null
}): React.JSX.Element {
  return (
    <main className="readonly-shell" data-testid="readonly-shell">
      <p className="eyebrow">License hết hạn</p>
      <h1>Chế độ chỉ đọc</h1>
      <p className="lead">
        License đã hết hạn hoặc bị thu hồi. Bạn vẫn có 7 ngày chỉ đọc để xem dữ liệu và export
        backup trước khi gia hạn.
      </p>
      <div className="readonly-actions">
        <button className="secondary-button" type="button">
          Export backup (sẽ được nối ở Story 7.1)
        </button>
        <p className="lead small">Hết hạn: {licenseStatus?.expiresAt ?? 'không rõ'}</p>
      </div>
    </main>
  )
}

function gateFromStatus(status: LicensePublicStatus): GateState {
  if (status.gate === 'active' || status.gate === 'offline-grace') return 'ready'
  if (status.gate === 'expired-readonly') return 'license-expired-readonly'
  if (status.gate === 'locked') return 'license-locked'
  return status.active ? 'ready' : 'needs-license'
}

function App(): React.JSX.Element {
  const [gateState, setGateState] = useState<GateState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [activating, setActivating] = useState(false)
  const [licenseStatus, setLicenseStatus] = useState<LicensePublicStatus | null>(null)

  async function loadLicenseGate(cancelled = false): Promise<void> {
    const status = await getLicenseStatus()
    if (cancelled) return
    setLicenseStatus(status)
    setGateState(gateFromStatus(status))
  }

  useEffect(() => {
    let cancelled = false

    async function loadGate(): Promise<void> {
      try {
        const acceptedVersion = await getSetting('eula_accepted_version')
        if (cancelled) return
        if (needsEulaAcceptance(acceptedVersion)) {
          setGateState('needs-eula')
          return
        }
        await loadLicenseGate(cancelled)
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : 'Không thể đọc trạng thái ứng dụng'
          )
          setGateState('needs-eula')
        }
      }
    }

    void loadGate()

    // React in real time to background license checks (expiry/revocation)
    // without waiting for an app restart (phase3:license:changed push).
    const unsubscribe = subscribeLicenseChanges((status) => {
      if (cancelled) return
      setLicenseStatus(status)
      setGateState(gateFromStatus(status))
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  async function handleAccept(): Promise<void> {
    setAccepting(true)
    setError(null)
    try {
      // Persist telemetry flag first — if it fails we haven't committed eula version yet
      await setSetting('telemetry_enabled', 'true')
      await setSetting('eula_accepted_version', String(EULA_VERSION))
      await loadLicenseGate()
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : 'Không thể lưu trạng thái EULA')
    } finally {
      setAccepting(false)
    }
  }

  async function handleActivate(key: string): Promise<void> {
    setActivating(true)
    setError(null)
    try {
      const status = await activateLicense(key)
      setLicenseStatus(status)
      if (!status.active) {
        setError('License chưa hoạt động hoặc đã hết hạn. Vui lòng kiểm tra lại key.')
      }
      setGateState(gateFromStatus(status))
    } finally {
      setActivating(false)
    }
  }

  if (gateState === 'loading') {
    return (
      <main className="loading-shell" data-testid="loading-shell">
        Đang kiểm tra license...
      </main>
    )
  }

  if (gateState === 'needs-eula') {
    return (
      <>
        {error ? <p className="error-message">{error}</p> : null}
        <EulaAcceptanceView
          accepting={accepting}
          onAccept={handleAccept}
          onOpenPrivacyPolicy={openPrivacyPolicy}
        />
      </>
    )
  }

  if (gateState === 'license-locked') {
    // Distinct marker so E2E can tell "expired/revoked → locked" apart from
    // "never activated" — both render LicenseView but mean different gates.
    return (
      <div data-testid="license-locked">
        {error ? <p className="error-message">{error}</p> : null}
        <LicenseView activating={activating} onActivate={handleActivate} />
      </div>
    )
  }

  if (gateState === 'needs-license') {
    return (
      <div data-testid="needs-license">
        {error ? <p className="error-message">{error}</p> : null}
        <LicenseView activating={activating} onActivate={handleActivate} />
      </div>
    )
  }

  if (gateState === 'license-expired-readonly') {
    return <ReadonlyShell licenseStatus={licenseStatus} />
  }

  return (
    <MainShell
      licenseStatus={licenseStatus}
      offlineGrace={licenseStatus?.gate === 'offline-grace'}
    />
  )
}

export default App
