import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { openEncryptedDatabase } from '../../src/main/db/client'
import { createAutomationJobRepository } from '../../src/main/db/repositories/automation-job-repo'
import { createJobActionRepository } from '../../src/main/db/repositories/job-action-repo'
import { createProfileRepository } from '../../src/main/db/repositories/profile-repo'

type SmokeResult = { ok: true; checks: string[] } | { ok: false; error: string }

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function runSmoke(): SmokeResult {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-job-action-repo-'))
  const db = openEncryptedDatabase({ path: join(dir, 'phase3.db'), key: 'job-action-test-key' })
  const checks: string[] = []
  try {
    const profileRepo = createProfileRepository(db)
    profileRepo.insertProfileAtomic(
      {
        id: 'profile-1',
        uid: 'uid-1',
        displayName: 'Profile 1',
        status: 'idle',
        createdAt: '2026-06-03T00:00:00.000Z'
      },
      []
    )
    createAutomationJobRepository(db).createJob({
      id: 'job-1',
      profileId: 'profile-1',
      type: 'self-comment',
      state: 'PENDING',
      startedAt: '2026-06-03T00:00:00.000Z'
    })

    const repo = createJobActionRepository(db)
    repo.recordAction({
      jobId: 'job-1',
      actionType: 'comment',
      target: 'post-1',
      actionTokenJti: 'jti-reference',
      executedAt: '2026-06-03T00:00:01.000Z',
      outcome: 'success'
    })
    const row = db
      .prepare('SELECT action_token FROM job_actions WHERE job_id = ?')
      .get('job-1') as { action_token: string }
    assert(row.action_token === 'jti-reference', 'action token did not store jti reference')
    assert(JSON.stringify(row).indexOf('JWT_SECRET') === -1, 'raw JWT leaked')
    checks.push('record-jti-only')

    let fkFailed = false
    try {
      repo.recordAction({
        jobId: 'missing-job',
        actionType: 'comment',
        target: null,
        actionTokenJti: null,
        executedAt: '2026-06-03T00:00:02.000Z',
        outcome: 'error'
      })
    } catch {
      fkFailed = true
    }
    assert(fkFailed, 'job_actions FK was not enforced')
    checks.push('fk-enforced')

    db.prepare('DELETE FROM automation_jobs WHERE id = ?').run('job-1')
    const count = (
      db.prepare('SELECT COUNT(*) AS c FROM job_actions WHERE job_id = ?').get('job-1') as {
        c: number
      }
    ).c
    assert(count === 0, 'job_actions did not cascade delete')
    checks.push('cascade-delete')

    return { ok: true, checks }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

void app.whenReady().then(() => {
  const resultPath = process.env['JOB_ACTION_SMOKE_RESULT_PATH']
  if (!resultPath) throw new Error('JOB_ACTION_SMOKE_RESULT_PATH is required')
  writeFileSync(resultPath, JSON.stringify(runSmoke()), 'utf8')
  app.quit()
})
