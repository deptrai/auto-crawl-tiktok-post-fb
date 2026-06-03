import { test, expect } from '@playwright/test'
import type { AutomationJob, AutomationJobState } from '../../src/main/automation'
import {
  createSelfCommentOrchestrator,
  type SelfCommentOrchestratorDeps
} from '../../src/main/automation/self-comment-orchestrator'
import type { ActionOutcome } from '../../src/main/automation/action-executor'

function createDeps(
  overrides: Partial<SelfCommentOrchestratorDeps> = {}
): SelfCommentOrchestratorDeps & {
  transitions: AutomationJobState[]
  records: unknown[]
  telemetry: unknown[]
  consumed: string[]
  executed: string[]
  closed: { value: boolean }
} {
  const transitions: AutomationJobState[] = []
  const records: unknown[] = []
  const telemetry: unknown[] = []
  const consumed: string[] = []
  const executed: string[] = []
  const closed = { value: false }
  const page = {
    async content() {
      return '<input name="fb_dtsg" value="abc"><input name="lsd" value="lsd">'
    }
  }
  const job = (state: AutomationJobState): AutomationJob => ({
    id: 'job-1',
    profileId: 'profile-1',
    type: 'self-comment',
    state,
    startedAt: '2026-06-03T00:00:00.000Z',
    completedAt: null,
    result: null
  })

  const deps: SelfCommentOrchestratorDeps & {
    transitions: AutomationJobState[]
    records: unknown[]
    telemetry: unknown[]
    consumed: string[]
    executed: string[]
    closed: { value: boolean }
  } = {
    transitions,
    records,
    telemetry,
    consumed,
    executed,
    closed,
    stateMachine: {
      transition(_jobId, to) {
        transitions.push(to)
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
    extractTokens: async () => ({ fbDtsg: 'fb', lsd: 'lsd', jazoest: '299' }),
    actionTokenClient: {
      requestActionToken: async () => ({
        token: 'JWT_SECRET_VALUE',
        jti: 'jti-reference',
        expiresAt: '2026-06-03T00:01:00.000Z'
      }),
      consumeActionToken: async (token) => {
        consumed.push(token)
      }
    },
    contentTemplates: {
      getRandomTemplate: () => ({
        id: 'tpl-1',
        label: 'Default',
        body: 'Nội dung comment',
        createdAt: '2026-06-03T00:00:00.000Z'
      })
    },
    actionExecutor: {
      executeSelfComment: async (_input) => {
        executed.push(_input.content)
        return 'success'
      }
    },
    jobActions: {
      recordAction: (params) => records.push(params)
    },
    now: () => '2026-06-03T00:00:01.000Z',
    nowMs: () => 1_000,
    rng: () => 0,
    onActionOutcome: (event) => telemetry.push(event),
    ...overrides
  }
  return deps
}

test('[P0] self-comment orchestrator drives happy path, consumes token, records jti only, and closes', async () => {
  const deps = createDeps()
  const orchestrator = createSelfCommentOrchestrator(deps)

  await expect(orchestrator.runSelfComment('job-1', 'profile-1')).resolves.toEqual({
    outcome: 'success'
  })

  expect(deps.transitions).toEqual([
    'ACQUIRING_PROXY',
    'LOGGING_IN',
    'WARMING_UP',
    'EXECUTING',
    'DONE'
  ])
  expect(deps.executed).toEqual(['Nội dung comment'])
  expect(deps.consumed).toEqual(['JWT_SECRET_VALUE'])
  expect(deps.records).toEqual([
    expect.objectContaining({
      jobId: 'job-1',
      actionType: 'comment',
      actionTokenJti: 'jti-reference',
      outcome: 'success'
    })
  ])
  expect(JSON.stringify(deps.records)).not.toContain('JWT_SECRET_VALUE')
  expect(deps.telemetry).toEqual([expect.objectContaining({ outcome: 'success' })])
  expect(deps.closed.value).toBe(true)
})

test('[P0] checkpoint blocks before token extraction and execution', async () => {
  const deps = createDeps({
    login: async () => ({ ok: true, state: 'CHECKPOINT' })
  })
  const orchestrator = createSelfCommentOrchestrator(deps)

  await expect(orchestrator.runSelfComment('job-1', 'profile-1')).resolves.toEqual({
    outcome: 'checkpoint'
  })

  expect(deps.transitions).toEqual(['ACQUIRING_PROXY', 'LOGGING_IN', 'CHECKPOINT_BLOCKED'])
  expect(deps.executed).toEqual([])
  expect(deps.consumed).toEqual([])
  expect(deps.records).toEqual([
    expect.objectContaining({ outcome: 'checkpoint', actionTokenJti: null })
  ])
})

test('[P0] action-token deny blocks execution and does not consume', async () => {
  const deps = createDeps({
    actionTokenClient: {
      requestActionToken: async () => {
        throw new Error('server denied token JWT_SECRET_VALUE')
      },
      consumeActionToken: async (token) => deps.consumed.push(token)
    }
  })
  const orchestrator = createSelfCommentOrchestrator(deps)

  await expect(orchestrator.runSelfComment('job-1', 'profile-1')).resolves.toEqual({
    outcome: 'error'
  })

  expect(deps.transitions).toEqual(['ACQUIRING_PROXY', 'LOGGING_IN', 'WARMING_UP', 'FAILED'])
  expect(deps.executed).toEqual([])
  expect(deps.consumed).toEqual([])
  expect(JSON.stringify(deps.records)).not.toContain('JWT_SECRET_VALUE')
})

test('[P0] empty template fails clearly without executing', async () => {
  const deps = createDeps({ contentTemplates: { getRandomTemplate: () => undefined } })
  const orchestrator = createSelfCommentOrchestrator(deps)

  await expect(orchestrator.runSelfComment('job-1', 'profile-1')).resolves.toEqual({
    outcome: 'error'
  })

  expect(deps.transitions).toEqual(['ACQUIRING_PROXY', 'LOGGING_IN', 'WARMING_UP', 'FAILED'])
  expect(deps.executed).toEqual([])
  expect(deps.records).toEqual([
    expect.objectContaining({ outcome: 'error', actionTokenJti: null })
  ])
})

test('[P0] selector_miss records jti and transitions to failed after cleanup', async () => {
  const deps = createDeps({
    actionExecutor: { executeSelfComment: async (): Promise<ActionOutcome> => 'selector_miss' }
  })
  const orchestrator = createSelfCommentOrchestrator(deps)

  await expect(orchestrator.runSelfComment('job-1', 'profile-1')).resolves.toEqual({
    outcome: 'selector_miss'
  })

  expect(deps.transitions).toEqual([
    'ACQUIRING_PROXY',
    'LOGGING_IN',
    'WARMING_UP',
    'EXECUTING',
    'FAILED'
  ])
  expect(deps.records).toEqual([
    expect.objectContaining({ outcome: 'selector_miss', actionTokenJti: 'jti-reference' })
  ])
  expect(deps.closed.value).toBe(true)
})
