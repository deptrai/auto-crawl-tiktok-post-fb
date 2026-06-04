import { detectLoginState, type LoginState } from '../checkpoint-handler'
import { detectCheckpointType, extractCaptchaParams } from './checkpoint-type-detector'
import {
  CaptchaSolveError,
  isSolvableCheckpoint,
  type CaptchaParams,
  type CaptchaSolverClient,
  type CaptchaSolverProxy,
  type CheckpointPageLike,
  type CheckpointType,
  type SolveErrorCode,
  type SolveResult
} from './types'

export interface CheckpointSolveContext {
  profileId: string
  jobId?: string
  proxy?: CaptchaSolverProxy
}

export interface CheckpointSolveTelemetry {
  provider?: string
  checkpointType?: CheckpointType
  outcome: 'success' | 'checkpoint'
  durationMs: number
}

export interface CheckpointSolverDeps {
  isEnabled: () => boolean | Promise<boolean>
  getClients: () => CaptchaSolverClient[] | Promise<CaptchaSolverClient[]>
  detectType?: (page: CheckpointPageLike) => Promise<CheckpointType>
  extractParams?: (page: CheckpointPageLike, type: CheckpointType) => Promise<CaptchaParams | null>
  detectLoginState?: (page: CheckpointPageLike) => Promise<LoginState>
  injectToken?: (page: CheckpointPageLike, token: string) => Promise<void>
  onSolveOutcome?: (event: CheckpointSolveTelemetry) => void
  nowMs: () => number
  maxFailuresPerProfile?: number
  maxSolvesPerSession?: number
}

export interface CheckpointSolver {
  solveCheckpoint(page: CheckpointPageLike, ctx: CheckpointSolveContext): Promise<SolveResult>
}

const DEFAULT_MAX_FAILURES = 2
const DEFAULT_MAX_SOLVES = 10

function failure(
  code: SolveErrorCode,
  durationMs: number,
  params?: { type?: CheckpointType; provider?: string }
): SolveResult {
  return { ok: false, code, durationMs, ...params }
}

function errorCode(error: unknown): SolveErrorCode {
  return error instanceof CaptchaSolveError ? error.code : 'PROVIDER_ERROR'
}

export async function injectCaptchaToken(page: CheckpointPageLike, token: string): Promise<void> {
  if (!page.evaluate) throw new CaptchaSolveError('INJECT_FAILED')
  await page.evaluate((captchaToken) => {
    const writeValue = (selector: string): void => {
      const nodes = Array.from(document.querySelectorAll(selector))
      for (const node of nodes) {
        if ('value' in node) {
          ;(node as HTMLInputElement | HTMLTextAreaElement).value = captchaToken
          node.dispatchEvent(new Event('input', { bubbles: true }))
          node.dispatchEvent(new Event('change', { bubbles: true }))
        }
      }
    }

    writeValue('textarea[name="g-recaptcha-response"], textarea#g-recaptcha-response')
    writeValue(
      'input[name="fc-token"], input[name="captcha_response"], textarea[name="captcha_response"]'
    )
    window.dispatchEvent(
      new CustomEvent('phase3:captcha-token', { detail: { token: captchaToken } })
    )
  }, token)
}

export function createCheckpointSolver(deps: CheckpointSolverDeps): CheckpointSolver {
  const failuresByProfile = new Map<string, number>()
  let solveAttempts = 0
  const maxFailures = deps.maxFailuresPerProfile ?? DEFAULT_MAX_FAILURES
  const maxSolves = deps.maxSolvesPerSession ?? DEFAULT_MAX_SOLVES
  const detectType = deps.detectType ?? detectCheckpointType
  const getParams = deps.extractParams ?? extractCaptchaParams
  const reverify = deps.detectLoginState ?? detectLoginState
  const inject = deps.injectToken ?? injectCaptchaToken

  function emit(event: CheckpointSolveTelemetry): void {
    deps.onSolveOutcome?.(event)
  }

  function incrementFailure(profileId: string): void {
    failuresByProfile.set(profileId, (failuresByProfile.get(profileId) ?? 0) + 1)
  }

  return {
    async solveCheckpoint(page, ctx) {
      const startedMs = deps.nowMs()
      const duration = (): number => Math.max(0, deps.nowMs() - startedMs)

      if ((failuresByProfile.get(ctx.profileId) ?? 0) >= maxFailures) {
        emit({ outcome: 'checkpoint', durationMs: duration() })
        return failure('BREAKER_OPEN', duration())
      }

      if (!(await deps.isEnabled())) {
        emit({ outcome: 'checkpoint', durationMs: duration() })
        return failure('NO_API_KEY', duration())
      }

      const type = await detectType(page)
      if (!isSolvableCheckpoint(type)) {
        emit({ checkpointType: type, outcome: 'checkpoint', durationMs: duration() })
        return failure('UNSUPPORTED_CHECKPOINT', duration(), { type })
      }

      if (solveAttempts >= maxSolves) {
        emit({ checkpointType: type, outcome: 'checkpoint', durationMs: duration() })
        return failure('BUDGET_EXHAUSTED', duration(), { type })
      }

      const params = await getParams(page, type)
      if (!params) {
        emit({ checkpointType: type, outcome: 'checkpoint', durationMs: duration() })
        return failure('PARAMS_NOT_FOUND', duration(), { type })
      }

      const clients = await deps.getClients()
      if (clients.length === 0) {
        emit({ checkpointType: type, outcome: 'checkpoint', durationMs: duration() })
        return failure('NO_API_KEY', duration(), { type })
      }

      const paramsWithProxy = { ...params, ...(ctx.proxy ? { proxy: ctx.proxy } : {}) }
      let lastCode: SolveErrorCode = 'PROVIDER_ERROR'
      let lastProvider: string | undefined
      let failureCounted = false
      let counted = false

      for (const client of clients) {
        lastProvider = client.name
        try {
          if (!counted) {
            solveAttempts += 1
            counted = true
          }
          const token = await client.solve(paramsWithProxy)
          await inject(page, token)
          const nextState = await reverify(page)
          if (nextState === 'LOGGED_IN') {
            failuresByProfile.delete(ctx.profileId)
            emit({
              provider: client.name,
              checkpointType: type,
              outcome: 'success',
              durationMs: duration()
            })
            return { ok: true, type, provider: client.name, durationMs: duration() }
          }
          lastCode = 'STILL_BLOCKED'
          lastProvider = client.name
          incrementFailure(ctx.profileId)
          failureCounted = true
          break
        } catch (error) {
          lastCode = errorCode(error)
        }
      }

      if (!failureCounted) incrementFailure(ctx.profileId)
      emit({
        provider: lastProvider,
        checkpointType: type,
        outcome: 'checkpoint',
        durationMs: duration()
      })
      return failure(lastCode, duration(), { type, provider: lastProvider })
    }
  }
}
