import { useEffect, useState } from 'react'
import { EULA_VERSION, needsEulaAcceptance } from '../../shared/eula-version'
import type { LicensePublicStatus } from '../../shared/ipc-schemas'
import { activateLicense, getLicenseStatus } from './api/license-api'
import { getSetting, openPrivacyPolicy, setSetting } from './api/settings-api'
import { EulaAcceptanceView } from './views/EulaAcceptanceView'
import { LicenseView } from './views/LicenseView'

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
  return (
    <main className="main-shell" data-testid="main-shell">
      {offlineGrace ? (
        <p className="warning-banner" data-testid="offline-grace-banner">
          Không kết nối được máy chủ license. Bạn vẫn có thể dùng các tác vụ đọc trong 24 giờ sau
          lần kiểm tra thành công gần nhất.
        </p>
      ) : null}
      <p className="eyebrow">Phase 3 desktop automation</p>
      <h1>Automation Desktop</h1>
      <p className="lead">
        {licenseStatus?.active
          ? `License active: còn ${licenseStatus.daysRemaining ?? 0} ngày.`
          : 'License active.'}
      </p>
    </main>
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

    return () => {
      cancelled = true
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

  if (gateState === 'needs-license' || gateState === 'license-locked') {
    return (
      <>
        {error ? <p className="error-message">{error}</p> : null}
        <LicenseView activating={activating} onActivate={handleActivate} />
      </>
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
