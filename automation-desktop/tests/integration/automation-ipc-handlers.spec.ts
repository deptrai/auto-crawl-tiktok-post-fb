import { test, expect } from '@playwright/test'
import { registerAutomationHandlers } from '../../src/main/ipc/automation-handlers'
import type { AutomationJob, AutomationJobState } from '../../src/shared/types/automation-job'

type IpcHandler = (_event: unknown, request: unknown) => Promise<unknown>

class FakeIpcMain {
  readonly handlers = new Map<string, IpcHandler>()
  handle(channel: string, handler: IpcHandler): void {
    this.handlers.set(channel, handler)
  }
  async invoke(channel: string, request: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`Missing handler: ${channel}`)
    return handler({}, request)
  }
}

function job(id: string, state: AutomationJobState): AutomationJob {
  return {
    id,
    profileId: 'profile-1',
    type: 'self_comment',
    state,
    startedAt: '2026-06-03T00:00:00.000Z',
    completedAt: null,
    result: null
  }
}

test('[P0] automation start creates job and returns immediately without awaiting orchestrator', async () => {
  const ipc = new FakeIpcMain()
  const jobs = new Map<string, AutomationJob>()
  const calls: Array<{ jobId: string; profileId: string; target?: string }> = []
  registerAutomationHandlers(ipc, {
    stateMachine: {
      createJob(input) {
        const created = job(input.id, 'PENDING')
        jobs.set(input.id, created)
        return created
      }
    },
    jobRepo: { getJob: (id) => jobs.get(id) },
    orchestrator: {
      async runSelfComment(jobId, profileId, options) {
        calls.push({ jobId, profileId, target: options?.target })
        await new Promise(() => undefined)
        return { outcome: 'success' as const }
      }
    }
  })

  const startedAt = Date.now()
  const response = (await ipc.invoke('phase3:automation:start', {
    profileId: 'profile-1',
    target: 'https://www.facebook.com/me/posts/1'
  })) as { ok: true; jobId: string }

  expect(Date.now() - startedAt).toBeLessThan(500)
  expect(response.ok).toBe(true)
  expect(jobs.get(response.jobId)?.state).toBe('PENDING')
  expect(calls).toEqual([
    { jobId: response.jobId, profileId: 'profile-1', target: 'https://www.facebook.com/me/posts/1' }
  ])
})

test('[P0] automation status returns state and latest outcome without secrets', async () => {
  const ipc = new FakeIpcMain()
  registerAutomationHandlers(ipc, {
    stateMachine: { createJob: (input) => job(input.id, 'PENDING') },
    jobRepo: { getJob: () => job('job-1', 'DONE') },
    jobActions: {
      getLatestByJob: () => ({ outcome: 'success', executedAt: '2026-06-03T00:00:01.000Z' })
    },
    orchestrator: { runSelfComment: async () => ({ outcome: 'success' }) }
  })

  const response = await ipc.invoke('phase3:automation:status', { jobId: 'job-1' })

  expect(response).toEqual({ ok: true, state: 'DONE', outcome: 'success' })
  expect(JSON.stringify(response)).not.toMatch(/cookie|token|JWT|fb_dtsg|secret/i)
})

test('[P1] automation status maps missing job to non-retryable ErrorEnvelope', async () => {
  const ipc = new FakeIpcMain()
  registerAutomationHandlers(ipc, {
    stateMachine: { createJob: (input) => job(input.id, 'PENDING') },
    jobRepo: { getJob: () => undefined },
    orchestrator: { runSelfComment: async () => ({ outcome: 'error' }) }
  })

  const response = (await ipc.invoke('phase3:automation:status', { jobId: 'missing' })) as {
    ok: false
    error: { code: string; retryable: boolean; message: string }
  }

  expect(response.error).toEqual(
    expect.objectContaining({
      code: 'JOB_NOT_FOUND',
      message: 'Không tìm thấy job automation.',
      retryable: false
    })
  )
})

test('[P1] automation start rejects invalid request with VALIDATION_ERROR, does not invoke orchestrator', async () => {
  const ipc = new FakeIpcMain()
  const createJobCalls: unknown[] = []
  const runCalls: unknown[] = []
  registerAutomationHandlers(ipc, {
    stateMachine: {
      createJob(input) {
        createJobCalls.push(input)
        return job(input.id, 'PENDING')
      }
    },
    jobRepo: { getJob: () => undefined },
    orchestrator: {
      async runSelfComment(jobId, profileId) {
        runCalls.push({ jobId, profileId })
        return { outcome: 'success' as const }
      }
    }
  })

  const emptyProfileId = (await ipc.invoke('phase3:automation:start', {
    profileId: ''
  })) as { ok: false; error: { code: string; retryable: boolean } }

  const missingField = (await ipc.invoke('phase3:automation:start', {})) as {
    ok: false
    error: { code: string }
  }

  expect(emptyProfileId.ok).toBe(false)
  expect(emptyProfileId.error.code).toBe('VALIDATION_ERROR')
  expect(emptyProfileId.error.retryable).toBe(false)
  expect(missingField.ok).toBe(false)
  expect(missingField.error.code).toBe('VALIDATION_ERROR')
  expect(createJobCalls).toHaveLength(0)
  expect(runCalls).toHaveLength(0)
})
