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

function toErrorResponse(code: string, message: string, details?: unknown): IpcErrorResponse {
  return { ok: false, error: { code, message, details } }
}

function parseError(details: unknown): IpcErrorResponse {
  return toErrorResponse('VALIDATION_ERROR', 'Invalid IPC payload', details)
}

export function registerSettingsHandlers(ipcMain: IpcMainLike, repo: SettingsRepository): void {
  ipcMain.handle('phase3:settings:get', (_event, request): SettingsGetResponse => {
    const parsedRequest = SettingsGetRequestSchema.safeParse(request)
    if (!parsedRequest.success)
      return SettingsGetResponseSchema.parse(parseError(parsedRequest.error.flatten()))

    try {
      return SettingsGetResponseSchema.parse({
        ok: true,
        value: repo.getSetting(parsedRequest.data.key)
      })
    } catch (error) {
      return SettingsGetResponseSchema.parse(
        toErrorResponse('SETTINGS_GET_FAILED', 'Unable to read local setting', error)
      )
    }
  })

  ipcMain.handle('phase3:settings:set', (_event, request): SettingsSetResponse => {
    const parsedRequest = SettingsSetRequestSchema.safeParse(request)
    if (!parsedRequest.success)
      return SettingsSetResponseSchema.parse(parseError(parsedRequest.error.flatten()))

    try {
      repo.setSetting(parsedRequest.data.key, parsedRequest.data.value)
      return SettingsSetResponseSchema.parse({ ok: true })
    } catch (error) {
      return SettingsSetResponseSchema.parse(
        toErrorResponse('SETTINGS_SET_FAILED', 'Unable to write local setting', error)
      )
    }
  })
}
