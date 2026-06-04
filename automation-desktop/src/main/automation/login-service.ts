import type { SecureStorage } from '../../adapters/secure-storage'
import type { AutomationJobState } from '../../shared/types/automation-job'
import { brandSecret, revealSecret } from '../../shared/types/secret'
import type { AutomationStateMachine, AutomationTransitionErrorCode } from './state-machine'
import type { FingerprintService } from './fingerprint-service'
import { parseCookieHeader } from './cookie'
import { detectLoginState, submitTwoFa, type LoginState } from './checkpoint-handler'
import { generateTotp } from './totp'
import type { PlaywrightProxyConfig, PlaywrightRunner } from './playwright-runner'
import type { CheckpointSolver, SolveResult } from './checkpoint'

export type LoginCheckpointKind = 'checkpoint' | 'two_fa_no_seed' | 'two_fa_failed'

export type LoginResult =
  | { ok: true; state: LoginState; keepSessionOpen?: boolean }
  | { ok: false; code: 'LOGIN_FAILED'; keepSessionOpen?: boolean }

export interface LoginService {
  login(jobId: string, profileId: string): Promise<LoginResult>
}

export interface LoginServiceDeps {
  secureStorage: Pick<SecureStorage, 'get'>
  runner: Pick<PlaywrightRunner, 'launchSession'>
  stateMachine: Pick<AutomationStateMachine, 'transition'>
  fingerprintService: Pick<FingerprintService, 'ensureFingerprint'>
  nowMs: () => number
  onCheckpoint: (profileId: string, kind: LoginCheckpointKind) => void
  onTransitionError?: (
    jobId: string,
    to: AutomationJobState,
    code: AutomationTransitionErrorCode
  ) => void
  proxy?: PlaywrightProxyConfig
  solveCheckpoint?: CheckpointSolver['solveCheckpoint']
}

function secretKey(profileId: string, field: 'cookie' | 'twofa'): string {
  return `profile.${profileId}.${field}`
}

function transitionJob(deps: LoginServiceDeps, jobId: string, to: AutomationJobState): void {
  const result = deps.stateMachine.transition(jobId, to)
  if (!result.ok) deps.onTransitionError?.(jobId, to, result.code)
}

function transitionToFailed(deps: LoginServiceDeps, jobId: string): void {
  transitionJob(deps, jobId, 'FAILED')
}

function transitionToCheckpointBlocked(
  deps: LoginServiceDeps,
  jobId: string,
  profileId: string,
  kind: LoginCheckpointKind
): void {
  transitionJob(deps, jobId, 'CHECKPOINT_BLOCKED')
  deps.onCheckpoint(profileId, kind)
}

export function createLoginService(deps: LoginServiceDeps): LoginService {
  return {
    async login(jobId, profileId) {
      const rawCookie = await deps.secureStorage.get(secretKey(profileId, 'cookie'))
      if (!rawCookie || rawCookie.trim() === '') {
        transitionToFailed(deps, jobId)
        return { ok: false, code: 'LOGIN_FAILED' }
      }

      const cookieSecret = brandSecret(rawCookie)
      const twoFaRaw = await deps.secureStorage.get(secretKey(profileId, 'twofa'))
      const twoFaSecret = twoFaRaw && twoFaRaw.trim() ? brandSecret(twoFaRaw) : null
      let session: Awaited<ReturnType<PlaywrightRunner['launchSession']>> | undefined
      let keepSessionOpen = false

      try {
        const cookies = parseCookieHeader(revealSecret(cookieSecret))
        const fingerprint = deps.fingerprintService.ensureFingerprint(profileId)
        session = await deps.runner.launchSession({
          proxy: deps.proxy,
          fingerprint,
          cookies
        })

        let state = await detectLoginState(session.page)
        if (state === 'TWO_FA_REQUIRED') {
          if (!twoFaSecret) {
            transitionToCheckpointBlocked(deps, jobId, profileId, 'two_fa_no_seed')
            keepSessionOpen = true
            return { ok: true, state, keepSessionOpen }
          }

          try {
            const code = generateTotp(revealSecret(twoFaSecret), deps.nowMs())
            await submitTwoFa(session.page, code)
            state = await detectLoginState(session.page)
          } catch {
            transitionToCheckpointBlocked(deps, jobId, profileId, 'two_fa_failed')
            keepSessionOpen = true
            return { ok: true, state: 'TWO_FA_REQUIRED', keepSessionOpen }
          }
        }

        if (state === 'LOGGED_IN') {
          transitionJob(deps, jobId, 'WARMING_UP')
          return { ok: true, state }
        }

        if (state === 'CHECKPOINT') {
          if (deps.solveCheckpoint) {
            transitionJob(deps, jobId, 'SOLVING_CHECKPOINT')
            const solved: SolveResult = await deps.solveCheckpoint(session.page, {
              profileId,
              jobId,
              ...(deps.proxy ? { proxy: deps.proxy } : {})
            })
            if (solved.ok) {
              transitionJob(deps, jobId, 'WARMING_UP')
              return { ok: true, state: 'LOGGED_IN' }
            }
          }

          transitionToCheckpointBlocked(deps, jobId, profileId, 'checkpoint')
          keepSessionOpen = true
          return { ok: true, state, keepSessionOpen }
        }

        if (state === 'TWO_FA_REQUIRED') {
          transitionToCheckpointBlocked(deps, jobId, profileId, 'two_fa_failed')
          keepSessionOpen = true
          return { ok: true, state, keepSessionOpen }
        }

        transitionToFailed(deps, jobId)
        return { ok: false, code: 'LOGIN_FAILED' }
      } catch {
        transitionToFailed(deps, jobId)
        return { ok: false, code: 'LOGIN_FAILED' }
      } finally {
        if (!keepSessionOpen) await session?.close().catch(() => undefined)
      }
    }
  }
}
