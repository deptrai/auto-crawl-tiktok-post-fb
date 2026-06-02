import { useState } from 'react'
import type { ImportResult } from '../../../shared/ipc-schemas'
import { importBulkProfiles } from '../api/profile-api'

export function ProfilesView(): React.JSX.Element {
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleImport(): Promise<void> {
    if (!text.trim() || importing) return
    setImporting(true)
    setError(null)
    setResult(null)
    try {
      const res = await importBulkProfiles(text)
      setResult(res)
      // Clear textarea after import — do not keep secrets in DOM (rule #10, exception clause)
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể import profile.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="profiles-view" data-testid="profiles-view">
      <p className="eyebrow">Quản lý tài khoản</p>
      <h1>Import Profile</h1>
      <p className="lead">
        Dán danh sách tài khoản theo định dạng{' '}
        <code>uid|pass|2fa|cookie|hotmail|passmail</code> (mỗi dòng một tài khoản).
      </p>

      <div className="import-form">
        <textarea
          data-testid="import-textarea"
          className="import-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'uid1|pass1|seed1|cookie1|email@mail.com|mailpass\n# dòng bắt đầu # là comment, bị bỏ qua'}
          rows={8}
          disabled={importing}
          aria-label="Danh sách profile để import"
        />

        <button
          data-testid="import-button"
          className="import-button"
          disabled={importing || !text.trim()}
          onClick={(e) => {
            // Disable immediately to prevent double-click race (rule #17)
            ;(e.currentTarget as HTMLButtonElement).disabled = true
            void handleImport()
          }}
        >
          {importing ? (
            <span data-testid="import-loading" className="import-loading-indicator">
              Đang import...
            </span>
          ) : (
            'Import'
          )}
        </button>
      </div>

      {error ? (
        <p className="error-message" data-testid="import-error">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="import-result" data-testid="import-result">
          <h2 className="result-summary">
            Kết quả: {result.imported} đã import · {result.skipped.length} bỏ qua ·{' '}
            {result.failed.length} lỗi
          </h2>

          {result.failed.length > 0 ? (
            <div className="failed-list">
              <p className="failed-title">Dòng lỗi:</p>
              <ul>
                {result.failed.map((f, i) => (
                  <li key={i} className="failed-item">
                    Dòng {f.line}: {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.profiles.length > 0 ? (
            <div className="imported-profiles" data-testid="imported-profiles-list">
              <p className="profiles-title">Profile vừa import:</p>
              <ul>
                {result.profiles.map((p) => (
                  <li key={p.id} className="profile-item" data-testid={`profile-${p.uid}`}>
                    <span className="profile-uid">{p.uid}</span>
                    <span className="profile-status">{p.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
