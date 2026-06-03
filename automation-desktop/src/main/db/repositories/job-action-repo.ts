import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { ActionOutcome } from '../../automation/action-executor'

export interface RecordJobActionParams {
  jobId: string
  actionType: string
  target: string | null
  actionTokenJti: string | null
  executedAt: string
  outcome: ActionOutcome
}

export interface JobActionRepository {
  recordAction(params: RecordJobActionParams): void
  getLatestByJob(
    jobId: string
  ): { outcome: ActionOutcome; executedAt: string; target: string | null } | undefined
}

interface JobActionOutcomeRow {
  outcome: ActionOutcome
  executed_at: string
  target: string | null
}

export function createJobActionRepository(db: Database.Database): JobActionRepository {
  const stmtInsert = db.prepare<
    [string, string, string, string | null, string | null, string, ActionOutcome]
  >(
    `INSERT INTO job_actions(id, job_id, action_type, target, action_token, executed_at, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const stmtLatest = db.prepare<[string], JobActionOutcomeRow>(
    `SELECT outcome, executed_at, target
     FROM job_actions
     WHERE job_id = ?
     ORDER BY executed_at DESC, id DESC
     LIMIT 1`
  )

  return {
    recordAction(params) {
      stmtInsert.run(
        randomUUID(),
        params.jobId,
        params.actionType,
        params.target,
        params.actionTokenJti,
        params.executedAt,
        params.outcome
      )
    },

    getLatestByJob(jobId) {
      const row = stmtLatest.get(jobId)
      return row
        ? { outcome: row.outcome, executedAt: row.executed_at, target: row.target }
        : undefined
    }
  }
}
