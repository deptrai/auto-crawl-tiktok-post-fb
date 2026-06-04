import { useEffect, useMemo, useState } from 'react'
import type {
  MessengerJobStatus,
  MessengerTargetPayload,
  ProfileSummary
} from '../../../shared/ipc-schemas'
import type { AutomationJobState } from '../../../shared/types/automation-job'
import { listProfiles } from '../api/profile-api'
import { getMessengerStatus, startMessengerSeeding } from '../api/messenger-api'
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [starting, setStarting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [jobs, setJobs] = useState<TrackedMessengerJob[]>([])
  const parsedTargets = useMemo(() => parseTargets(targetText), [targetText])
  const canStart = selectedIds.size > 0 && !parsedTargets.error && !starting

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
    if (parsedTargets.error) {
      setFormError(parsedTargets.error)
      return
    }
    const selectedProfiles = profiles.filter((profile) => selectedIds.has(profile.id))
    if (selectedProfiles.length === 0) {
      setFormError('Hãy chọn ít nhất một profile để chạy seeding.')
      return
    }

    setStarting(true)
    setFormError(null)
    try {
      const response = await startMessengerSeeding({
        profileIds: selectedProfiles.map((profile) => profile.id),
        targets: parsedTargets.targets
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

      <div className="messenger-grid">
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
          <span className="template-placeholder-hint">Một dòng một UID, có thể dùng uid|name.</span>
        </label>

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
        <span className="profiles-list-subtitle">{parsedTargets.targets.length} target hợp lệ</span>
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
