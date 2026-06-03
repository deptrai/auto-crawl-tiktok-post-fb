import type Database from 'better-sqlite3-multiple-ciphers'
import type { AutomationJob, AutomationJobState } from '../../../shared/types/automation-job'
import { TERMINAL_STATES } from '../../../shared/types/automation-job'

export interface CreateAutomationJobParams {
  id: string
  profileId: string
  type: string
  state: AutomationJobState
  startedAt: string
}

export interface UpdateAutomationJobStateParams {
  completedAt?: string
  result?: string | null
}

interface AutomationJobDbRow {
  id: string
  profile_id: string
  type: string
  state: AutomationJobState
  started_at: string
  completed_at: string | null
  result: string | null
}

export interface AutomationJobRepository {
  createJob(params: CreateAutomationJobParams): void
  updateState(id: string, state: AutomationJobState, params?: UpdateAutomationJobStateParams): void
  getJob(id: string): AutomationJob | undefined
  listResumable(): AutomationJob[]
}

function mapAutomationJob(row: AutomationJobDbRow): AutomationJob {
  return {
    id: row.id,
    profileId: row.profile_id,
    type: row.type,
    state: row.state,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    result: row.result
  }
}

export function createAutomationJobRepository(db: Database.Database): AutomationJobRepository {
  const stmtCreate = db.prepare<[string, string, string, AutomationJobState, string]>(
    `INSERT INTO automation_jobs(id, profile_id, type, state, started_at)
     VALUES (?, ?, ?, ?, ?)`
  )
  const stmtUpdateState = db.prepare<[AutomationJobState, string | null, string | null, string]>(
    `UPDATE automation_jobs
     SET state = ?, completed_at = ?, result = ?
     WHERE id = ?`
  )
  const stmtGet = db.prepare<[string], AutomationJobDbRow>(
    `SELECT id, profile_id, type, state, started_at, completed_at, result
     FROM automation_jobs
     WHERE id = ?`
  )
  const terminalStates = [...TERMINAL_STATES]
  const stmtListResumable = db.prepare<AutomationJobState[], AutomationJobDbRow>(
    `SELECT id, profile_id, type, state, started_at, completed_at, result
     FROM automation_jobs
     WHERE state NOT IN (${terminalStates.map(() => '?').join(', ')})
     ORDER BY started_at ASC`
  )

  return {
    createJob(params) {
      stmtCreate.run(params.id, params.profileId, params.type, params.state, params.startedAt)
    },

    updateState(id, state, params = {}) {
      stmtUpdateState.run(state, params.completedAt ?? null, params.result ?? null, id)
    },

    getJob(id) {
      const row = stmtGet.get(id)
      return row ? mapAutomationJob(row) : undefined
    },

    listResumable() {
      return stmtListResumable.all(...terminalStates).map(mapAutomationJob)
    }
  }
}
