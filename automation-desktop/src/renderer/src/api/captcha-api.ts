import type {
  CaptchaProvider,
  CaptchaSetKeyResponse,
  CaptchaStatusResponse
} from '../../../shared/ipc-schemas'
import { setSetting } from './settings-api'

const CAPTCHA_SOLVER_ENABLED_SETTING = 'captcha.solver.enabled'

function assertOk<T extends { ok: boolean; error?: { message: string } }>(
  response: T
): asserts response is T & { ok: true } {
  if (!response.ok) throw new Error(response.error?.message ?? 'IPC request failed')
}

export async function getCaptchaStatus(): Promise<{
  capsolverConfigured: boolean
  twoCaptchaConfigured: boolean
  enabled: boolean
}> {
  const response = await window.api.ipc.call<
    'phase3:captcha:status',
    Record<string, never>,
    CaptchaStatusResponse
  >('phase3:captcha:status', {})
  assertOk(response)
  return {
    capsolverConfigured: response.capsolverConfigured,
    twoCaptchaConfigured: response.twoCaptchaConfigured,
    enabled: response.enabled
  }
}

export async function setCaptchaKey(provider: CaptchaProvider, apiKey: string): Promise<void> {
  const response = await window.api.ipc.call<
    'phase3:captcha:set-key',
    { provider: CaptchaProvider; apiKey: string },
    CaptchaSetKeyResponse
  >('phase3:captcha:set-key', { provider, apiKey })
  assertOk(response)
}

export async function setCaptchaEnabled(enabled: boolean): Promise<void> {
  await setSetting(CAPTCHA_SOLVER_ENABLED_SETTING, String(enabled))
}
