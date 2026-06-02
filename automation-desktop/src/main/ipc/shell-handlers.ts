import {
  ShellOpenExternalRequestSchema,
  ShellOpenExternalResponseSchema,
  type IpcErrorResponse,
  type ShellOpenExternalResponse
} from '../../shared/ipc-schemas'
import type { IpcMainLike } from './settings-handlers'

export type OpenExternal = (url: string) => Promise<void> | void

function toErrorResponse(
  code: string,
  message: string,
  details?: unknown,
  retryable = false
): IpcErrorResponse {
  return { ok: false, error: { code, message, retryable, details } }
}

export function registerShellHandlers(ipcMain: IpcMainLike, openExternal: OpenExternal): void {
  ipcMain.handle(
    'phase3:shell:open-external',
    async (_event, request): Promise<ShellOpenExternalResponse> => {
      const parsedRequest = ShellOpenExternalRequestSchema.safeParse(request)
      if (!parsedRequest.success) {
        return ShellOpenExternalResponseSchema.parse(
          toErrorResponse(
            'VALIDATION_ERROR',
            'Dữ liệu URL không hợp lệ',
            parsedRequest.error.flatten()
          )
        )
      }

      try {
        await openExternal(parsedRequest.data.url)
        return ShellOpenExternalResponseSchema.parse({ ok: true })
      } catch (error) {
        return ShellOpenExternalResponseSchema.parse(
          toErrorResponse('OPEN_EXTERNAL_FAILED', 'Không thể mở liên kết', error)
        )
      }
    }
  )
}
