import { test, expect } from '@playwright/test'
import {
  CaptchaSolveError,
  createCheckpointSolver,
  type CaptchaSolverClient,
  type CheckpointSolveTelemetry
} from '../../src/main/automation/checkpoint'

const page = { url: () => 'https://facebook.com/checkpoint', content: async () => '<main />' }

function client(name: string, result: string | Error): CaptchaSolverClient {
  return {
    name,
    async solve() {
      if (result instanceof Error) throw result
      return result
    }
  }
}

test('[P0] checkpoint solver gates off without calling providers', async () => {
  let calls = 0
  const solver = createCheckpointSolver({
    isEnabled: () => false,
    getClients: () => [client('capsolver', 'TOKEN')],
    detectType: async () => 'FUNCAPTCHA',
    extractParams: async () => ({ type: 'FUNCAPTCHA', publicKey: 'pk', websiteUrl: 'url' }),
    injectToken: async () => {
      calls += 1
    },
    detectLoginState: async () => 'LOGGED_IN',
    nowMs: () => 1
  })

  await expect(solver.solveCheckpoint(page, { profileId: 'profile-1' })).resolves.toMatchObject({
    ok: false,
    code: 'NO_API_KEY',
    type: 'FUNCAPTCHA'
  })
  expect(calls).toBe(0)
})

test('[P0] checkpoint solver skips unsupported checkpoint types', async () => {
  const solver = createCheckpointSolver({
    isEnabled: () => true,
    getClients: () => [client('capsolver', 'TOKEN')],
    detectType: async () => 'OTP',
    nowMs: () => 1
  })

  await expect(solver.solveCheckpoint(page, { profileId: 'profile-1' })).resolves.toMatchObject({
    ok: false,
    code: 'UNSUPPORTED_CHECKPOINT',
    type: 'OTP'
  })
})

test('[P0] checkpoint solver falls back from CapSolver to 2captcha and emits safe telemetry', async () => {
  const telemetry: CheckpointSolveTelemetry[] = []
  const solver = createCheckpointSolver({
    isEnabled: () => true,
    getClients: () => [
      client('capsolver', new CaptchaSolveError('PROVIDER_ERROR', 'API_KEY_SECRET proxy-pass')),
      client('2captcha', 'CAPTCHA_TOKEN_SECRET')
    ],
    detectType: async () => 'RECAPTCHA_V2',
    extractParams: async () => ({ type: 'RECAPTCHA_V2', siteKey: 'site-key', websiteUrl: 'url' }),
    injectToken: async () => undefined,
    detectLoginState: async () => 'LOGGED_IN',
    onSolveOutcome: (event) => telemetry.push(event),
    nowMs: () => 10
  })

  const result = await solver.solveCheckpoint(page, { profileId: 'profile-1' })

  expect(result).toMatchObject({ ok: true, provider: '2captcha', type: 'RECAPTCHA_V2' })
  expect(telemetry).toEqual([
    expect.objectContaining({
      provider: '2captcha',
      checkpointType: 'RECAPTCHA_V2',
      outcome: 'success'
    })
  ])
  expect(JSON.stringify({ result, telemetry })).not.toMatch(/SECRET|proxy-pass|API_KEY/i)
})

test('[P0] checkpoint solver enforces breaker and budget caps', async () => {
  let providerCalls = 0
  const failingClient: CaptchaSolverClient = {
    name: 'capsolver',
    async solve() {
      providerCalls += 1
      throw new CaptchaSolveError('PROVIDER_ERROR')
    }
  }
  const solver = createCheckpointSolver({
    isEnabled: () => true,
    getClients: () => [failingClient],
    detectType: async () => 'FUNCAPTCHA',
    extractParams: async () => ({ type: 'FUNCAPTCHA', publicKey: 'pk', websiteUrl: 'url' }),
    nowMs: () => 1,
    maxFailuresPerProfile: 2,
    maxSolvesPerSession: 2
  })

  await expect(solver.solveCheckpoint(page, { profileId: 'profile-1' })).resolves.toMatchObject({
    code: 'PROVIDER_ERROR'
  })
  await expect(solver.solveCheckpoint(page, { profileId: 'profile-1' })).resolves.toMatchObject({
    code: 'PROVIDER_ERROR'
  })
  await expect(solver.solveCheckpoint(page, { profileId: 'profile-1' })).resolves.toMatchObject({
    code: 'BREAKER_OPEN'
  })
  await expect(solver.solveCheckpoint(page, { profileId: 'profile-2' })).resolves.toMatchObject({
    code: 'BUDGET_EXHAUSTED'
  })
  expect(providerCalls).toBe(2)
})

test('[P0] checkpoint solver counts rejected token as failure', async () => {
  const solver = createCheckpointSolver({
    isEnabled: () => true,
    getClients: () => [client('capsolver', 'TOKEN')],
    detectType: async () => 'FUNCAPTCHA',
    extractParams: async () => ({ type: 'FUNCAPTCHA', publicKey: 'pk', websiteUrl: 'url' }),
    injectToken: async () => undefined,
    detectLoginState: async () => 'CHECKPOINT',
    nowMs: () => 1
  })

  await expect(solver.solveCheckpoint(page, { profileId: 'profile-1' })).resolves.toMatchObject({
    ok: false,
    code: 'STILL_BLOCKED',
    provider: 'capsolver'
  })
})
