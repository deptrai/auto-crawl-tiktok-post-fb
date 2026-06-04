import { useEffect, useMemo, useState } from 'react'
import type {
  MessengerJobStatus,
  MessengerTargetPayload,
  ProfileSummary,
  TargetListEntry,
  TargetListFilter,
  TargetListSummary
} from '../../../shared/ipc-schemas'
import type { AutomationJobState } from '../../../shared/types/automation-job'
import { listProfiles } from '../api/profile-api'
import { getMessengerStatus, startMessengerSeeding } from '../api/messenger-api'
import { listTargetEntries, listTargetLists } from '../api/target-list-api'
import { EmptyState } from '../components/EmptyState'
import { StatusPill, type StatusPillVariant } from '../components/StatusPill'

const TERMINAL_STATES = new Set<AutomationJobState>([
  'DONE',
  'CHECKPOINT_BLOCKED',
  'FAILED',
  'CANCELLED'
])

const STATE_LABELS: Record<AutomationJobState, string> = {
  PENDING: 'Đang xếp hàng',
  ACQUIRING_PROXY: 'Đang lấy proxy',
  LOGGING_IN: 'Đang đăng nhập',
  SOLVING_CHECKPOINT: 'Đang xử lý checkpoint',
  WARMING_UP: 'Đang warmup',
  EXECUTING: 'Đang gửi tin',
  DONE: 'Hoàn tất',
  CHECKPOINT_BLOCKED: 'Bị checkpoint',
  FAILED: 'Thất bại',
  CANCELLED: 'Đã hủy'
}

interface ParsedTargets {
  targets: MessengerTargetPayload[]
  error: string | null
}

interface TrackedMessengerJob extends MessengerJobStatus {
  profileId: string
  profileUid: string
}

type MessengerSourceMode = 'paste' | 'target-list'

function stateVariant(state: AutomationJobState): StatusPillVariant {
  if (state === 'DONE') return 'idle'
  if (state === 'CHECKPOINT_BLOCKED') return 'checkpoint'
  if (state === 'FAILED' || state === 'CANCELLED') return 'error'
  return 'running'
}

function parseTargets(text: string): ParsedTargets {
  const targets: MessengerTargetPayload[] = []
  const seen = new Set<string>()
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim()
    if (!line) continue
    const [rawUid, rawName] = line.split('|')
    const uid = rawUid?.trim() ?? ''
    const name = rawName?.trim()
    if (!uid) return { targets: [], error: `Dòng ${index + 1} thiếu UID.` }
    if (seen.has(uid)) continue
    seen.add(uid)
    targets.push({ uid, ...(name ? { name } : {}) })
  }
  if (targets.length === 0) return { targets, error: 'Hãy dán ít nhất một UID target.' }
  return { targets, error: null }
}

export function MessengerSeedingView(): React.JSX.Element {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [profilesError, setProfilesError] = useState<string | null>(null)
  const [targetText, setTargetText] = useState('')
  const [sourceMode, setSourceMode] = useState<MessengerSourceMode>('paste')
  const [targetLists, setTargetLists] = useState<TargetListSummary[]>([])
  const [targetListsLoading, setTargetListsLoading] = useState(true)
  const [selectedTargetListId, setSelectedTargetListId] = useState('')
  const [targetListFilter, setTargetListFilter] = useState<TargetListFilter>('unsent')
  const [targetListEntries, setTargetListEntries] = useState<TargetListEntry[]>([])
  const [targetListEntriesLoading, setTargetListEntriesLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [starting, setStarting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [jobs, setJobs] = useState<TrackedMessengerJob[]>([])
  const pastedTargets = useMemo(() => parseTargets(targetText), [targetText])
  const targetListTargets = useMemo<MessengerTargetPayload[]>(
    () =>
      targetListEntries.map((entry) => ({
        uid: entry.uid,
        ...(entry.name ? { name: entry.name } : {})
      })),
    [targetListEntries]
  )
  const activeTargets = sourceMode === 'paste' ? pastedTargets.targets : targetListTargets
  const activeTargetError = sourceMode === 'paste' ? pastedTargets.error : null
  const canStart =
    selectedIds.size > 0 &&
    activeTargets.length > 0 &&
    !activeTargetError &&
    !starting &&
    !targetListEntriesLoading

  useEffect(() => {
    let cancelled = false
    async function loadProfiles(): Promise<void> {
      try {
        const next = await listProfiles()
        if (!cancelled) {
          setProfiles(next)
          setProfilesError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setProfilesError(err instanceof Error ? err.message : 'Không thể tải danh sách profile.')
        }
      } finally {
        if (!cancelled) setProfilesLoading(false)
      }
    }
    void loadProfiles()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadTargetLists(): Promise<void> {
      try {
        const next = await listTargetLists()
        if (!cancelled) {
          setTargetLists(next)
          setSelectedTargetListId((current) => current || next[0]?.id || '')
        }
      } catch (err) {
        if (!cancelled) {
          setFormError(err instanceof Error ? err.message : 'Không thể tải Target Lists.')
        }
      } finally {
        if (!cancelled) setTargetListsLoading(false)
      }
    }
    void loadTargetLists()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedTargetListId) {
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) setTargetListEntries([])
      })
      return () => {
        cancelled = true
      }
    }
    let cancelled = false
    void Promise.resolve().then(async () => {
      setTargetListEntriesLoading(true)
      try {
        const entries = await listTargetEntries({
          listId: selectedTargetListId,
          filter: targetListFilter
        })
        if (!cancelled) setTargetListEntries(entries)
      } catch (err) {
        if (!cancelled) {
          setFormError(err instanceof Error ? err.message : 'Không thể tải target từ list.')
        }
      } finally {
        if (!cancelled) setTargetListEntriesLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [selectedTargetListId, targetListFilter])

  useEffect(() => {
    const activeJobs = jobs.filter((job) => !TERMINAL_STATES.has(job.state))
    if (activeJobs.length === 0) return undefined

    let cancelled = false
    const timer = window.setInterval(() => {
      const jobIds = activeJobs.map((job) => job.jobId)
      void getMessengerStatus(jobIds)
        .then((response) => {
          if (cancelled) return
          const statusById = new Map(response.jobs.map((job) => [job.jobId, job]))
          setJobs((current) =>
            current.map((job) => {
              const next = statusById.get(job.jobId)
              return next ? { ...job, ...next } : job
            })
          )
        })
        .catch((err) => {
          if (!cancelled) {
            setFormError(err instanceof Error ? err.message : 'Không thể đọc trạng thái seeding.')
          }
        })
    }, 1_000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [jobs])

  useEffect(() => {
    if (sourceMode !== 'target-list' || !selectedTargetListId || jobs.length === 0) return undefined
    if (!jobs.every((job) => TERMINAL_STATES.has(job.state))) return undefined

    let cancelled = false
    void Promise.resolve().then(async () => {
      setTargetListEntriesLoading(true)
      try {
        const entries = await listTargetEntries({
          listId: selectedTargetListId,
          filter: targetListFilter
        })
        if (!cancelled) setTargetListEntries(entries)
      } catch (err) {
        if (!cancelled) {
          setFormError(err instanceof Error ? err.message : 'Không thể tải target từ list.')
        }
      } finally {
        if (!cancelled) setTargetListEntriesLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [jobs, selectedTargetListId, sourceMode, targetListFilter])

  function toggleProfile(profileId: string, selected: boolean): void {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (selected) next.add(profileId)
      else next.delete(profileId)
      return next
    })
  }

  async function handleStart(): Promise<void> {
    if (starting) return
    if (activeTargetError) {
      setFormError(activeTargetError)
      return
    }
    const selectedProfiles = profiles.filter((profile) => selectedIds.has(profile.id))
    if (selectedProfiles.length === 0) {
      setFormError('Hãy chọn ít nhất một profile để chạy seeding.')
      return
    }
    if (activeTargets.length === 0) {
      setFormError('Hãy chọn ít nhất một target hợp lệ để chạy seeding.')
      return
    }

    setStarting(true)
    setFormError(null)
    try {
      const submittedTargetUids = new Set(activeTargets.map((target) => target.uid))
      const response = await startMessengerSeeding({
        profileIds: selectedProfiles.map((profile) => profile.id),
        targets: activeTargets,
        ...(sourceMode === 'target-list' ? { targetListId: selectedTargetListId } : {})
      })
      const nextJobs = response.jobIds.map((jobId, index) => {
        const profile = selectedProfiles[index]
        return {
          jobId,
          profileId: profile.id,
          profileUid: profile.uid,
          state: 'PENDING' as const,
          sent: 0,
          total: 0
        }
      })
      setJobs(nextJobs)
      if (sourceMode === 'target-list') {
        setTargetListEntries((current) =>
          current.filter((entry) => !submittedTargetUids.has(entry.uid))
        )
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Không thể bắt đầu Messenger seeding.')
    } finally {
      setStarting(false)
    }
  }

  return (
    <section className="messenger-seeding-view" data-testid="messenger-seeding-view">
      <div className="profiles-list-header">
        <div>
          <p className="eyebrow">Messenger</p>
          <h2>Messenger Seeding</h2>
          <p className="profiles-list-subtitle" data-testid="messenger-template-hint">
            Seeding dùng template ngẫu nhiên trong kho; quản lý template ở tab Content Templates.
          </p>
        </div>
        {profilesLoading ? (
          <span className="profiles-list-loading" data-testid="messenger-profiles-loading">
            Đang tải profile...
          </span>
        ) : null}
      </div>

      <p
        className="warning-banner messenger-placeholder-warning"
        data-testid="messenger-placeholder-warning"
      >
        Placeholder {'{uid}'} và {'{name}'} chỉ được resolve khi Messenger seeding; self-comment sẽ
        post nguyên văn các placeholder này.
      </p>

      {profilesError ? (
        <p className="error-message list-error" data-testid="messenger-profiles-error">
          {profilesError}
        </p>
      ) : null}

      {!profilesLoading && !profilesError && profiles.length === 0 ? (
        <EmptyState
          icon="✉"
          title="Chưa có profile."
          description="Import profile trước khi chạy Messenger seeding."
          testId="messenger-profiles-empty"
        />
      ) : null}

      <div className="messenger-source-toggle" role="group" aria-label="Nguồn target Messenger">
        <button
          className={`target-filter-button ${sourceMode === 'paste' ? 'is-active' : ''}`}
          data-testid="messenger-source-paste"
          type="button"
          aria-pressed={sourceMode === 'paste'}
          onClick={() => setSourceMode('paste')}
        >
          Dán UID
        </button>
        <button
          className={`target-filter-button ${sourceMode === 'target-list' ? 'is-active' : ''}`}
          data-testid="messenger-source-target-list"
          type="button"
          aria-pressed={sourceMode === 'target-list'}
          onClick={() => setSourceMode('target-list')}
        >
          Target List
        </button>
      </div>

      <div className="messenger-grid">
        {sourceMode === 'paste' ? (
          <label className="field-label messenger-targets-field" htmlFor="messenger-targets-input">
            Target UID
            <textarea
              id="messenger-targets-input"
              data-testid="messenger-targets-input"
              className="import-textarea messenger-targets-input"
              value={targetText}
              rows={8}
              placeholder={'123456789\n987654321|Nguyễn Văn A'}
              onChange={(event) => {
                setTargetText(event.target.value)
                setFormError(null)
              }}
            />
            <span className="template-placeholder-hint">
              Một dòng một UID, có thể dùng uid|name.
            </span>
          </label>
        ) : (
          <div className="messenger-target-list-source" data-testid="messenger-target-list-source">
            <label
              className="field-label template-field-label"
              htmlFor="messenger-target-list-select"
            >
              Target List
              <select
                id="messenger-target-list-select"
                className="license-input"
                data-testid="messenger-target-list-select"
                value={selectedTargetListId}
                disabled={targetListsLoading || targetLists.length === 0}
                onChange={(event) => setSelectedTargetListId(event.target.value)}
              >
                {targetLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="target-filter-bar" role="group" aria-label="Filter target Messenger">
              <button
                className={`target-filter-button ${targetListFilter === 'unsent' ? 'is-active' : ''}`}
                data-testid="messenger-target-list-filter-unsent"
                type="button"
                aria-pressed={targetListFilter === 'unsent'}
                onClick={() => setTargetListFilter('unsent')}
              >
                Chưa gửi
              </button>
              <button
                className={`target-filter-button ${targetListFilter === 'error' ? 'is-active' : ''}`}
                data-testid="messenger-target-list-filter-error"
                type="button"
                aria-pressed={targetListFilter === 'error'}
                onClick={() => setTargetListFilter('error')}
              >
                Lỗi
              </button>
            </div>
            {targetListsLoading || targetListEntriesLoading ? (
              <span className="profiles-list-loading" data-testid="messenger-target-list-loading">
                Đang tải target list...
              </span>
            ) : null}
            {!targetListsLoading && targetLists.length === 0 ? (
              <EmptyState
                icon="#"
                title="Chưa có Target List."
                description="Tạo Target List trước khi chạy seeding theo danh sách."
                testId="messenger-target-list-empty"
              />
            ) : null}
          </div>
        )}

        <div className="messenger-profile-picker" data-testid="messenger-profile-picker">
          <p className="eyebrow">Profile chạy</p>
          {profiles.map((profile) => (
            <label className="messenger-profile-option" key={profile.id}>
              <input
                data-testid={`messenger-profile-checkbox-${profile.uid}`}
                type="checkbox"
                checked={selectedIds.has(profile.id)}
                onChange={(event) => toggleProfile(profile.id, event.target.checked)}
              />
              <span>{profile.displayName}</span>
              <small>{profile.uid}</small>
            </label>
          ))}
        </div>
      </div>

      {formError ? (
        <p className="error-message list-error" data-testid="messenger-form-error">
          {formError}
        </p>
      ) : null}

      <div className="messenger-actions">
        <button
          data-testid="messenger-start-button"
          className="primary-button"
          type="button"
          disabled={!canStart}
          onClick={(event) => {
            ;(event.currentTarget as HTMLButtonElement).disabled = true
            void handleStart()
          }}
        >
          {starting ? 'Đang enqueue...' : 'Chạy seeding'}
        </button>
        <span className="profiles-list-subtitle">{activeTargets.length} target hợp lệ</span>
      </div>

      {jobs.length > 0 ? (
        <div className="messenger-job-list" data-testid="messenger-job-list">
          {jobs.map((job) => (
            <div
              className="messenger-job-row"
              data-testid={`messenger-job-row-${job.profileUid}`}
              key={job.jobId}
            >
              <div>
                <strong>{job.profileUid}</strong>
                <p className="profiles-list-subtitle">
                  {job.sent}/{job.total}
                </p>
              </div>
              <StatusPill label={STATE_LABELS[job.state]} variant={stateVariant(job.state)} />
              {job.reason ? <span className="profiles-list-subtitle">{job.reason}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
