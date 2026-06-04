import { test, expect } from '@playwright/test'
import type { AutomationJob, AutomationJobState } from '../../src/main/automation'
import type { ActionOutcome } from '../../src/main/automation/action-executor'
import { renderContentTemplate } from '../../src/shared/content-template-render'
import {
  createMessengerSeedOrchestrator,
  type MessengerSeedOrchestratorDeps
} from '../../src/main/automation/messenger-seed-orchestrator'

type RecordParams = Parameters<MessengerSeedOrchestratorDeps['jobActions']['recordAction']>[0]

function createDeps(
  overrides: Partial<MessengerSeedOrchestratorDeps> = {}
): MessengerSeedOrchestratorDeps & {
  transitions: AutomationJobState[]
  transitionResults: Array<string | null | undefined>
  records: RecordParams[]
  consumed: string[]
  executed: string[]
  navigated: string[]
  slept: number[]
  closed: { value: boolean }
} {
  const transitions: AutomationJobState[] = []
  const transitionResults: Array<string | null | undefined> = []
  const records: RecordParams[] = []
  const consumed: string[] = []
  const executed: string[] = []
  const navigated: string[] = []
  const slept: number[] = []
  const closed = { value: false }
  const page = { locator: () => ({ first: () => ({ count: async () => 1 }) }) }
  const job = (state: AutomationJobState): AutomationJob => ({
    id: 'job-1',
    profileId: 'profile-1',
    type: 'messenger-seed',
    state,
    startedAt: '2026-06-04T00:00:00.000Z',
    completedAt: null,
    result: null
  })

  const deps: MessengerSeedOrchestratorDeps & {
    transitions: AutomationJobState[]
    transitionResults: Array<string | null | undefined>
    records: RecordParams[]
    consumed: string[]
    executed: string[]
    navigated: string[]
    slept: number[]
    closed: { value: boolean }
  } = {
    transitions,
    transitionResults,
    records,
    consumed,
    executed,
    navigated,
    slept,
    closed,
    stateMachine: {
      transition(_jobId, to, options?: { result?: string | null }) {
        transitions.push(to)
        transitionResults.push(options?.result)
        return { ok: true, job: job(to) }
      }
    },
    login: async () => ({
      ok: true,
      state: 'LOGGED_IN',
      session: {
        page,
        async close() {
          closed.value = true
        }
      }
    }),
    extractTokens: async () => ({ fbDtsg: 'fb_secret', lsd: 'lsd_secret', jazoest: '299' }),
    actionTokenClient: {
      requestActionToken: async () => ({
        token: `JWT_SECRET_${consumed.length + records.length + 1}`,
        jti: `jti-${consumed.length + records.length + 1}`,
        expiresAt: '2026-06-04T00:01:00.000Z'
      }),
      consumeActionToken: async (token) => {
        consumed.push(token)
        return { jti: 'consumed-jti', consumedAt: '2026-06-04T00:00:02.000Z' }
      }
    },
    contentTemplates: {
      getRandomTemplate: () => ({
        id: 'tpl-1',
        label: 'Messenger',
        body: 'Chào {name} uid={uid}',
        createdAt: '2026-06-04T00:00:00.000Z'
      })
    },
    actionExecutor: {
      executeMessengerSeed: async (_input) => {
        executed.push(_input.content)
        return 'success'
      }
    },
    jobActions: { recordAction: (params) => records.push(params) },
    render: renderContentTemplate,
    navigate: async (_page, target) => {
      navigated.push(target)
    },
    sleep: async (ms) => {
      slept.push(ms)
    },
    now: () => '2026-06-04T00:00:01.000Z',
    nowMs: () => 1_000,
    rng: () => 0,
    ...overrides
  }
  return deps
}

test('[P0] messenger seed orchestrator sends three targets with rendered content, tokens, records, delay, and DONE', async () => {
  const deps = createDeps()
  const orchestrator = createMessengerSeedOrchestrator(deps)

  const result = await orchestrator.runMessengerSeed('job-1', 'profile-1', {
    targets: [{ uid: '1001', name: 'An' }, { uid: '1002', name: 'Binh' }, { uid: '1003' }]
  })

  expect(result).toEqual({
    profileId: 'profile-1',
    sent: 3,
    failed: 0,
    perTarget: [
      { uid: '1001', outcome: 'success' },
      { uid: '1002', outcome: 'success' },
      { uid: '1003', outcome: 'success' }
    ]
  })
  expect(deps.transitions).toEqual([
    'ACQUIRING_PROXY',
    'LOGGING_IN',
    'WARMING_UP',
    'EXECUTING',
    'DONE'
  ])
  expect(deps.executed).toEqual(['Chào An uid=1001', 'Chào Binh uid=1002', 'Chào  uid=1003'])
  expect(deps.navigated).toEqual([
    'https://www.facebook.com/messages/t/1001',
    'https://www.facebook.com/messages/t/1002',
    'https://www.facebook.com/messages/t/1003'
  ])
  expect(deps.records).toEqual([
    expect.objectContaining({ actionType: 'message', target: '1001', actionTokenJti: 'jti-1' }),
    expect.objectContaining({ actionType: 'message', target: '1002', actionTokenJti: 'jti-3' }),
    expect.objectContaining({ actionType: 'message', target: '1003', actionTokenJti: 'jti-5' })
  ])
  expect(deps.consumed).toEqual(['JWT_SECRET_1', 'JWT_SECRET_3', 'JWT_SECRET_5'])
  expect(deps.slept.length).toBe(2)
  expect(JSON.stringify(result)).not.toMatch(/JWT|cookie|fb_secret|lsd_secret|Chào/i)
  expect(deps.closed.value).toBe(true)
})

test('[P0] messenger seed orchestrator stops current profile on checkpoint and does not send later targets', async () => {
  let calls = 0
  const deps = createDeps({
    actionExecutor: {
      executeMessengerSeed: async (): Promise<ActionOutcome> => {
        calls += 1
        return calls === 2 ? 'checkpoint' : 'success'
      }
    }
  })
  const orchestrator = createMessengerSeedOrchestrator(deps)

  const result = await orchestrator.runMessengerSeed('job-1', 'profile-1', {
    targets: [{ uid: '1001' }, { uid: '1002' }, { uid: '1003' }]
  })

  expect(result.sent).toBe(1)
  expect(result.failed).toBe(1)
  expect(result.stoppedReason).toBe('CHECKPOINT')
  expect(result.perTarget).toEqual([
    { uid: '1001', outcome: 'success' },
    { uid: '1002', outcome: 'checkpoint', reason: 'CHECKPOINT' }
  ])
  expect(deps.navigated).toEqual([
    'https://www.facebook.com/messages/t/1001',
    'https://www.facebook.com/messages/t/1002'
  ])
  expect(deps.transitions.at(-1)).toBe('CHECKPOINT_BLOCKED')
  expect(deps.closed.value).toBe(false)
})

test('[P0] messenger seed login checkpoint keeps browser session open for manual captcha', async () => {
  const checkpointClosed = { value: false }
  const deps = createDeps({
    login: async () => ({
      ok: true,
      state: 'CHECKPOINT',
      reason: 'CHECKPOINT_BLOCKED',
      keepSessionOpen: true,
      session: {
        page: { locator: () => ({ first: () => ({ count: async () => 1 }) }) },
        async close() {
          checkpointClosed.value = true
        }
      }
    })
  })
  const orchestrator = createMessengerSeedOrchestrator(deps)

  const result = await orchestrator.runMessengerSeed('job-1', 'profile-1', {
    targets: [{ uid: '1001' }, { uid: '1002' }]
  })

  expect(result).toEqual({
    profileId: 'profile-1',
    sent: 0,
    failed: 2,
    stoppedReason: 'CHECKPOINT_BLOCKED',
    perTarget: []
  })
  expect(deps.transitions).toEqual(['ACQUIRING_PROXY', 'LOGGING_IN', 'CHECKPOINT_BLOCKED'])
  expect(checkpointClosed.value).toBe(false)
})

test('[P0] messenger seed orchestrator fails safely on login failure without sending', async () => {
  const deps = createDeps({
    login: async () => ({ ok: false, code: 'LOGIN_FAILED', reason: 'COOKIE_PARSE_FAILED' })
  })
  const orchestrator = createMessengerSeedOrchestrator(deps)

  const result = await orchestrator.runMessengerSeed('job-1', 'profile-1', {
    targets: [{ uid: '1001' }, { uid: '1002' }]
  })

  expect(result).toEqual({
    profileId: 'profile-1',
    sent: 0,
    failed: 2,
    stoppedReason: 'LOGIN_FAILED',
    perTarget: []
  })
  expect(deps.transitions).toEqual(['ACQUIRING_PROXY', 'LOGGING_IN', 'FAILED'])
  expect(deps.navigated).toEqual([])
  expect(deps.records).toEqual([])
})

test('[P0] messenger seed orchestrator soft-skips profiles that are not warmed', async () => {
  const deps = createDeps({ isProfileWarm: () => false })
  const orchestrator = createMessengerSeedOrchestrator(deps)

  const result = await orchestrator.runMessengerSeed('job-1', 'profile-1', {
    targets: [{ uid: '1001' }]
  })

  expect(result).toEqual({
    profileId: 'profile-1',
    sent: 0,
    failed: 1,
    stoppedReason: 'NOT_WARMED',
    perTarget: []
  })
  expect(deps.transitions).toEqual(['FAILED'])
  expect(deps.navigated).toEqual([])
})

test('[P1] messenger seed orchestrator result never serializes token, cookie, csrf, or rendered body', async () => {
  const deps = createDeps()
  const orchestrator = createMessengerSeedOrchestrator(deps)

  const result = await orchestrator.runMessengerSeed('job-1', 'profile-1', {
    targets: [{ uid: '1001', name: 'Secret Name' }]
  })

  expect(JSON.stringify(result)).not.toMatch(
    /JWT_SECRET|cookie|fb_dtsg|fb_secret|lsd_secret|Chào|Secret Name/i
  )
  expect(JSON.stringify(deps.transitionResults)).not.toMatch(
    /JWT_SECRET|cookie|fb_dtsg|fb_secret|lsd_secret|Chào|Secret Name/i
  )
})
