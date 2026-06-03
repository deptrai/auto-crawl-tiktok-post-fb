import { test, expect } from '@playwright/test'
import type { SecureStorage } from '../../src/adapters/secure-storage'
import {
  createLoginService,
  type AutomationStateMachine,
  type Fingerprint,
  type FingerprintService,
  type LoginService,
  type LoginState,
  type PageLike,
  type SessionHandle
} from '../../src/main/automation'

function createStorage(values: Record<string, string | null>): SecureStorage {
  return {
    get: async (key) => values[key] ?? null,
    set: async () => undefined,
    delete: async () => undefined
  }
}

function createStateMachineRecorder(): Pick<AutomationStateMachine, 'transition'> & {
  transitions: Array<{ jobId: string; to: string }>
} {
  const transitions: Array<{ jobId: string; to: string }> = []
  return {
    transitions,
    transition(jobId, to) {
      transitions.push({ jobId, to })
      return {
        ok: true,
        job: {
          id: jobId,
          profileId: 'profile-1',
          type: 'self-comment',
          state: to,
          startedAt: '2026-06-03T00:00:00.000Z',
          completedAt: null,
          result: null
        }
      }
    }
  }
}

function createFingerprintService(): Pick<FingerprintService, 'ensureFingerprint'> {
  const fingerprint: Fingerprint = {
    version: 1,
    userAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
    viewport: { width: 1280, height: 720 },
    timezone: 'Asia/Ho_Chi_Minh',
    fonts: ['Arial'],
    webglNoise: 0.1
  }
  return { ensureFingerprint: () => fingerprint }
}

function createSession(
  states: LoginState[]
): SessionHandle & { submittedCodes: string[]; closed: boolean } {
  let index = 0
  const submittedCodes: string[] = []
  const session = {
    submittedCodes,
    closed: false,
    page: {
      async detectLoginState() {
        const state = states[Math.min(index, states.length - 1)]
        index += 1
        return state
      },
      async submitTwoFa(code: string) {
        submittedCodes.push(code)
      }
    } as PageLike,
    async close() {
      session.closed = true
    }
  }
  return session
}

function createService(options: {
  storage?: SecureStorage
  session?: SessionHandle & { submittedCodes?: string[]; closed?: boolean }
  states?: LoginState[]
  checkpoints?: Array<{ profileId: string; kind: string }>
}): {
  service: LoginService
  session: SessionHandle & { submittedCodes?: string[]; closed?: boolean }
  stateMachine: ReturnType<typeof createStateMachineRecorder>
  checkpoints: Array<{ profileId: string; kind: string }>
  launched: unknown[]
} {
  const session = options.session ?? createSession(options.states ?? ['LOGGED_IN'])
  const stateMachine = createStateMachineRecorder()
  const checkpoints = options.checkpoints ?? []
  const launched: unknown[] = []
  const service = createLoginService({
    secureStorage:
      options.storage ??
      createStorage({
        'profile.profile-1.cookie': 'c_user=1; xs=secret',
        'profile.profile-1.twofa': 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
      }),
    runner: {
      async launchSession(input) {
        launched.push(input)
        return session
      }
    },
    stateMachine,
    fingerprintService: createFingerprintService(),
    nowMs: () => 59_000,
    onCheckpoint: (profileId, kind) => checkpoints.push({ profileId, kind })
  })
  return { service, session, stateMachine, checkpoints, launched }
}

test('[P0] login success transitions LOGGING_IN job to WARMING_UP and closes session', async () => {
  const { service, session, stateMachine, launched } = createService({ states: ['LOGGED_IN'] })

  await expect(service.login('job-1', 'profile-1')).resolves.toEqual({
    ok: true,
    state: 'LOGGED_IN'
  })

  expect(stateMachine.transitions).toEqual([{ jobId: 'job-1', to: 'WARMING_UP' }])
  expect(session.closed).toBe(true)
  expect(JSON.stringify(launched)).not.toContain('xs=secret')
})

test('[P0] checkpoint transitions to CHECKPOINT_BLOCKED, invokes hook, and closes session', async () => {
  const { service, session, stateMachine, checkpoints } = createService({ states: ['CHECKPOINT'] })

  await expect(service.login('job-1', 'profile-1')).resolves.toEqual({
    ok: true,
    state: 'CHECKPOINT'
  })

  expect(stateMachine.transitions).toEqual([{ jobId: 'job-1', to: 'CHECKPOINT_BLOCKED' }])
  expect(checkpoints).toEqual([{ profileId: 'profile-1', kind: 'checkpoint' }])
  expect(session.closed).toBe(true)
})

test('[P0] 2FA branch generates TOTP, submits it, rechecks DOM, and succeeds', async () => {
  const session = createSession(['TWO_FA_REQUIRED', 'LOGGED_IN'])
  const { service, stateMachine } = createService({ session })

  await expect(service.login('job-1', 'profile-1')).resolves.toEqual({
    ok: true,
    state: 'LOGGED_IN'
  })

  expect(session.submittedCodes).toEqual(['287082'])
  expect(stateMachine.transitions).toEqual([{ jobId: 'job-1', to: 'WARMING_UP' }])
  expect(session.closed).toBe(true)
})

test('[P0] 2FA required without seed blocks checkpoint without leaking cookie or seed', async () => {
  const checkpoints: Array<{ profileId: string; kind: string }> = []
  const { service, session, stateMachine } = createService({
    storage: createStorage({ 'profile.profile-1.cookie': 'c_user=1; xs=secret' }),
    states: ['TWO_FA_REQUIRED'],
    checkpoints
  })

  const result = await service.login('job-1', 'profile-1')
  const resultText = JSON.stringify(result)

  expect(result).toEqual({ ok: true, state: 'TWO_FA_REQUIRED' })
  expect(resultText).not.toContain('xs=secret')
  expect(stateMachine.transitions).toEqual([{ jobId: 'job-1', to: 'CHECKPOINT_BLOCKED' }])
  expect(checkpoints).toEqual([{ profileId: 'profile-1', kind: 'two_fa_no_seed' }])
  expect(session.closed).toBe(true)
})

test('[P0] missing cookie fails without launching browser', async () => {
  const { service, stateMachine, launched } = createService({
    storage: createStorage({ 'profile.profile-1.cookie': null })
  })

  await expect(service.login('job-1', 'profile-1')).resolves.toEqual({
    ok: false,
    code: 'LOGIN_FAILED'
  })

  expect(launched).toEqual([])
  expect(stateMachine.transitions).toEqual([{ jobId: 'job-1', to: 'FAILED' }])
})

test('[P0] launch errors transition to FAILED and close session when allocated', async () => {
  const stateMachine = createStateMachineRecorder()
  const service = createLoginService({
    secureStorage: createStorage({ 'profile.profile-1.cookie': 'c_user=1' }),
    runner: {
      async launchSession() {
        throw new Error('browser launch failed with proxy password secret')
      }
    },
    stateMachine,
    fingerprintService: createFingerprintService(),
    nowMs: () => 59_000,
    onCheckpoint: () => undefined
  })

  const result = await service.login('job-1', 'profile-1')

  expect(result).toEqual({ ok: false, code: 'LOGIN_FAILED' })
  expect(JSON.stringify(result)).not.toContain('proxy password secret')
  expect(stateMachine.transitions).toEqual([{ jobId: 'job-1', to: 'FAILED' }])
})
