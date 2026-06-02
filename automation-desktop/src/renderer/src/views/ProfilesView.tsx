import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImportResult, ProfileSummary } from '../../../shared/ipc-schemas'
import { deleteProfile, importBulkProfiles, listProfiles, updateProfile } from '../api/profile-api'

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  idle: { label: 'Nhàn rỗi', className: 'status-idle' },
  running: { label: 'Đang chạy', className: 'status-running' },
  checkpoint: { label: 'Checkpoint', className: 'status-checkpoint' },
  error: { label: 'Lỗi', className: 'status-error' }
}

function getStatusBadge(status: string): { label: string; className: string } {
  return STATUS_LABELS[status] ?? { label: 'Không xác định', className: 'status-unknown' }
}

export function ProfilesView(): React.JSX.Element {
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [rowBusyId, setRowBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const listInFlightRef = useRef(false)
  const listCancelledRef = useRef(false)
  const pendingRefreshRef = useRef(false)

  const refreshProfiles = useCallback(async (initialLoad = false): Promise<void> => {
    if (listInFlightRef.current) {
      pendingRefreshRef.current = true
      return
    }

    listInFlightRef.current = true
    let isInitialRun = initialLoad
    let shouldRunAgain = true

    while (shouldRunAgain && !listCancelledRef.current) {
      pendingRefreshRef.current = false
      if (isInitialRun && !listCancelledRef.current) setListLoading(true)

      try {
        const nextProfiles = await listProfiles()
        if (!listCancelledRef.current) {
          setProfiles(nextProfiles)
          setListError(null)
        }
      } catch (err) {
        if (!listCancelledRef.current) {
          setListError(err instanceof Error ? err.message : 'Không thể tải danh sách profile.')
        }
      } finally {
        if (isInitialRun && !listCancelledRef.current) setListLoading(false)
        isInitialRun = false
        shouldRunAgain = pendingRefreshRef.current && !listCancelledRef.current
      }
    }

    listInFlightRef.current = false
  }, [])

  useEffect(() => {
    listCancelledRef.current = false
    const initialLoad = window.setTimeout(() => {
      void refreshProfiles(true)
    }, 0)
    const interval = window.setInterval(() => {
      void refreshProfiles(false)
    }, 5000)

    return () => {
      listCancelledRef.current = true
      window.clearTimeout(initialLoad)
      window.clearInterval(interval)
    }
  }, [refreshProfiles])

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
      await refreshProfiles(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể import profile.')
    } finally {
      setImporting(false)
    }
  }

  function startEdit(profile: ProfileSummary): void {
    setRowError(null)
    setConfirmDeleteId(null)
    setEditingId(profile.id)
    setEditName(profile.displayName)
  }

  async function handleSaveEdit(profile: ProfileSummary): Promise<void> {
    const nextName = editName.trim()
    if (!nextName || rowBusyId) return

    setRowBusyId(profile.id)
    setRowError(null)
    try {
      await updateProfile(profile.id, nextName)
      setEditingId(null)
      setEditName('')
      await refreshProfiles(false)
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Không thể sửa profile.')
    } finally {
      setRowBusyId(null)
    }
  }

  async function handleDelete(profile: ProfileSummary): Promise<void> {
    if (rowBusyId) return

    setRowBusyId(profile.id)
    setRowError(null)
    try {
      await deleteProfile(profile.id)
      setConfirmDeleteId(null)
      if (editingId === profile.id) {
        setEditingId(null)
        setEditName('')
      }
      await refreshProfiles(false)
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Không thể xóa profile.')
    } finally {
      setRowBusyId(null)
    }
  }

  return (
    <div className="profiles-view" data-testid="profiles-view">
      <section className="import-panel" aria-labelledby="profiles-import-title">
        <p className="eyebrow">Quản lý tài khoản</p>
        <h1 id="profiles-import-title">Import Profile</h1>
        <p className="lead">
          Dán định dạng <code>uid|pass|2fa|cookie|hotmail|passmail</code> hoặc paste JSON cookie
          export Facebook. App tự lấy UID từ <code>c_user</code> và không hiển thị lại secret.
        </p>

        <div className="format-card">
          <span>Nhận 2 format</span>
          <strong>Bulk text</strong>
          <strong>JSON cookie export</strong>
        </div>

        <div className="import-form">
          <textarea
            data-testid="import-textarea"
            className="import-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              'uid1|pass1|seed1|cookie1|email@mail.com|mailpass\n# hoặc paste JSON cookie export Facebook trực tiếp'
            }
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
              'Import profile'
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

            {result.skipped.length > 0 ? (
              <div className="skipped-list" data-testid="skipped-profiles-list">
                <p className="skipped-title">Bỏ qua:</p>
                <ul>
                  {result.skipped.map((s, i) => (
                    <li key={i} className="skipped-item">
                      Dòng {s.line} · {s.uid}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

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
      </section>

      <section className="profiles-list-section" data-testid="profiles-list-section">
        <div className="profiles-list-header">
          <div>
            <p className="eyebrow">Real-time</p>
            <h2>Danh sách profile</h2>
            <p className="profiles-list-subtitle">
              {profiles.length > 0 ? `${profiles.length} profile trong máy này` : 'Chưa có dữ liệu'}
            </p>
          </div>
          {listLoading ? (
            <span data-testid="profiles-list-loading" className="profiles-list-loading">
              Đang tải danh sách...
            </span>
          ) : null}
        </div>

        {listError ? (
          <p className="error-message list-error" data-testid="profiles-list-error">
            {listError}
          </p>
        ) : null}

        {!listLoading && !listError && profiles.length === 0 ? (
          <p className="profiles-empty" data-testid="profiles-list-empty">
            Chưa có profile nào.
          </p>
        ) : null}

        {profiles.length > 0 ? (
          <ul className="profiles-list" data-testid="profiles-list">
            {profiles.map((profile) => {
              const badge = getStatusBadge(profile.status)
              const isEditing = editingId === profile.id
              const isConfirmingDelete = confirmDeleteId === profile.id
              const isBusy = rowBusyId === profile.id
              return (
                <li
                  key={profile.id}
                  className="profile-list-row"
                  data-testid={`profile-row-${profile.uid}`}
                >
                  <div className="profile-list-identity">
                    <span className="profile-list-uid">{profile.uid}</span>
                    {isEditing ? (
                      <div className="profile-edit-form">
                        <label className="sr-only" htmlFor={`profile-edit-input-${profile.uid}`}>
                          Tên hiển thị
                        </label>
                        <input
                          id={`profile-edit-input-${profile.uid}`}
                          data-testid={`profile-edit-input-${profile.uid}`}
                          className="profile-edit-input"
                          value={editName}
                          disabled={isBusy}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                        <button
                          data-testid={`profile-edit-save-${profile.uid}`}
                          className="profile-row-button primary-row-action"
                          type="button"
                          disabled={isBusy || !editName.trim()}
                          onClick={(e) => {
                            ;(e.currentTarget as HTMLButtonElement).disabled = true
                            void handleSaveEdit(profile)
                          }}
                        >
                          {isBusy ? 'Đang lưu...' : 'Lưu'}
                        </button>
                        <button
                          className="profile-row-button"
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            setEditingId(null)
                            setEditName('')
                          }}
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <span className="profile-list-name">Tên hiển thị: {profile.displayName}</span>
                    )}
                  </div>
                  <div className="profile-row-side">
                    <span className={`status-badge ${badge.className}`}>{badge.label}</span>
                    <div className="profile-row-actions">
                      <button
                        data-testid={`profile-edit-${profile.uid}`}
                        className="profile-row-button"
                        type="button"
                        disabled={isBusy}
                        onClick={() => startEdit(profile)}
                      >
                        Sửa
                      </button>
                      <button
                        data-testid={`profile-delete-${profile.uid}`}
                        className="profile-row-button danger-row-action"
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setRowError(null)
                          setEditingId(null)
                          setEditName('')
                          setConfirmDeleteId(profile.id)
                        }}
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                  {isConfirmingDelete ? (
                    <div
                      className="profile-delete-confirm"
                      data-testid={`profile-delete-confirm-${profile.uid}`}
                    >
                      <span>Xóa profile {profile.uid}? Cookie + dữ liệu sẽ bị xóa vĩnh viễn.</span>
                      <div className="profile-row-actions">
                        <button
                          data-testid={`profile-delete-confirm-submit-${profile.uid}`}
                          className="profile-row-button danger-row-action"
                          type="button"
                          disabled={isBusy}
                          onClick={(e) => {
                            ;(e.currentTarget as HTMLButtonElement).disabled = true
                            void handleDelete(profile)
                          }}
                        >
                          {isBusy ? 'Đang xóa...' : 'Xóa'}
                        </button>
                        <button
                          className="profile-row-button"
                          type="button"
                          disabled={isBusy}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Hủy
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {rowError && (isEditing || isConfirmingDelete) ? (
                    <p className="error-message profile-row-error">{rowError}</p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>
    </div>
  )
}
