import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ImportResult,
  ProfileSummary,
  ProxyAssignmentSummary
} from '../../../shared/ipc-schemas'
import { deleteProfile, importBulkProfiles, listProfiles, updateProfile } from '../api/profile-api'
import { getAutomationStatus, startSelfComment } from '../api/automation-api'
import {
  acquireProxyForProfile,
  listProxyAssignments,
  releaseProxyForProfile
} from '../api/proxy-api'
import { getSetting, setSetting } from '../api/settings-api'
import { BulkActionBar } from '../components/BulkActionBar'
import { EmptyState } from '../components/EmptyState'
import { StatusPill, type StatusPillVariant } from '../components/StatusPill'
import type { StatusCounts } from '../components/StatusCounter'
import { Toast, type ToastVariant } from '../components/Toast'

const AUTOMATION_BROWSER_HEADLESS_SETTING = 'automation_browser_headless'

const STATUS_LABELS: Record<string, { label: string; variant: StatusPillVariant }> = {
  idle: { label: 'Nhàn rỗi', variant: 'idle' },
  running: { label: 'Đang chạy', variant: 'running' },
  checkpoint: { label: 'Checkpoint', variant: 'checkpoint' },
  error: { label: 'Lỗi', variant: 'error' }
}

const AUTOMATION_STATE_LABELS: Record<string, string> = {
  PENDING: 'Đang xếp hàng',
  ACQUIRING_PROXY: 'Đang lấy proxy',
  LOGGING_IN: 'Đang đăng nhập',
  SOLVING_CHECKPOINT: 'Đang xử lý checkpoint',
  WARMING_UP: 'Đang warmup',
  EXECUTING: 'Đang bình luận',
  DONE: 'Hoàn tất',
  CHECKPOINT_BLOCKED: 'Bị checkpoint',
  FAILED: 'Thất bại',
  CANCELLED: 'Đã hủy'
}

const TERMINAL_AUTOMATION_STATES = new Set(['DONE', 'CHECKPOINT_BLOCKED', 'FAILED', 'CANCELLED'])

interface AutomationRowStatus {
  jobId: string
  state: string
  outcome?: string
  target?: string
  reason?: string
  message?: string
}

interface BatchTracker {
  id: number
  profileIds: string[]
}

interface ToastState {
  message: string
  variant: ToastVariant
}

interface ScopedError {
  profileId: string | null
  message: string
}

function getStatusBadge(status: string): { label: string; variant: StatusPillVariant } {
  return STATUS_LABELS[status] ?? { label: 'Không xác định', variant: 'neutral' }
}

function getAutomationVariant(state: string): StatusPillVariant {
  if (state === 'DONE') return 'idle'
  if (state === 'CHECKPOINT_BLOCKED') return 'checkpoint'
  if (state === 'FAILED' || state === 'CANCELLED') return 'error'
  return 'running'
}

function countProfileStatuses(profiles: ProfileSummary[]): StatusCounts {
  return profiles.reduce<StatusCounts>(
    (counts, profile) => {
      if (profile.status === 'running') counts.running += 1
      else if (profile.status === 'checkpoint') counts.checkpoint += 1
      else if (profile.status === 'error') counts.error += 1
      else counts.idle += 1
      return counts
    },
    { idle: 0, running: 0, checkpoint: 0, error: 0 }
  )
}

function getTargetValidationMessage(target: string): string | null {
  return target.length > 0 && !target.trim()
    ? 'URL post chỉ có khoảng trắng. Hãy nhập URL hợp lệ hoặc xóa trống để dùng feed.'
    : null
}

function summarizeBatch(statuses: AutomationRowStatus[], total: number): ToastState {
  const completed = statuses.filter((status) => status.state === 'DONE').length
  const checkpoints = statuses.filter((status) => status.state === 'CHECKPOINT_BLOCKED').length
  const errors = statuses.filter(
    (status) => status.state === 'FAILED' || status.state === 'CANCELLED'
  ).length
  const variant: ToastVariant = errors > 0 ? 'error' : checkpoints > 0 ? 'warning' : 'success'

  return {
    variant,
    message: `${completed}/${total} hoàn tất · ${checkpoints} checkpoint · ${errors} lỗi`
  }
}

export function ProfilesView({
  onStatusCountsChange
}: {
  onStatusCountsChange?: (counts: StatusCounts) => void
}): React.JSX.Element {
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
  const [proxyAssignments, setProxyAssignments] = useState<Record<string, ProxyAssignmentSummary>>(
    {}
  )
  const [proxyBusyId, setProxyBusyId] = useState<string | null>(null)
  const [proxyError, setProxyError] = useState<ScopedError | null>(null)
  const [automationTarget, setAutomationTarget] = useState('')
  const [automationTargetWarning, setAutomationTargetWarning] = useState<string | null>(null)
  const [automationBrowserHeadless, setAutomationBrowserHeadless] = useState(false)
  const [automationBrowserModeSaving, setAutomationBrowserModeSaving] = useState(false)
  const [automationBusyId, setAutomationBusyId] = useState<string | null>(null)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [automationStatuses, setAutomationStatuses] = useState<Record<string, AutomationRowStatus>>(
    {}
  )
  const [automationError, setAutomationError] = useState<ScopedError | null>(null)
  const [trackedBatches, setTrackedBatches] = useState<BatchTracker[]>([])
  const [bulkToast, setBulkToast] = useState<ToastState | null>(null)
  const listInFlightRef = useRef(false)
  const listCancelledRef = useRef(false)
  const pendingRefreshRef = useRef(false)
  const batchIdRef = useRef(0)

  useEffect(() => {
    onStatusCountsChange?.(countProfileStatuses(profiles))
  }, [onStatusCountsChange, profiles])

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

  const refreshProxyAssignments = useCallback(async (): Promise<void> => {
    try {
      const assignments = await listProxyAssignments()
      setProxyAssignments(
        Object.fromEntries(assignments.map((assignment) => [assignment.profileId, assignment]))
      )
      setProxyError(null)
    } catch (err) {
      setProxyError({
        profileId: null,
        message: err instanceof Error ? err.message : 'Không thể tải proxy đã gán.'
      })
    }
  }, [])

  useEffect(() => {
    const initialProxyLoad = window.setTimeout(() => {
      void refreshProxyAssignments()
    }, 0)
    return () => window.clearTimeout(initialProxyLoad)
  }, [refreshProxyAssignments])

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

  useEffect(() => {
    let cancelled = false
    void getSetting(AUTOMATION_BROWSER_HEADLESS_SETTING)
      .then((value) => {
        if (!cancelled) setAutomationBrowserHeadless(value === 'true')
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  async function handleAutomationBrowserModeChange(nextHeadless: boolean): Promise<void> {
    if (automationBrowserModeSaving) return
    const previous = automationBrowserHeadless
    setAutomationBrowserHeadless(nextHeadless)
    setAutomationBrowserModeSaving(true)
    setAutomationError(null)
    try {
      await setSetting(AUTOMATION_BROWSER_HEADLESS_SETTING, String(nextHeadless))
    } catch (err) {
      setAutomationBrowserHeadless(previous)
      setAutomationError({
        profileId: null,
        message: err instanceof Error ? err.message : 'Không thể lưu chế độ trình duyệt.'
      })
    } finally {
      setAutomationBrowserModeSaving(false)
    }
  }

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
      setAutomationStatuses((prev) => {
        const next = { ...prev }
        delete next[profile.id]
        return next
      })
      // Dọn id khỏi selection để count bulk bar không bị lệch sau khi xóa profile đang chọn.
      setSelectedIds((prev) => {
        if (!prev.has(profile.id)) return prev
        const next = new Set(prev)
        next.delete(profile.id)
        return next
      })
      // Dọn profile khỏi batch tracking — nếu không, batch sẽ "kẹt" chờ status của
      // profile đã bị xóa (mãi không terminal) và toast tổng kết không bao giờ hiện.
      setTrackedBatches((prev) => {
        if (!prev.some((batch) => batch.profileIds.includes(profile.id))) return prev
        return prev
          .map((batch) => ({
            ...batch,
            profileIds: batch.profileIds.filter((id) => id !== profile.id)
          }))
          .filter((batch) => batch.profileIds.length > 0)
      })
      await refreshProfiles(false)
    } catch (err) {
      setRowError(err instanceof Error ? err.message : 'Không thể xóa profile.')
    } finally {
      setRowBusyId(null)
    }
  }

  async function handleAcquireProxy(profile: ProfileSummary): Promise<void> {
    if (proxyBusyId) return

    setProxyBusyId(profile.id)
    setProxyError(null)
    try {
      const assignment = await acquireProxyForProfile(profile.id)
      setProxyAssignments((current) => ({ ...current, [profile.id]: assignment }))
    } catch (err) {
      setProxyError({
        profileId: profile.id,
        message: err instanceof Error ? err.message : 'Không thể gán proxy riêng.'
      })
    } finally {
      setProxyBusyId(null)
    }
  }

  async function handleReleaseProxy(profile: ProfileSummary): Promise<void> {
    if (proxyBusyId) return

    setProxyBusyId(profile.id)
    setProxyError(null)
    try {
      await releaseProxyForProfile(profile.id)
      setProxyAssignments((current) => {
        const next = { ...current }
        delete next[profile.id]
        return next
      })
    } catch (err) {
      setProxyError({
        profileId: profile.id,
        message: err instanceof Error ? err.message : 'Không thể thả proxy riêng.'
      })
    } finally {
      setProxyBusyId(null)
    }
  }

  async function handleStartSelfComment(profile: ProfileSummary): Promise<void> {
    if (automationBusyId) return

    setAutomationBusyId(profile.id)
    setAutomationError(null)
    const targetWarning = getTargetValidationMessage(automationTarget)
    setAutomationTargetWarning(targetWarning)
    if (targetWarning) {
      setAutomationBusyId(null)
      return
    }
    try {
      const target = automationTarget.trim()
      const { jobId } = await startSelfComment({
        profileId: profile.id,
        ...(target ? { target } : {})
      })
      setAutomationStatuses((current) => ({
        ...current,
        [profile.id]: { jobId, state: 'PENDING' }
      }))
    } catch (err) {
      setAutomationError({
        profileId: profile.id,
        message: err instanceof Error ? err.message : 'Không thể chạy self-comment.'
      })
    } finally {
      setAutomationBusyId(null)
    }
  }

  function toggleProfileSelection(profileId: string, selected: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (selected) next.add(profileId)
      else next.delete(profileId)
      return next
    })
  }

  function toggleSelectAll(selected: boolean): void {
    setSelectedIds(selected ? new Set(profiles.map((profile) => profile.id)) : new Set())
  }

  async function handleBulkSelfComment(): Promise<void> {
    if (bulkRunning || selectedIds.size === 0) return

    const selectedProfiles = profiles.filter((profile) => selectedIds.has(profile.id))
    if (selectedProfiles.length === 0) return

    setBulkRunning(true)
    setAutomationError(null)
    const targetWarning = getTargetValidationMessage(automationTarget)
    setAutomationTargetWarning(targetWarning)
    if (targetWarning) {
      setBulkRunning(false)
      return
    }
    const target = automationTarget.trim()
    const enqueuedIds: string[] = []
    const failures: string[] = []
    try {
      for (const profile of selectedProfiles) {
        try {
          const { jobId } = await startSelfComment({
            profileId: profile.id,
            ...(target ? { target } : {})
          })
          // Commit trạng thái từng job ngay khi enqueue thành công để poll theo dõi được,
          // kể cả khi một job sau đó lỗi (tránh job "ma" chạy ngoài tầm theo dõi của UI).
          setAutomationStatuses((current) => ({
            ...current,
            [profile.id]: { jobId, state: 'PENDING' }
          }))
          enqueuedIds.push(profile.id)
        } catch {
          // Tiếp tục các profile còn lại thay vì dừng cả batch.
          failures.push(profile.uid)
        }
      }
      // Bỏ chọn các profile đã enqueue thành công; giữ lại profile lỗi để thử lại.
      setSelectedIds((current) => {
        if (enqueuedIds.length === 0) return current
        const next = new Set(current)
        for (const id of enqueuedIds) next.delete(id)
        return next
      })
      if (failures.length > 0) {
        setAutomationError({
          profileId: null,
          message: `Không enqueue được ${failures.length} profile: ${failures.join(', ')}. Đã giữ lại để thử lại.`
        })
      }
      if (enqueuedIds.length > 0) {
        batchIdRef.current += 1
        setTrackedBatches((current) => [
          ...current,
          { id: batchIdRef.current, profileIds: enqueuedIds }
        ])
      }
    } finally {
      setBulkRunning(false)
    }
  }

  useEffect(() => {
    const active = Object.entries(automationStatuses).filter(
      ([, status]) => !TERMINAL_AUTOMATION_STATES.has(status.state)
    )
    if (active.length === 0) return undefined

    let cancelled = false
    const timer = window.setInterval(() => {
      for (const [profileId, status] of active) {
        void getAutomationStatus(status.jobId)
          .then((next) => {
            if (cancelled) return
            setAutomationStatuses((current) => ({
              ...current,
              [profileId]: {
                jobId: status.jobId,
                state: next.state,
                outcome: next.outcome,
                target: next.target,
                reason: next.reason,
                message: next.message
              }
            }))
          })
          .catch((err) => {
            if (!cancelled) {
              setAutomationError({
                profileId,
                message: err instanceof Error ? err.message : 'Không thể đọc trạng thái automation.'
              })
            }
          })
      }
    }, 1_000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [automationStatuses])

  useEffect(() => {
    if (trackedBatches.length === 0) return undefined

    const completedBatches: BatchTracker[] = []
    // Gộp mọi batch hoàn tất trong cùng tick vào 1 toast tổng — tránh chỉ hiện batch cuối.
    const aggregatedStatuses: AutomationRowStatus[] = []
    let aggregatedTotal = 0
    for (const batch of trackedBatches) {
      const statuses = batch.profileIds.map((profileId) => automationStatuses[profileId])
      if (
        statuses.every(
          (status): status is AutomationRowStatus =>
            Boolean(status) && TERMINAL_AUTOMATION_STATES.has(status.state)
        )
      ) {
        completedBatches.push(batch)
        aggregatedStatuses.push(...statuses)
        aggregatedTotal += batch.profileIds.length
      }
    }

    if (completedBatches.length === 0) return undefined
    const nextToast = summarizeBatch(aggregatedStatuses, aggregatedTotal)

    const timer = window.setTimeout(() => {
      const completedIds = new Set(completedBatches.map((batch) => batch.id))
      setBulkToast(nextToast)
      setTrackedBatches((current) => current.filter((batch) => !completedIds.has(batch.id)))
    }, 0)

    return () => window.clearTimeout(timer)
  }, [automationStatuses, trackedBatches])

  useEffect(() => {
    if (!bulkToast) return undefined
    const timer = window.setTimeout(() => setBulkToast(null), 5_000)
    return () => window.clearTimeout(timer)
  }, [bulkToast])

  const selectedCount = selectedIds.size
  const allProfilesSelected =
    profiles.length > 0 && profiles.every((profile) => selectedIds.has(profile.id))
  // Chọn một phần → checkbox header ở trạng thái indeterminate (chuẩn UX data table).
  const someProfilesSelected =
    !allProfilesSelected && profiles.some((profile) => selectedIds.has(profile.id))

  return (
    <div className="profiles-view" data-testid="profiles-view">
      <section className="import-panel" aria-labelledby="profiles-import-title">
        <p className="eyebrow">Quản lý tài khoản</p>
        <h1 id="profiles-import-title">Import Profile</h1>
        <p className="lead">
          Dán định dạng <code>uid|pass|2fa|cookie|hotmail|passmail</code>, format ngoài
          <code>uid|pass|email|passmail|cookie|token|userAgent</code>, hoặc paste JSON cookie export
          Facebook. App tự lấy UID từ <code>c_user</code> và không hiển thị lại secret.
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
              'uid1|pass1|seed1|cookie1|email@mail.com|mailpass\n# hoặc uid|pass|email|passmail|cookie|token|userAgent'
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
          <EmptyState
            icon="②"
            title="Chưa có profile nào."
            description="Import profile để bắt đầu gán proxy và chạy self-comment hàng loạt."
            testId="profiles-list-empty"
          />
        ) : null}

        {profiles.length > 0 ? (
          <div className="automation-target-form" data-testid="automation-target-form">
            <label className="field-label template-field-label" htmlFor="automation-target-url">
              URL post đích (khuyến nghị)
              <input
                id="automation-target-url"
                data-testid="automation-target-input"
                className="license-input"
                value={automationTarget}
                placeholder="https://www.facebook.com/.../posts/..."
                autoComplete="off"
                onChange={(e) => {
                  setAutomationTarget(e.target.value)
                  setAutomationTargetWarning(getTargetValidationMessage(e.target.value))
                }}
              />
            </label>
            {automationTargetWarning ? (
              <p className="warning-banner target-warning" data-testid="automation-target-warning">
                {automationTargetWarning}
              </p>
            ) : null}
            <p className="profiles-list-subtitle">
              Nếu bỏ trống, app sẽ thử vào profile feed của tài khoản và dùng selector tạm.
            </p>
            <label className="automation-browser-mode-toggle" htmlFor="automation-browser-headless">
              <input
                id="automation-browser-headless"
                data-testid="automation-browser-headless-toggle"
                type="checkbox"
                checked={automationBrowserHeadless}
                disabled={automationBrowserModeSaving || Boolean(automationBusyId)}
                onChange={(e) => {
                  void handleAutomationBrowserModeChange(e.target.checked)
                }}
              />
              <span>Chạy ẩn trình duyệt</span>
            </label>
          </div>
        ) : null}

        {automationError?.profileId === null ? (
          <p className="error-message list-error" data-testid="automation-error">
            {automationError.message}
          </p>
        ) : null}

        {proxyError?.profileId === null ? (
          <p className="error-message list-error" data-testid="proxy-list-error">
            {proxyError.message}
          </p>
        ) : null}

        {bulkToast ? (
          <Toast
            message={bulkToast.message}
            variant={bulkToast.variant}
            testId="bulk-summary-toast"
            onDismiss={() => setBulkToast(null)}
          />
        ) : null}

        {profiles.length > 0 ? (
          <div className="data-table-wrap">
            <table className="data-table profiles-list" data-testid="profiles-list">
              <thead>
                <tr>
                  <th scope="col" className="select-column">
                    <input
                      ref={(el) => {
                        if (el) el.indeterminate = someProfilesSelected
                      }}
                      className="row-checkbox"
                      data-testid="profiles-select-all"
                      type="checkbox"
                      aria-label="Chọn tất cả profile"
                      checked={allProfilesSelected}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                    />
                  </th>
                  <th scope="col">UID</th>
                  <th scope="col">Tên hiển thị</th>
                  <th scope="col">Trạng thái</th>
                  <th scope="col">Proxy</th>
                  <th scope="col">Job</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => {
                  const badge = getStatusBadge(profile.status)
                  const isEditing = editingId === profile.id
                  const isConfirmingDelete = confirmDeleteId === profile.id
                  const isBusy = rowBusyId === profile.id
                  const automationStatus = automationStatuses[profile.id]
                  const automationRunning =
                    automationBusyId === profile.id ||
                    Boolean(
                      automationStatus && !TERMINAL_AUTOMATION_STATES.has(automationStatus.state)
                    )
                  return (
                    <tr
                      key={profile.id}
                      className="profile-list-row"
                      data-testid={`profile-row-${profile.uid}`}
                    >
                      <td className="select-column">
                        <input
                          className="row-checkbox"
                          data-testid={`profile-select-${profile.uid}`}
                          type="checkbox"
                          aria-label={`Chọn profile ${profile.uid}`}
                          checked={selectedIds.has(profile.id)}
                          onChange={(e) => toggleProfileSelection(profile.id, e.target.checked)}
                        />
                      </td>
                      <td className="mono-cell profile-list-uid">{profile.uid}</td>
                      <td>
                        {isEditing ? (
                          <div className="profile-edit-form">
                            <label
                              className="sr-only"
                              htmlFor={`profile-edit-input-${profile.uid}`}
                            >
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
                              data-testid={`profile-edit-cancel-${profile.uid}`}
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
                          <span className="profile-list-name">{profile.displayName}</span>
                        )}
                      </td>
                      <td>
                        <StatusPill label={badge.label} variant={badge.variant} />
                      </td>
                      <td>
                        <div
                          className="profile-proxy-assignment"
                          data-testid={`profile-proxy-${profile.uid}`}
                        >
                          {proxyAssignments[profile.id] ? (
                            <strong
                              className="mono-cell"
                              data-testid={`profile-proxy-value-${profile.uid}`}
                            >
                              {proxyAssignments[profile.id].host}:
                              {proxyAssignments[profile.id].port}
                            </strong>
                          ) : (
                            <span data-testid={`profile-proxy-empty-${profile.uid}`}>Chưa gán</span>
                          )}
                          <div className="profile-row-actions">
                            <button
                              data-testid={`profile-proxy-acquire-${profile.uid}`}
                              className="profile-row-button primary-row-action"
                              type="button"
                              disabled={
                                Boolean(proxyBusyId) || Boolean(proxyAssignments[profile.id])
                              }
                              onClick={(e) => {
                                ;(e.currentTarget as HTMLButtonElement).disabled = true
                                void handleAcquireProxy(profile)
                              }}
                            >
                              {proxyBusyId === profile.id ? 'Đang gán...' : 'Gán proxy'}
                            </button>
                            <button
                              data-testid={`profile-proxy-release-${profile.uid}`}
                              className="profile-row-button"
                              type="button"
                              disabled={Boolean(proxyBusyId) || !proxyAssignments[profile.id]}
                              onClick={(e) => {
                                ;(e.currentTarget as HTMLButtonElement).disabled = true
                                void handleReleaseProxy(profile)
                              }}
                            >
                              Thả proxy
                            </button>
                          </div>
                        </div>
                        {proxyError?.profileId === profile.id ? (
                          <p
                            className="error-message profile-row-error"
                            data-testid="profile-proxy-error"
                          >
                            {proxyError.message}
                          </p>
                        ) : null}
                      </td>
                      <td className="job-column">
                        {automationStatus ? (
                          <div
                            className="automation-row-status"
                            data-testid={`profile-automation-status-${profile.uid}`}
                          >
                            <StatusPill
                              label={
                                AUTOMATION_STATE_LABELS[automationStatus.state] ??
                                automationStatus.state
                              }
                              variant={getAutomationVariant(automationStatus.state)}
                              title={`Job ${automationStatus.jobId}`}
                            />
                            <span className="mono-cell">Job {automationStatus.jobId}</span>
                            {automationStatus.outcome ? (
                              <span> · {automationStatus.outcome}</span>
                            ) : null}
                            {automationStatus.message ? (
                              <span> · {automationStatus.message}</span>
                            ) : null}
                            {automationStatus.target ? (
                              <span>
                                {' · Post: '}
                                <a href={automationStatus.target} target="_blank" rel="noreferrer">
                                  {automationStatus.target}
                                </a>
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="muted-cell">Chưa có job</span>
                        )}
                      </td>
                      <td>
                        <div className="profile-row-actions">
                          <button
                            data-testid={`profile-self-comment-${profile.uid}`}
                            className="profile-row-button primary-row-action"
                            type="button"
                            disabled={automationRunning || Boolean(automationBusyId)}
                            onClick={(e) => {
                              ;(e.currentTarget as HTMLButtonElement).disabled = true
                              void handleStartSelfComment(profile)
                            }}
                          >
                            {automationRunning ? 'Đang chạy...' : 'Chạy self-comment'}
                          </button>
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
                        {isConfirmingDelete ? (
                          <div
                            className="profile-delete-confirm"
                            data-testid={`profile-delete-confirm-${profile.uid}`}
                          >
                            <span>
                              Xóa profile {profile.uid}? Cookie + dữ liệu sẽ bị xóa vĩnh viễn.
                            </span>
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
                                data-testid={`profile-delete-cancel-${profile.uid}`}
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
                        {automationError?.profileId === profile.id ? (
                          <p className="error-message profile-row-error">
                            {automationError.message}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {selectedCount > 0 ? (
          <BulkActionBar
            count={selectedCount}
            disabled={bulkRunning}
            headless={automationBrowserHeadless}
            target={automationTarget}
            onHeadlessChange={(next) => void handleAutomationBrowserModeChange(next)}
            onRun={() => void handleBulkSelfComment()}
            onTargetChange={(next) => {
              setAutomationTarget(next)
              setAutomationTargetWarning(getTargetValidationMessage(next))
            }}
          />
        ) : null}
      </section>
    </div>
  )
}
