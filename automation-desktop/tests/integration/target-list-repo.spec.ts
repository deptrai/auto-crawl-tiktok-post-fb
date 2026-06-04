import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { openEncryptedDatabase } from '../../src/main/db/client'
import { createProfileRepository } from '../../src/main/db/repositories/profile-repo'
import { createAutomationJobRepository } from '../../src/main/db/repositories/automation-job-repo'
import { createJobActionRepository } from '../../src/main/db/repositories/job-action-repo'
import { createTargetListRepository } from '../../src/main/db/repositories/target-list-repo'

function withDb<T>(run: (dbPath: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-target-list-repo-'))
  try {
    return run(join(dir, 'phase3.db'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('[P0] target list repository imports dedupes filters and cascades entries', () => {
  withDb((dbPath) => {
    const db = openEncryptedDatabase({ path: dbPath, key: 'target-list-test-key' })
    try {
      const repo = createTargetListRepository(db)
      const list = repo.createList({ label: 'Messenger leads', createdAt: '2026-06-04T01:00:00Z' })

      const result = repo.importEntries({
        listId: list.id,
        createdAt: '2026-06-04T01:01:00Z',
        entries: [
          { uid: '1001', name: 'An' },
          { uid: '1002' },
          { uid: '1001', name: 'Ignored duplicate' }
        ]
      })

      expect(result).toEqual({ created: 2, skippedDuplicate: 1, total: 3 })
      expect(repo.listLists()).toEqual([
        {
          id: list.id,
          label: 'Messenger leads',
          createdAt: '2026-06-04T01:00:00Z',
          total: 2,
          sent: 0,
          unsent: 2,
          error: 0
        }
      ])
      expect(
        repo.listEntries({ listId: list.id, filter: 'unsent' }).map((entry) => entry.uid)
      ).toEqual(['1001', '1002'])
      expect(repo.deleteList(list.id)).toBe(1)
      expect(repo.listEntries({ listId: list.id, filter: 'all' })).toEqual([])
    } finally {
      db.close()
    }
  })
})

test('[P0] target list repository links jobs and applies outcomes idempotently', () => {
  withDb((dbPath) => {
    const db = openEncryptedDatabase({ path: dbPath, key: 'target-list-outcomes-key' })
    try {
      const profileRepo = createProfileRepository(db)
      profileRepo.insertProfileAtomic(
        {
          id: 'profile-1',
          uid: 'profile_uid_1',
          displayName: 'Profile 1',
          status: 'idle',
          createdAt: '2026-06-04T01:00:00Z'
        },
        []
      )
      const jobRepo = createAutomationJobRepository(db)
      const actions = createJobActionRepository(db)
      const repo = createTargetListRepository(db)
      const list = repo.createList({ label: 'Retry list', createdAt: '2026-06-04T01:00:00Z' })
      repo.importEntries({
        listId: list.id,
        createdAt: '2026-06-04T01:01:00Z',
        entries: [{ uid: '1001' }, { uid: '1002' }]
      })

      jobRepo.createJob({
        id: 'job-1',
        profileId: 'profile-1',
        type: 'messenger_seed',
        state: 'PENDING',
        startedAt: '2026-06-04T01:02:00Z'
      })
      repo.linkJobs({ listId: list.id, jobIds: ['job-1'], createdAt: '2026-06-04T01:02:01Z' })
      actions.recordAction({
        jobId: 'job-1',
        actionType: 'message',
        target: '1001',
        actionTokenJti: null,
        executedAt: '2026-06-04T01:03:00Z',
        outcome: 'success'
      })
      actions.recordAction({
        jobId: 'job-1',
        actionType: 'message',
        target: '1002',
        actionTokenJti: null,
        executedAt: '2026-06-04T01:03:10Z',
        outcome: 'error'
      })

      expect(repo.applyJobOutcomes('job-1', '2026-06-04T01:04:00Z')).toBe(2)
      expect(repo.applyJobOutcomes('job-1', '2026-06-04T01:05:00Z')).toBe(0)
      expect(
        repo.listEntries({ listId: list.id, filter: 'sent' }).map((entry) => entry.uid)
      ).toEqual(['1001'])
      expect(
        repo.listEntries({ listId: list.id, filter: 'error' }).map((entry) => entry.uid)
      ).toEqual(['1002'])

      actions.recordAction({
        jobId: 'job-1',
        actionType: 'message',
        target: '1002',
        actionTokenJti: null,
        executedAt: '2026-06-04T01:06:00Z',
        outcome: 'success'
      })
      expect(repo.applyJobOutcomes('job-1', '2026-06-04T01:07:00Z')).toBe(1)
      expect(repo.listLists()[0]).toMatchObject({ total: 2, sent: 2, unsent: 0, error: 0 })
      expect(repo.listEntries({ listId: list.id, filter: 'error' })).toEqual([])
    } finally {
      db.close()
    }
  })
})
