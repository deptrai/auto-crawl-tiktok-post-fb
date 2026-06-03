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
}

export function createJobActionRepository(db: Database.Database): JobActionRepository {
  const stmtInsert = db.prepare<
    [string, string, string, string | null, string | null, string, ActionOutcome]
  >(
    `INSERT INTO job_actions(id, job_id, action_type, target, action_token, executed_at, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
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
    }
  }
}
