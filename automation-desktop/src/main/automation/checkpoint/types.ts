/**
 * Checkpoint solving domain types.
 *
 * Only FunCaptcha (Arkose Labs) and reCAPTCHA v2 are solvable via external
 * CAPTCHA APIs. OTP / identity verification / unusual-activity locks require a
 * human and must fall back to CHECKPOINT_BLOCKED.
 */

export type CheckpointType = 'FUNCAPTCHA' | 'RECAPTCHA_V2' | 'OTP' | 'IDENTITY' | 'UNKNOWN'

/** Checkpoint types that an external CAPTCHA solver can attempt. */
export const SOLVABLE_CHECKPOINT_TYPES: ReadonlySet<CheckpointType> = new Set<CheckpointType>([
  'FUNCAPTCHA',
  'RECAPTCHA_V2'
])

export function isSolvableCheckpoint(type: CheckpointType): boolean {
  return SOLVABLE_CHECKPOINT_TYPES.has(type)
}

export interface FunCaptchaParams {
  type: 'FUNCAPTCHA'
  /** Arkose Labs public key (pk_...). */
  publicKey: string
  /** Page URL where the captcha is rendered. */
  websiteUrl: string
  /** Optional Arkose service subdomain (surl). */
  subdomain?: string
  /** Optional data blob passed to the Arkose enforcement iframe. */
  blob?: string
  proxy?: CaptchaSolverProxy
}

export interface RecaptchaV2Params {
  type: 'RECAPTCHA_V2'
  /** reCAPTCHA site key (data-sitekey). */
  siteKey: string
  websiteUrl: string
  /** True when the widget is the invisible variant. */
  invisible?: boolean
  proxy?: CaptchaSolverProxy
}

export type CaptchaParams = FunCaptchaParams | RecaptchaV2Params

/** Token returned by a solver, ready to inject into the page. */
export interface SolvedToken {
  type: CheckpointType
  token: string
}

export type SolveErrorCode =
  | 'NO_API_KEY'
  | 'UNSUPPORTED_CHECKPOINT'
  | 'PARAMS_NOT_FOUND'
  | 'PROVIDER_ERROR'
  | 'SOLVE_TIMEOUT'
  | 'BUDGET_EXHAUSTED'
  | 'BREAKER_OPEN'
  | 'INJECT_FAILED'
  | 'STILL_BLOCKED'

export type SolveResult =
  | { ok: true; type: CheckpointType; provider: string; durationMs: number }
  | {
      ok: false
      type?: CheckpointType
      code: SolveErrorCode
      provider?: string
      durationMs: number
    }

export interface CaptchaSolverProxy {
  server: string
  username?: string
  password?: string
}

/**
 * A CAPTCHA-solving provider (CapSolver, 2captcha, ...). Implementations submit
 * the captcha params to an external API and return a token string.
 */
export interface CaptchaSolverClient {
  readonly name: string
  solve(params: CaptchaParams): Promise<string>
}

/**
 * Minimal page surface used by the checkpoint subsystem. Compatible with
 * Playwright's Page but kept narrow so it can be mocked in unit tests.
 */
export interface CheckpointPageLike {
  url(): string
  content(): Promise<string>
  waitForTimeout?: (ms: number) => Promise<void>
  evaluate?: <T>(fn: (token: string) => T, arg: string) => Promise<T>
}

export class CaptchaSolveError extends Error {
  constructor(
    readonly code: SolveErrorCode,
    message = code
  ) {
    super(message)
    this.name = 'CaptchaSolveError'
  }
}
