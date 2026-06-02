import type { SettingsRepository } from '../db/repositories/settings-repo'
import {
  SettingsGetRequestSchema,
  SettingsGetResponseSchema,
  SettingsSetRequestSchema,
  SettingsSetResponseSchema,
  type IpcErrorResponse,
  type SettingsGetResponse,
  type SettingsSetResponse
} from '../../shared/ipc-schemas'

export interface IpcMainLike {
  handle(channel: string, listener: (_event: unknown, request: unknown) => unknown): void
}

function toErrorResponse(
  code: string,
  message: string,
  details?: unknown,
  retryable = false
): IpcErrorResponse {
  return { ok: false, error: { code, message, retryable, details } }
}

function parseError(details: unknown): IpcErrorResponse {
  return toErrorResponse('VALIDATION_ERROR', 'Dữ liệu yêu cầu không hợp lệ', details)
}

export function registerSettingsHandlers(ipcMain: IpcMainLike, repo: SettingsRepository): void {
  ipcMain.handle('phase3:settings:get', (_event, request): SettingsGetResponse => {
    const parsedRequest = SettingsGetRequestSchema.safeParse(request)
    if (!parsedRequest.success)
      return parseError(parsedRequest.error.flatten()) as SettingsGetResponse

    try {
      return SettingsGetResponseSchema.parse({
        ok: true,
        value: repo.getSetting(parsedRequest.data.key)
      })
    } catch (error) {
      return SettingsGetResponseSchema.parse(
        toErrorResponse('SETTINGS_GET_FAILED', 'Không thể đọc cài đặt cục bộ', error, true)
      )
    }
  })

  ipcMain.handle('phase3:settings:set', (_event, request): SettingsSetResponse => {
    const parsedRequest = SettingsSetRequestSchema.safeParse(request)
    if (!parsedRequest.success)
      return parseError(parsedRequest.error.flatten()) as SettingsSetResponse

    try {
      repo.setSetting(parsedRequest.data.key, parsedRequest.data.value)
      return SettingsSetResponseSchema.parse({ ok: true })
    } catch (error) {
      return SettingsSetResponseSchema.parse(
        toErrorResponse('SETTINGS_SET_FAILED', 'Không thể ghi cài đặt cục bộ', error, true)
      )
    }
  })
}
