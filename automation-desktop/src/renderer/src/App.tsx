import { useEffect, useState } from 'react'
import { EULA_VERSION, needsEulaAcceptance } from '../../shared/eula-version'
import { getSetting, openPrivacyPolicy, setSetting } from './api/settings-api'
import { EulaAcceptanceView } from './views/EulaAcceptanceView'

type GateState = 'loading' | 'needs-eula' | 'ready'

function MainShell(): React.JSX.Element {
  return (
    <main className="main-shell" data-testid="main-shell">
      <p className="eyebrow">Phase 3 desktop automation</p>
      <h1>Automation Desktop</h1>
      <p className="lead">
        EULA đã được accept. Main shell placeholder sẵn sàng cho các story tiếp theo.
      </p>
    </main>
  )
}

function App(): React.JSX.Element {
  const [gateState, setGateState] = useState<GateState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadGate(): Promise<void> {
      try {
        const acceptedVersion = await getSetting('eula_accepted_version')
        if (!cancelled) setGateState(needsEulaAcceptance(acceptedVersion) ? 'needs-eula' : 'ready')
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Không thể đọc trạng thái EULA')
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
      await setSetting('eula_accepted_version', String(EULA_VERSION))
      await setSetting('telemetry_enabled', 'true')
      setGateState('ready')
    } finally {
      setAccepting(false)
    }
  }

  if (gateState === 'loading') {
    return <main className="main-shell">Đang kiểm tra EULA...</main>
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

  return <MainShell />
}

export default App
