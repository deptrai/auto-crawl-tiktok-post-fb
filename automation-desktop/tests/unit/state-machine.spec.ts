import { test, expect } from '@playwright/test'
import {
  AUTOMATION_JOB_STATES,
  TERMINAL_STATES,
  canTransition,
  createStateMachine,
  isTerminal,
  type AutomationJob,
  type AutomationJobState
} from '../../src/main/automation'
import type {
  AutomationJobRepository,
  CreateAutomationJobParams
} from '../../src/main/db/repositories/automation-job-repo'

function createFakeRepo(seed: AutomationJob[] = []): Pick<
  AutomationJobRepository,
  'createJob' | 'getJob' | 'updateState'
> & {
  updates: Array<{
    id: string
    state: AutomationJobState
    completedAt?: string
    result?: string | null
  }>
  created: CreateAutomationJobParams[]
} {
  const jobs = new Map(seed.map((job) => [job.id, job]))
  const updates: Array<{
    id: string
    state: AutomationJobState
    completedAt?: string
    result?: string | null
  }> = []
  const created: CreateAutomationJobParams[] = []

  return {
    updates,
    created,
    createJob(params) {
      created.push(params)
      jobs.set(params.id, {
        ...params,
        completedAt: null,
        result: null
      })
    },
    getJob(id) {
      return jobs.get(id)
    },
    updateState(id, state, params = {}) {
      updates.push({ id, state, ...params })
      const job = jobs.get(id)
      if (!job) return
      // Mirror the real repo's always-overwrite semantics (completed_at = ? ?? null,
      // result = ? ?? null) so the fake cannot mask a regression if the model changes.
      jobs.set(id, {
        ...job,
        state,
        completedAt: params.completedAt ?? null,
        result: params.result ?? null
      })
    }
  }
}

function job(state: AutomationJobState): AutomationJob {
  return {
    id: `job-${state}`,
    profileId: 'profile-1',
    type: 'self-comment',
    state,
    startedAt: '2026-06-03T00:00:00.000Z',
    completedAt: null,
    result: null
  }
}

test('[P0] transition table allows the full happy path and terminal branches', () => {
  const happyPath: AutomationJobState[] = [
    'PENDING',
    'ACQUIRING_PROXY',
    'LOGGING_IN',
    'SOLVING_CHECKPOINT',
    'WARMING_UP',
    'EXECUTING',
    'DONE'
  ]

  for (let index = 0; index < happyPath.length - 1; index += 1) {
    expect(canTransition(happyPath[index], happyPath[index + 1])).toBe(true)
  }

  for (const state of AUTOMATION_JOB_STATES) {
    if (isTerminal(state)) continue
    expect(canTransition(state, 'FAILED')).toBe(true)
    expect(canTransition(state, 'CANCELLED')).toBe(true)
  }

  expect(canTransition('PENDING', 'DONE')).toBe(true)
  expect(canTransition('EXECUTING', 'CHECKPOINT_BLOCKED')).toBe(true)
})

test('[P0] invalid transition returns typed error and does not persist', () => {
  const repo = createFakeRepo([job('PENDING')])
  const machine = createStateMachine({ repo, now: () => '2026-06-03T00:00:01.000Z' })

  expect(canTransition('PENDING', 'EXECUTING')).toBe(false)
  expect(machine.transition('job-PENDING', 'EXECUTING')).toEqual({
    ok: false,
    code: 'INVALID_TRANSITION',
    from: 'PENDING',
    to: 'EXECUTING'
  })
  expect(repo.updates).toEqual([])
})

test('[P0] terminal guard prevents resurrecting finished jobs', () => {
  for (const terminalState of TERMINAL_STATES) {
    const repo = createFakeRepo([job(terminalState)])
    const machine = createStateMachine({ repo, now: () => '2026-06-03T00:00:01.000Z' })

    expect(machine.transition(`job-${terminalState}`, 'PENDING')).toEqual({
      ok: false,
      code: 'JOB_TERMINAL',
      from: terminalState
    })
    expect(repo.updates).toEqual([])
  }
})

test('[P0] missing job returns typed error', () => {
  const repo = createFakeRepo()
  const machine = createStateMachine({ repo, now: () => '2026-06-03T00:00:01.000Z' })

  expect(machine.transition('ghost', 'ACQUIRING_PROXY')).toEqual({
    ok: false,
    code: 'JOB_NOT_FOUND'
  })
})

test('[P0] terminal transition persists completedAt and optional result', () => {
  const repo = createFakeRepo([job('EXECUTING')])
  const machine = createStateMachine({ repo, now: () => '2026-06-03T00:00:01.000Z' })

  expect(machine.transition('job-EXECUTING', 'DONE', { result: '{"ok":true}' })).toEqual({
    ok: true,
    job: {
      ...job('EXECUTING'),
      state: 'DONE',
      completedAt: '2026-06-03T00:00:01.000Z',
      result: '{"ok":true}'
    }
  })
  expect(repo.updates).toEqual([
    {
      id: 'job-EXECUTING',
      state: 'DONE',
      completedAt: '2026-06-03T00:00:01.000Z',
      result: '{"ok":true}'
    }
  ])
})

test('[P0] createJob initializes PENDING with injected clock', () => {
  const repo = createFakeRepo()
  const machine = createStateMachine({ repo, now: () => '2026-06-03T00:00:00.000Z' })

  expect(
    machine.createJob({ id: 'job-create', profileId: 'profile-create', type: 'self-comment' })
  ).toEqual({
    id: 'job-create',
    profileId: 'profile-create',
    type: 'self-comment',
    state: 'PENDING',
    startedAt: '2026-06-03T00:00:00.000Z',
    completedAt: null,
    result: null
  })
  expect(repo.created).toEqual([
    {
      id: 'job-create',
      profileId: 'profile-create',
      type: 'self-comment',
      state: 'PENDING',
      startedAt: '2026-06-03T00:00:00.000Z'
    }
  ])
})

test('[P0] terminal set contains exactly the four terminal states', () => {
  expect([...TERMINAL_STATES].sort()).toEqual(['CANCELLED', 'CHECKPOINT_BLOCKED', 'DONE', 'FAILED'])
  expect(AUTOMATION_JOB_STATES.filter(isTerminal).sort()).toEqual([...TERMINAL_STATES].sort())
})
