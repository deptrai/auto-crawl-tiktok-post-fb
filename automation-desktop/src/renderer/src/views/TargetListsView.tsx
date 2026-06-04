import { useEffect, useMemo, useState } from 'react'
import type {
  TargetListEntry,
  TargetListFilter,
  TargetListSummary
} from '../../../shared/ipc-schemas'
import {
  createTargetList,
  deleteTargetList,
  importTargetEntries,
  listTargetEntries,
  listTargetLists
} from '../api/target-list-api'
import { EmptyState } from '../components/EmptyState'

const FILTERS: Array<{ id: TargetListFilter; label: string; testId: string }> = [
  { id: 'all', label: 'Tất cả', testId: 'target-list-filter-all' },
  { id: 'unsent', label: 'Chưa gửi', testId: 'target-list-filter-unsent' },
  { id: 'sent', label: 'Đã gửi', testId: 'target-list-filter-sent' },
  { id: 'error', label: 'Lỗi', testId: 'target-list-filter-error' }
]

interface ParsedImport {
  entries: Array<{ uid: string; name?: string }>
  skippedInputDuplicate: number
  error: string | null
}

function parseImportText(text: string): ParsedImport {
  const entries: Array<{ uid: string; name?: string }> = []
  const seen = new Set<string>()
  let skippedInputDuplicate = 0

  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim()
    if (!line) continue
    const [rawUid, rawName] = line.split('|')
    const uid = rawUid?.trim() ?? ''
    const name = rawName?.trim()
    if (!uid) return { entries: [], skippedInputDuplicate, error: `Dòng ${index + 1} thiếu UID.` }
    if (seen.has(uid)) {
      skippedInputDuplicate += 1
      continue
    }
    seen.add(uid)
    entries.push({ uid, ...(name ? { name } : {}) })
  }

  return { entries, skippedInputDuplicate, error: null }
}

export function TargetListsView(): React.JSX.Element {
  const [lists, setLists] = useState<TargetListSummary[]>([])
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [entries, setEntries] = useState<TargetListEntry[]>([])
  const [loadingLists, setLoadingLists] = useState(true)
  const [loadingEntries, setLoadingEntries] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [filter, setFilter] = useState<TargetListFilter>('all')
  const selectedList = lists.find((list) => list.id === selectedListId) ?? null
  const parsedImport = useMemo(() => parseImportText(importText), [importText])

  async function refreshLists(nextSelectedId?: string | null): Promise<void> {
    const nextLists = await listTargetLists()
    setLists(nextLists)
    setSelectedListId((current) => {
      if (nextSelectedId !== undefined) return nextSelectedId
      if (current && nextLists.some((list) => list.id === current)) return current
      return nextLists[0]?.id ?? null
    })
  }

  async function refreshEntries(listId: string, nextFilter = filter): Promise<void> {
    setLoadingEntries(true)
    try {
      setEntries(await listTargetEntries({ listId, filter: nextFilter }))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải target.')
    } finally {
      setLoadingEntries(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const nextLists = await listTargetLists()
        if (!cancelled) {
          setLists(nextLists)
          setSelectedListId(nextLists[0]?.id ?? null)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Không thể tải danh sách.')
      } finally {
        if (!cancelled) setLoadingLists(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedListId) {
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) setEntries([])
      })
      return () => {
        cancelled = true
      }
    }
    let cancelled = false
    void Promise.resolve().then(async () => {
      setLoadingEntries(true)
      try {
        setEntries(await listTargetEntries({ listId: selectedListId, filter }))
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Không thể tải target.')
      } finally {
        if (!cancelled) setLoadingEntries(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [selectedListId, filter])

  async function handleCreate(): Promise<void> {
    const nextLabel = label.trim()
    if (!nextLabel || creating) return
    setCreating(true)
    setError(null)
    try {
      const list = await createTargetList(nextLabel)
      setLabel('')
      await refreshLists(list.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tạo danh sách target.')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(list: TargetListSummary): Promise<void> {
    if (deletingId) return
    setDeletingId(list.id)
    setError(null)
    try {
      await deleteTargetList(list.id)
      await refreshLists(null)
      setEntries([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa danh sách target.')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleImport(): Promise<void> {
    if (!selectedListId || importing) return
    if (parsedImport.error) {
      setError(parsedImport.error)
      return
    }
    if (parsedImport.entries.length === 0) {
      setError('Hãy dán ít nhất một UID target.')
      return
    }

    setImporting(true)
    setError(null)
    setImportResult(null)
    try {
      const result = await importTargetEntries({
        listId: selectedListId,
        entries: parsedImport.entries
      })
      setImportResult(
        `Đã thêm ${result.created}, bỏ qua ${result.skippedDuplicate + parsedImport.skippedInputDuplicate} trùng.`
      )
      setImportText('')
      await refreshLists(selectedListId)
      await refreshEntries(selectedListId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể import target.')
    } finally {
      setImporting(false)
    }
  }

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return
    try {
      setImportText(await file.text())
      setError(null)
    } catch {
      setError('Không thể đọc file target.')
    }
  }

  return (
    <section className="target-lists-view" data-testid="target-lists-view">
      <div className="profiles-list-header">
        <div>
          <p className="eyebrow">Messenger</p>
          <h2>Target Lists</h2>
          <p className="profiles-list-subtitle">
            Quản lý UID theo chiến dịch và lọc trạng thái gửi.
          </p>
        </div>
        {loadingLists ? (
          <span className="profiles-list-loading" data-testid="target-lists-loading">
            Đang tải danh sách...
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="error-message list-error" data-testid="target-lists-error">
          {error}
        </p>
      ) : null}
      {importResult ? (
        <p className="import-result target-import-result" data-testid="target-list-import-result">
          {importResult}
        </p>
      ) : null}

      <div className="target-list-layout">
        <aside className="target-list-panel">
          <div className="template-form target-list-create-form">
            <label className="field-label template-field-label" htmlFor="target-list-label">
              Tên danh sách
              <input
                id="target-list-label"
                className="license-input"
                data-testid="target-list-label-input"
                value={label}
                maxLength={120}
                disabled={creating}
                placeholder="Ví dụ: Lead livestream 04/06"
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <button
              className="primary-button"
              data-testid="target-list-create-button"
              type="button"
              disabled={creating || !label.trim()}
              onClick={(event) => {
                ;(event.currentTarget as HTMLButtonElement).disabled = true
                void handleCreate()
              }}
            >
              {creating ? 'Đang tạo...' : 'Tạo danh sách'}
            </button>
          </div>

          {!loadingLists && lists.length === 0 ? (
            <EmptyState
              icon="#"
              title="Chưa có target list."
              description="Tạo danh sách rồi import UID để chạy Messenger seeding."
              testId="target-lists-empty"
            />
          ) : null}

          <div className="target-list-items" data-testid="target-list-items">
            {lists.map((list) => (
              <button
                key={list.id}
                type="button"
                className={`target-list-item ${selectedListId === list.id ? 'is-active' : ''}`}
                data-testid={`target-list-item-${list.id}`}
                onClick={() => {
                  setSelectedListId(list.id)
                  setImportResult(null)
                }}
              >
                <strong>{list.label}</strong>
                <span>{list.total} target</span>
                <small>
                  {list.unsent} chưa gửi · {list.sent} đã gửi · {list.error} lỗi
                </small>
              </button>
            ))}
          </div>
        </aside>

        <div className="target-list-detail">
          {selectedList ? (
            <>
              <div className="target-list-detail-header">
                <div>
                  <p className="eyebrow">Danh sách đang chọn</p>
                  <h3>{selectedList.label}</h3>
                  <p className="profiles-list-subtitle">
                    {selectedList.total} target · {selectedList.unsent} chưa gửi ·{' '}
                    {selectedList.error} lỗi
                  </p>
                </div>
                <button
                  className="profile-row-button danger-row-action"
                  data-testid="target-list-delete-button"
                  type="button"
                  disabled={deletingId === selectedList.id}
                  onClick={(event) => {
                    ;(event.currentTarget as HTMLButtonElement).disabled = true
                    void handleDelete(selectedList)
                  }}
                >
                  {deletingId === selectedList.id ? 'Đang xóa...' : 'Xóa'}
                </button>
              </div>

              <div className="target-import-grid">
                <label
                  className="field-label template-field-label"
                  htmlFor="target-list-import-textarea"
                >
                  Import UID
                  <textarea
                    id="target-list-import-textarea"
                    className="import-textarea target-list-import-textarea"
                    data-testid="target-list-import-textarea"
                    value={importText}
                    rows={6}
                    disabled={importing}
                    placeholder={'123456789\n987654321|Nguyễn Văn A'}
                    onChange={(event) => {
                      setImportText(event.target.value)
                      setImportResult(null)
                      setError(null)
                    }}
                  />
                  <span className="template-placeholder-hint">
                    Một dòng một UID, có thể dùng uid|name.
                  </span>
                </label>
                <div className="target-import-actions">
                  <input
                    className="license-input"
                    data-testid="target-list-file-input"
                    type="file"
                    accept=".txt,text/plain"
                    disabled={importing}
                    onChange={(event) => void handleFile(event.currentTarget.files?.[0])}
                  />
                  <button
                    className="primary-button"
                    data-testid="target-list-import-button"
                    type="button"
                    disabled={
                      importing || parsedImport.entries.length === 0 || Boolean(parsedImport.error)
                    }
                    onClick={(event) => {
                      ;(event.currentTarget as HTMLButtonElement).disabled = true
                      void handleImport()
                    }}
                  >
                    {importing ? 'Đang import...' : 'Import'}
                  </button>
                </div>
              </div>

              <div className="target-filter-bar" role="group" aria-label="Lọc target list">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    className={`target-filter-button ${filter === item.id ? 'is-active' : ''}`}
                    data-testid={item.testId}
                    type="button"
                    aria-pressed={filter === item.id}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {loadingEntries ? (
                <span className="profiles-list-loading" data-testid="target-list-entries-loading">
                  Đang tải target...
                </span>
              ) : null}

              {!loadingEntries && entries.length === 0 ? (
                <EmptyState
                  icon="∅"
                  title={
                    selectedList.total === 0
                      ? 'Danh sách chưa có target.'
                      : 'Không có target khớp filter.'
                  }
                  description="Import UID hoặc đổi filter để xem target khác."
                  testId="target-list-entries-empty"
                />
              ) : null}

              {entries.length > 0 ? (
                <div
                  className="data-table-wrap profiles-list"
                  data-testid="target-list-entries-table"
                >
                  <table className="data-table target-list-table">
                    <thead>
                      <tr>
                        <th>UID</th>
                        <th>Tên</th>
                        <th>Trạng thái</th>
                        <th>Lỗi cuối</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr key={entry.uid} data-testid={`target-list-entry-row-${entry.uid}`}>
                          <td className="target-list-cell-uid">{entry.uid}</td>
                          <td>{entry.name ?? '-'}</td>
                          <td>{entry.sentAt ? 'Đã gửi' : entry.failedAt ? 'Lỗi' : 'Chưa gửi'}</td>
                          <td>{entry.lastErrorReason ?? '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon="#"
              title="Chọn hoặc tạo target list."
              description="Target list giúp tránh gửi trùng và retry UID lỗi."
              testId="target-list-detail-empty"
            />
          )}
        </div>
      </div>
    </section>
  )
}
