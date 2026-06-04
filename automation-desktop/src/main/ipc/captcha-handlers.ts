import type { SecureStorage } from '../../adapters/secure-storage'
import type { SettingsRepository } from '../db/repositories/settings-repo'
import {
  CaptchaSetKeyRequestSchema,
  CaptchaSetKeyResponseSchema,
  CaptchaStatusRequestSchema,
  CaptchaStatusResponseSchema,
  type CaptchaProvider,
  type CaptchaSetKeyResponse,
  type CaptchaStatusResponse,
  type IpcErrorResponse
} from '../../shared/ipc-schemas'
import type { IpcMainLike } from './settings-handlers'

const CAPTCHA_SOLVER_ENABLED_SETTING = 'captcha.solver.enabled'
const CAPTCHA_CAPSOLVER_KEY = 'captcha.capsolver.api_key'
const CAPTCHA_TWO_CAPTCHA_KEY = 'captcha.2captcha.api_key'

interface CaptchaHandlerDeps {
  storage: Pick<SecureStorage, 'get' | 'set'>
  settings: Pick<SettingsRepository, 'getSetting' | 'setSetting'>
}

function toErrorResponse(
  code: string,
  message: string,
  retryable = false,
  details?: unknown
): IpcErrorResponse {
  return { ok: false, error: { code, message, retryable, details } }
}

function parseError(details: unknown): IpcErrorResponse {
  return toErrorResponse('VALIDATION_ERROR', 'Dữ liệu yêu cầu không hợp lệ', false, details)
}

function storageKeyForProvider(provider: CaptchaProvider): string {
  return provider === 'capsolver' ? CAPTCHA_CAPSOLVER_KEY : CAPTCHA_TWO_CAPTCHA_KEY
}

export function registerCaptchaHandlers(ipcMain: IpcMainLike, deps: CaptchaHandlerDeps): void {
  ipcMain.handle(
    'phase3:captcha:set-key',
    async (_event, request): Promise<CaptchaSetKeyResponse> => {
      const parsedRequest = CaptchaSetKeyRequestSchema.safeParse(request)
      if (!parsedRequest.success) {
        return CaptchaSetKeyResponseSchema.parse(parseError(parsedRequest.error.flatten()))
      }

      try {
        await deps.storage.set(
          storageKeyForProvider(parsedRequest.data.provider),
          parsedRequest.data.apiKey
        )
        return CaptchaSetKeyResponseSchema.parse({ ok: true })
      } catch {
        return CaptchaSetKeyResponseSchema.parse(
          toErrorResponse('CAPTCHA_KEY_SAVE_FAILED', 'Không thể lưu API key CAPTCHA.', true)
        )
      }
    }
  )

  ipcMain.handle(
    'phase3:captcha:status',
    async (_event, request): Promise<CaptchaStatusResponse> => {
      const parsedRequest = CaptchaStatusRequestSchema.safeParse(request)
      if (!parsedRequest.success) {
        return CaptchaStatusResponseSchema.parse(parseError(parsedRequest.error.flatten()))
      }

      try {
        const [capsolverKey, twoCaptchaKey] = await Promise.all([
          deps.storage.get(CAPTCHA_CAPSOLVER_KEY),
          deps.storage.get(CAPTCHA_TWO_CAPTCHA_KEY)
        ])
        return CaptchaStatusResponseSchema.parse({
          ok: true,
          capsolverConfigured: Boolean(capsolverKey?.trim()),
          twoCaptchaConfigured: Boolean(twoCaptchaKey?.trim()),
          enabled: deps.settings.getSetting(CAPTCHA_SOLVER_ENABLED_SETTING) === 'true'
        })
      } catch {
        return CaptchaStatusResponseSchema.parse(
          toErrorResponse('CAPTCHA_STATUS_FAILED', 'Không thể đọc trạng thái CAPTCHA solver.', true)
        )
      }
    }
  )
}
