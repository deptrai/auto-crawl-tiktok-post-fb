import { test, expect } from '@playwright/test'
import { registerMessengerHandlers } from '../../src/main/ipc/messenger-handlers'
import type { MessengerSeedResult, MessengerTarget } from '../../src/main/automation'
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

function job(id: string, profileId: string, state: AutomationJobState): AutomationJob {
  return {
    id,
    profileId,
    type: 'messenger_seed',
    state,
    startedAt: '2026-06-04T00:00:00.000Z',
    completedAt: null,
    result: null
  }
}

function transitionOk(
  jobId: string,
  state: AutomationJobState = 'FAILED'
): { ok: true; job: AutomationJob } {
  return { ok: true as const, job: job(jobId, 'profile-1', state) }
}

test('[P0] messenger start creates one job per profile and returns without awaiting batch', async () => {
  const ipc = new FakeIpcMain()
  const jobs = new Map<string, AutomationJob>()
  const runCalls: Array<{ jobId: string; profileId: string; targets: MessengerTarget[] }> = []
  let batchStarted = false

  registerMessengerHandlers(ipc, {
    stateMachine: {
      createJob(input) {
        const created = job(input.id, input.profileId, 'PENDING')
        jobs.set(input.id, created)
        return created
      },
      transition: (jobId, to) => transitionOk(jobId, to)
    },
    jobRepo: { getJob: (id) => jobs.get(id) },
    jobActions: {
      countByJob: () => 0,
      countSuccessByJob: () => 0
    },
    orchestrator: {
      async runMessengerSeed(jobId, profileId, options): Promise<MessengerSeedResult> {
        runCalls.push({ jobId, profileId, targets: options.targets })
        await new Promise(() => undefined)
        return { profileId, sent: 0, failed: 0, perTarget: [] }
      }
    },
    batch: async (input) => {
      batchStarted = true
      return input.runProfile(input.createJobId('profile-1'), 'profile-1', input.targets)
    }
  })

  const startedAt = Date.now()
  const response = (await ipc.invoke('phase3:messenger:start', {
    profileIds: ['profile-1', 'profile-2'],
    targets: [{ uid: '1001' }, { uid: '1002', name: 'Binh' }]
  })) as { ok: true; jobIds: string[] }

  expect(Date.now() - startedAt).toBeLessThan(500)
  expect(response.ok).toBe(true)
  expect(response.jobIds).toHaveLength(2)
  expect(response.jobIds.every((id) => jobs.get(id)?.type === 'messenger_seed')).toBe(true)
  expect(batchStarted).toBe(true)
  expect(runCalls).toEqual([
    {
      jobId: response.jobIds[0],
      profileId: 'profile-1',
      targets: [{ uid: '1001' }, { uid: '1002', name: 'Binh' }]
    }
  ])
})

test('[P0] messenger status returns state counts and no secrets', async () => {
  const ipc = new FakeIpcMain()
  registerMessengerHandlers(ipc, {
    stateMachine: {
      createJob: (input) => job(input.id, input.profileId, 'PENDING'),
      transition: (jobId, to) => transitionOk(jobId, to)
    },
    jobRepo: {
      getJob(id) {
        if (id === 'job-1') return job('job-1', 'profile-1', 'EXECUTING')
        if (id === 'job-2') return job('job-2', 'profile-2', 'CHECKPOINT_BLOCKED')
        return undefined
      }
    },
    jobActions: {
      countByJob: (jobId) => (jobId === 'job-1' ? 3 : 2),
      countSuccessByJob: (jobId) => (jobId === 'job-1' ? 2 : 1)
    },
    orchestrator: {
      async runMessengerSeed(_jobId, profileId): Promise<MessengerSeedResult> {
        return { profileId, sent: 0, failed: 0, perTarget: [] }
      }
    },
    batch: async () => ({ perProfile: [], totalSent: 0, totalFailed: 0, totalCheckpoint: 0 })
  })

  const response = await ipc.invoke('phase3:messenger:status', { jobIds: ['job-1', 'job-2'] })

  expect(response).toEqual({
    ok: true,
    jobs: [
      { jobId: 'job-1', state: 'EXECUTING', sent: 2, total: 3 },
      { jobId: 'job-2', state: 'CHECKPOINT_BLOCKED', sent: 1, total: 2, reason: 'CHECKPOINT' }
    ]
  })
  expect(JSON.stringify(response)).not.toMatch(/cookie|token|JWT|fb_dtsg|secret/i)
})

test('[P0] messenger status returns terminal JOB_NOT_FOUND for missing jobs', async () => {
  const ipc = new FakeIpcMain()
  registerMessengerHandlers(ipc, {
    stateMachine: {
      createJob: (input) => job(input.id, input.profileId, 'PENDING'),
      transition: (jobId, to) => transitionOk(jobId, to)
    },
    jobRepo: { getJob: () => undefined },
    jobActions: { countByJob: () => 0, countSuccessByJob: () => 0 },
    orchestrator: {
      async runMessengerSeed(_jobId, profileId): Promise<MessengerSeedResult> {
        return { profileId, sent: 0, failed: 0, perTarget: [] }
      }
    },
    batch: async () => ({ perProfile: [], totalSent: 0, totalFailed: 0, totalCheckpoint: 0 })
  })

  const response = await ipc.invoke('phase3:messenger:status', { jobIds: ['missing-job'] })

  expect(response).toEqual({
    ok: true,
    jobs: [{ jobId: 'missing-job', state: 'FAILED', sent: 0, total: 0, reason: 'JOB_NOT_FOUND' }]
  })
})

test('[P1] messenger start rejects invalid payload with VALIDATION_ERROR', async () => {
  const ipc = new FakeIpcMain()
  const createCalls: unknown[] = []
  const batchCalls: unknown[] = []
  registerMessengerHandlers(ipc, {
    stateMachine: {
      createJob(input) {
        createCalls.push(input)
        return job(input.id, input.profileId, 'PENDING')
      },
      transition: (jobId, to) => transitionOk(jobId, to)
    },
    jobRepo: { getJob: () => undefined },
    jobActions: { countByJob: () => 0, countSuccessByJob: () => 0 },
    orchestrator: {
      async runMessengerSeed(_jobId, profileId): Promise<MessengerSeedResult> {
        return { profileId, sent: 0, failed: 0, perTarget: [] }
      }
    },
    batch: async (input) => {
      batchCalls.push(input)
      return { perProfile: [], totalSent: 0, totalFailed: 0, totalCheckpoint: 0 }
    }
  })

  const emptyProfiles = (await ipc.invoke('phase3:messenger:start', {
    profileIds: [],
    targets: [{ uid: '1001' }]
  })) as { ok: false; error: { code: string; retryable: boolean } }
  const emptyUid = (await ipc.invoke('phase3:messenger:start', {
    profileIds: ['profile-1'],
    targets: [{ uid: '' }]
  })) as { ok: false; error: { code: string; retryable: boolean } }

  expect(emptyProfiles.error).toEqual(
    expect.objectContaining({ code: 'VALIDATION_ERROR', retryable: false })
  )
  expect(emptyUid.error).toEqual(
    expect.objectContaining({ code: 'VALIDATION_ERROR', retryable: false })
  )
  expect(createCalls).toHaveLength(0)
  expect(batchCalls).toHaveLength(0)
})

test('[P1] messenger start rejects duplicate profileIds before creating jobs', async () => {
  const ipc = new FakeIpcMain()
  const createCalls: unknown[] = []
  const batchCalls: unknown[] = []
  registerMessengerHandlers(ipc, {
    stateMachine: {
      createJob(input) {
        createCalls.push(input)
        return job(input.id, input.profileId, 'PENDING')
      },
      transition: (jobId, to) => transitionOk(jobId, to)
    },
    jobRepo: { getJob: () => undefined },
    jobActions: { countByJob: () => 0, countSuccessByJob: () => 0 },
    orchestrator: {
      async runMessengerSeed(_jobId, profileId): Promise<MessengerSeedResult> {
        return { profileId, sent: 0, failed: 0, perTarget: [] }
      }
    },
    batch: async (input) => {
      batchCalls.push(input)
      return { perProfile: [], totalSent: 0, totalFailed: 0, totalCheckpoint: 0 }
    }
  })

  const response = (await ipc.invoke('phase3:messenger:start', {
    profileIds: ['profile-1', 'profile-1'],
    targets: [{ uid: '1001' }]
  })) as { ok: false; error: { code: string; retryable: boolean } }

  expect(response.error).toEqual(
    expect.objectContaining({ code: 'VALIDATION_ERROR', retryable: false })
  )
  expect(createCalls).toHaveLength(0)
  expect(batchCalls).toHaveLength(0)
})

test('[P0] messenger start validates targetListId before creating jobs', async () => {
  const ipc = new FakeIpcMain()
  const createCalls: unknown[] = []
  const batchCalls: unknown[] = []
  registerMessengerHandlers(ipc, {
    stateMachine: {
      createJob(input) {
        createCalls.push(input)
        return job(input.id, input.profileId, 'PENDING')
      },
      transition: (jobId, to) => transitionOk(jobId, to)
    },
    jobRepo: { getJob: () => undefined },
    jobActions: { countByJob: () => 0, countSuccessByJob: () => 0 },
    targetLists: {
      listExists: () => false,
      linkJobs: () => 0,
      applyJobOutcomes: () => 0
    },
    orchestrator: {
      async runMessengerSeed(_jobId, profileId): Promise<MessengerSeedResult> {
        return { profileId, sent: 0, failed: 0, perTarget: [] }
      }
    },
    batch: async (input) => {
      batchCalls.push(input)
      return { perProfile: [], totalSent: 0, totalFailed: 0, totalCheckpoint: 0 }
    }
  })

  const response = (await ipc.invoke('phase3:messenger:start', {
    profileIds: ['profile-1'],
    targets: [{ uid: '1001' }],
    targetListId: 'missing-list'
  })) as { ok: false; error: { code: string; retryable: boolean } }

  expect(response.error).toEqual(
    expect.objectContaining({ code: 'TARGET_LIST_NOT_FOUND', retryable: false })
  )
  expect(createCalls).toHaveLength(0)
  expect(batchCalls).toHaveLength(0)
})

test('[P0] messenger target list start links jobs and terminal status applies outcomes', async () => {
  const ipc = new FakeIpcMain()
  const jobs = new Map<string, AutomationJob>()
  const linkCalls: Array<{ listId: string; jobIds: string[] }> = []
  const appliedJobs: string[] = []
  let batchStarted = false

  registerMessengerHandlers(ipc, {
    stateMachine: {
      createJob(input) {
        const created = job(input.id, input.profileId, 'PENDING')
        jobs.set(input.id, created)
        return created
      },
      transition(jobId, to) {
        const current = jobs.get(jobId) ?? job(jobId, 'profile-1', 'PENDING')
        const next = { ...current, state: to, completedAt: '2026-06-04T03:00:00.000Z' }
        jobs.set(jobId, next)
        return { ok: true, job: next }
      }
    },
    jobRepo: { getJob: (id) => jobs.get(id) },
    jobActions: {
      countByJob: () => 2,
      countSuccessByJob: () => 2
    },
    targetLists: {
      listExists: (id) => id === 'list-1',
      linkJobs(params) {
        linkCalls.push({ listId: params.listId, jobIds: params.jobIds })
        return params.jobIds.length
      },
      applyJobOutcomes(jobId) {
        appliedJobs.push(jobId)
        return 2
      }
    },
    orchestrator: {
      async runMessengerSeed(_jobId, profileId): Promise<MessengerSeedResult> {
        return { profileId, sent: 2, failed: 0, perTarget: [] }
      }
    },
    batch: async (input) => {
      batchStarted = true
      return { perProfile: [], totalSent: input.targets.length, totalFailed: 0, totalCheckpoint: 0 }
    }
  })

  const start = (await ipc.invoke('phase3:messenger:start', {
    profileIds: ['profile-1'],
    targets: [{ uid: '1001' }, { uid: '1002' }],
    targetListId: 'list-1'
  })) as { ok: true; jobIds: string[] }
  expect(start.ok).toBe(true)
  expect(linkCalls).toEqual([{ listId: 'list-1', jobIds: start.jobIds }])
  expect(batchStarted).toBe(true)

  jobs.set(start.jobIds[0], { ...jobs.get(start.jobIds[0])!, state: 'DONE' })
  await expect(ipc.invoke('phase3:messenger:status', { jobIds: start.jobIds })).resolves.toEqual({
    ok: true,
    jobs: [{ jobId: start.jobIds[0], state: 'DONE', sent: 2, total: 2 }]
  })
  expect(appliedJobs).toEqual(start.jobIds)
})
