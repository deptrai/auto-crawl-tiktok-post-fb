import { useEffect, useState } from 'react'
import { getProxyConfig, rotateProxy, setProxyConfig } from '../api/proxy-api'

export function ProxyView(): React.JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [configured, setConfigured] = useState(false)
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadConfig(): Promise<void> {
      try {
        const config = await getProxyConfig()
        if (!cancelled) {
          setConfigured(config.configured)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Không thể đọc cấu hình proxy.')
        }
      } finally {
        if (!cancelled) setLoadingConfig(false)
      }
    }

    void loadConfig()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSave(): Promise<void> {
    const trimmed = apiKey.trim()
    if (!trimmed || saving) return

    setSaving(true)
    setError(null)
    setTestResult(null)
    try {
      await setProxyConfig(trimmed)
      setConfigured(true)
      setApiKey('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu API key proxyfb.')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest(): Promise<void> {
    if (testing) return

    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      const proxy = await rotateProxy()
      setConfigured(true)
      setTestResult(`${proxy.host}:${proxy.port}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể test proxy.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="proxy-panel" data-testid="proxy-view" aria-labelledby="proxy-title">
      <div className="profiles-list-header">
        <div>
          <p className="eyebrow">Proxy provider</p>
          <h2 id="proxy-title">proxyfb</h2>
          <p className="proxy-http-warning" data-testid="proxy-http-warning">
            proxyfb dùng kết nối HTTP (không mã hóa transport). Chỉ dùng mạng tin cậy.
          </p>
          <p className="profiles-list-subtitle">
            {loadingConfig
              ? 'Đang kiểm tra cấu hình...'
              : configured
                ? 'Đã cấu hình'
                : 'Chưa cấu hình'}
          </p>
        </div>
        {loadingConfig ? (
          <span data-testid="proxy-config-loading" className="profiles-list-loading">
            Đang tải cấu hình...
          </span>
        ) : null}
      </div>

      <div className="proxy-form">
        <label className="field-label proxy-field-label" htmlFor="proxyfb-api-key">
          API key proxyfb
          <input
            id="proxyfb-api-key"
            data-testid="proxy-api-key-input"
            className="license-input"
            type="password"
            value={apiKey}
            placeholder="Dán API key proxyfb"
            disabled={saving}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>

        <div className="proxy-actions">
          <button
            data-testid="proxy-save-button"
            className="primary-button proxy-action-button"
            type="button"
            disabled={saving || !apiKey.trim()}
            onClick={(e) => {
              ;(e.currentTarget as HTMLButtonElement).disabled = true
              void handleSave()
            }}
          >
            {saving ? <span data-testid="proxy-save-loading">Đang lưu...</span> : 'Lưu API key'}
          </button>
          <button
            data-testid="proxy-test-button"
            className="secondary-button proxy-action-button"
            type="button"
            disabled={testing || loadingConfig || !configured}
            onClick={(e) => {
              ;(e.currentTarget as HTMLButtonElement).disabled = true
              void handleTest()
            }}
          >
            {testing ? <span data-testid="proxy-test-loading">Đang test...</span> : 'Test proxy'}
          </button>
        </div>
      </div>

      {error ? (
        <p className="error-message proxy-error" data-testid="proxy-error">
          {error}
        </p>
      ) : null}

      {testResult ? (
        <p className="proxy-test-result" data-testid="proxy-test-result">
          Proxy hiện tại: {testResult}
        </p>
      ) : null}
    </section>
  )
}
