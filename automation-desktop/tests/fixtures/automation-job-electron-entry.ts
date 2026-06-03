import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { openEncryptedDatabase } from '../../src/main/db/client'
import { createProfileRepository } from '../../src/main/db/repositories/profile-repo'
import { createAutomationJobRepository } from '../../src/main/db/repositories/automation-job-repo'
import { createStateMachine } from '../../src/main/automation'

type SmokeResult = { ok: true; checks: string[] } | { ok: false; error: string }

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function runSmoke(): SmokeResult {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-automation-job-'))
  const dbPath = join(dir, 'phase3.db')
  const key = 'automation-job-test-key'
  const checks: string[] = []
  let db = openEncryptedDatabase({ path: dbPath, key })

  try {
    const profileRepo = createProfileRepository(db)
    profileRepo.insertProfileAtomic(
      {
        id: 'profile-job-1',
        uid: 'uid-job-1',
        displayName: 'Profile Job 1',
        status: 'idle',
        createdAt: '2026-06-03T00:00:00.000Z'
      },
      []
    )

    let jobRepo = createAutomationJobRepository(db)
    let machine = createStateMachine({ repo: jobRepo, now: () => '2026-06-03T00:00:00.000Z' })
    machine.createJob({ id: 'job-resume', profileId: 'profile-job-1', type: 'self-comment' })
    assert(machine.transition('job-resume', 'ACQUIRING_PROXY').ok, 'transition to proxy failed')
    assert(machine.transition('job-resume', 'LOGGING_IN').ok, 'transition to login failed')
    db.close()

    db = openEncryptedDatabase({ path: dbPath, key })
    jobRepo = createAutomationJobRepository(db)
    const resumed = jobRepo.getJob('job-resume')
    assert(resumed?.state === 'LOGGING_IN', 'resumed state mismatch')
    assert(
      jobRepo.listResumable().some((job) => job.id === 'job-resume'),
      'job not resumable'
    )
    checks.push('persist-resume')

    machine = createStateMachine({ repo: jobRepo, now: () => '2026-06-03T00:00:01.000Z' })
    assert(
      machine.transition('job-resume', 'SOLVING_CHECKPOINT').ok,
      'transition checkpoint failed'
    )
    assert(machine.transition('job-resume', 'WARMING_UP').ok, 'transition warmup failed')
    assert(machine.transition('job-resume', 'EXECUTING').ok, 'transition execute failed')
    assert(
      machine.transition('job-resume', 'DONE', { result: '{"ok":true}' }).ok,
      'transition done failed'
    )
    const done = jobRepo.getJob('job-resume')
    assert(done?.completedAt === '2026-06-03T00:00:01.000Z', 'completed_at not persisted')
    assert(done?.result === '{"ok":true}', 'result not persisted')
    assert(
      !jobRepo.listResumable().some((job) => job.id === 'job-resume'),
      'terminal job resumable'
    )
    checks.push('terminal-excluded')

    let fkFailed = false
    try {
      jobRepo.createJob({
        id: 'job-missing-profile',
        profileId: 'missing-profile',
        type: 'self-comment',
        state: 'PENDING',
        startedAt: '2026-06-03T00:00:00.000Z'
      })
    } catch {
      fkFailed = true
    }
    assert(fkFailed, 'missing profile FK did not fail')
    checks.push('foreign-key-enforced')

    return { ok: true, checks }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

void app.whenReady().then(() => {
  const result = runSmoke()
  const resultPath = process.env['AUTOMATION_JOB_SMOKE_RESULT_PATH']
  if (resultPath) writeFileSync(resultPath, JSON.stringify(result), 'utf8')
  app.quit()
})
