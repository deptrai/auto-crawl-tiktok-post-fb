import { useState } from 'react'

interface LicenseViewProps {
  activating: boolean
  onActivate: (key: string) => Promise<void>
}

export function LicenseView({ activating, onActivate }: LicenseViewProps): React.JSX.Element {
  const [key, setKey] = useState(window.api.localDefaults.licenseKey)
  const [error, setError] = useState<string | null>(null)

  async function handleActivate(event: React.MouseEvent<HTMLButtonElement>): Promise<void> {
    event.currentTarget.disabled = true
    setError(null)
    try {
      await onActivate(key.trim())
    } catch (activateError) {
      setError(
        activateError instanceof Error
          ? activateError.message
          : 'Không thể kích hoạt license. Vui lòng thử lại.'
      )
    }
  }

  return (
    <main className="license-card" data-testid="license-view" aria-labelledby="license-title">
      <p className="eyebrow">Kích hoạt bản quyền</p>
      <h1 id="license-title">Nhập license key</h1>
      <p className="lead">
        License sẽ được gắn với máy hiện tại bằng HWID. Nếu bạn đổi máy, hãy liên hệ hỗ trợ để
        rebind.
      </p>

      <label className="field-label">
        License key
        <input
          aria-label="License key"
          className="license-input"
          value={key}
          onChange={(event) => setKey(event.currentTarget.value)}
          placeholder="LIC-..."
          autoComplete="off"
        />
      </label>

      {error ? <p className="error-message">{error}</p> : null}

      <button
        className="primary-button"
        type="button"
        disabled={!key.trim() || activating}
        onClick={(event) => void handleActivate(event)}
      >
        {activating ? 'Đang kích hoạt...' : 'Kích hoạt license'}
      </button>
    </main>
  )
}
