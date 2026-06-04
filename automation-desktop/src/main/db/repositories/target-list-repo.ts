import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'

export type TargetListFilter = 'all' | 'unsent' | 'sent' | 'error'

export interface TargetListSummary {
  id: string
  label: string
  createdAt: string
  total: number
  sent: number
  unsent: number
  error: number
}

export interface TargetListEntryInput {
  uid: string
  name?: string
}

export interface TargetListEntry {
  listId: string
  uid: string
  name?: string
  sentAt?: string
  failedAt?: string
  lastOutcome?: string
  lastErrorReason?: string
  createdAt: string
}

export interface TargetListImportResult {
  created: number
  skippedDuplicate: number
  total: number
}

export interface TargetListRepository {
  listExists(id: string): boolean
  listLists(): TargetListSummary[]
  createList(params: { label: string; createdAt: string }): {
    id: string
    label: string
    createdAt: string
  }
  deleteList(id: string): number
  importEntries(params: {
    listId: string
    entries: TargetListEntryInput[]
    createdAt: string
  }): TargetListImportResult
  listEntries(params: { listId: string; filter: TargetListFilter }): TargetListEntry[]
  linkJobs(params: { listId: string; jobIds: string[]; createdAt: string }): number
  applyJobOutcomes(jobId: string, now: string): number
}

interface TargetListSummaryRow {
  id: string
  label: string
  created_at: string
  total: number
  sent: number
  unsent: number
  error: number
}

interface TargetListEntryRow {
  list_id: string
  uid: string
  name: string | null
  sent_at: string | null
  failed_at: string | null
  last_outcome: string | null
  last_error_reason: string | null
  created_at: string
}

interface JobActionRow {
  target: string | null
  outcome: string
}

function mapEntry(row: TargetListEntryRow): TargetListEntry {
  return {
    listId: row.list_id,
    uid: row.uid,
    name: row.name ?? undefined,
    sentAt: row.sent_at ?? undefined,
    failedAt: row.failed_at ?? undefined,
    lastOutcome: row.last_outcome ?? undefined,
    lastErrorReason: row.last_error_reason ?? undefined,
    createdAt: row.created_at
  }
}

function filterWhere(filter: TargetListFilter): string {
  if (filter === 'unsent') return 'AND sent_at IS NULL AND failed_at IS NULL'
  if (filter === 'sent') return 'AND sent_at IS NOT NULL'
  if (filter === 'error') return 'AND sent_at IS NULL AND failed_at IS NOT NULL'
  return ''
}

export function createTargetListRepository(db: Database.Database): TargetListRepository {
  const stmtExists = db.prepare<[string], { c: number }>(
    'SELECT COUNT(*) AS c FROM target_lists WHERE id = ?'
  )
  const stmtList = db.prepare<[], TargetListSummaryRow>(
    `SELECT
       target_lists.id,
       target_lists.label,
       target_lists.created_at,
       COUNT(target_list_entries.uid) AS total,
       SUM(CASE WHEN target_list_entries.sent_at IS NOT NULL THEN 1 ELSE 0 END) AS sent,
       SUM(CASE WHEN target_list_entries.sent_at IS NULL AND target_list_entries.failed_at IS NULL AND target_list_entries.uid IS NOT NULL THEN 1 ELSE 0 END) AS unsent,
       SUM(CASE WHEN target_list_entries.sent_at IS NULL AND target_list_entries.failed_at IS NOT NULL THEN 1 ELSE 0 END) AS error
     FROM target_lists
     LEFT JOIN target_list_entries ON target_list_entries.list_id = target_lists.id
     GROUP BY target_lists.id
     ORDER BY target_lists.created_at DESC, target_lists.id ASC`
  )
  const stmtInsertList = db.prepare<[string, string, string]>(
    'INSERT INTO target_lists(id, label, created_at) VALUES (?, ?, ?)'
  )
  const stmtDeleteList = db.prepare<[string]>('DELETE FROM target_lists WHERE id = ?')
  const stmtInsertEntry = db.prepare<[string, string, string | null, string]>(
    `INSERT OR IGNORE INTO target_list_entries(list_id, uid, name, created_at)
     VALUES (?, ?, ?, ?)`
  )
  const stmtLinkJob = db.prepare<[string, string, string]>(
    `INSERT OR IGNORE INTO target_list_jobs(list_id, job_id, created_at)
     VALUES (?, ?, ?)`
  )
  const stmtJobActions = db.prepare<[string], JobActionRow>(
    `SELECT target, outcome
     FROM job_actions
     WHERE job_id = ? AND target IS NOT NULL
     ORDER BY executed_at ASC, id ASC`
  )
  const stmtMarkSent = db.prepare<[string, string, string]>(
    `UPDATE target_list_entries
     SET sent_at = ?, failed_at = NULL, last_outcome = 'success', last_error_reason = NULL
     WHERE uid = ?
       AND list_id IN (SELECT list_id FROM target_list_jobs WHERE job_id = ?)
       AND (sent_at IS NULL OR failed_at IS NOT NULL OR last_outcome IS NOT 'success' OR last_error_reason IS NOT NULL)`
  )
  const stmtMarkFailed = db.prepare<[string, string, string, string, string, string, string]>(
    `UPDATE target_list_entries
     SET failed_at = ?, last_outcome = ?, last_error_reason = ?
     WHERE uid = ?
       AND list_id IN (SELECT list_id FROM target_list_jobs WHERE job_id = ?)
       AND sent_at IS NULL
       AND (failed_at IS NULL OR COALESCE(last_outcome, '') != ? OR COALESCE(last_error_reason, '') != ?)`
  )

  const txImport = db.transaction(
    (listId: string, entries: TargetListEntryInput[], createdAt: string) => {
      let created = 0
      let skippedDuplicate = 0
      const seen = new Set<string>()

      for (const entry of entries) {
        if (seen.has(entry.uid)) {
          skippedDuplicate += 1
          continue
        }
        seen.add(entry.uid)
        const result = stmtInsertEntry.run(listId, entry.uid, entry.name ?? null, createdAt)
        if (result.changes === 1) created += 1
        else skippedDuplicate += 1
      }

      return { created, skippedDuplicate, total: entries.length }
    }
  )

  const txLinkJobs = db.transaction((listId: string, jobIds: string[], createdAt: string) => {
    let linked = 0
    for (const jobId of jobIds) {
      linked += Number(stmtLinkJob.run(listId, jobId, createdAt).changes)
    }
    return linked
  })

  const txApplyOutcomes = db.transaction((jobId: string, now: string) => {
    let changed = 0
    for (const action of stmtJobActions.all(jobId)) {
      if (!action.target) continue
      if (action.outcome === 'success') {
        changed += Number(stmtMarkSent.run(now, action.target, jobId).changes)
      } else {
        changed += Number(
          stmtMarkFailed.run(
            now,
            action.outcome,
            action.outcome,
            action.target,
            jobId,
            action.outcome,
            action.outcome
          ).changes
        )
      }
    }
    return changed
  })

  return {
    listExists(id) {
      return (stmtExists.get(id)?.c ?? 0) > 0
    },

    listLists() {
      return stmtList.all().map((row) => ({
        id: row.id,
        label: row.label,
        createdAt: row.created_at,
        total: row.total ?? 0,
        sent: row.sent ?? 0,
        unsent: row.unsent ?? 0,
        error: row.error ?? 0
      }))
    },

    createList(params) {
      const list = { id: randomUUID(), label: params.label, createdAt: params.createdAt }
      stmtInsertList.run(list.id, list.label, list.createdAt)
      return list
    },

    deleteList(id) {
      return Number(stmtDeleteList.run(id).changes)
    },

    importEntries(params) {
      return txImport(params.listId, params.entries, params.createdAt)
    },

    listEntries(params) {
      const stmt = db.prepare<[string], TargetListEntryRow>(
        `SELECT list_id, uid, name, sent_at, failed_at, last_outcome, last_error_reason, created_at
         FROM target_list_entries
         WHERE list_id = ? ${filterWhere(params.filter)}
         ORDER BY created_at ASC, uid ASC`
      )
      return stmt.all(params.listId).map(mapEntry)
    },

    linkJobs(params) {
      return txLinkJobs(params.listId, params.jobIds, params.createdAt)
    },

    applyJobOutcomes(jobId, now) {
      return txApplyOutcomes(jobId, now)
    }
  }
}
