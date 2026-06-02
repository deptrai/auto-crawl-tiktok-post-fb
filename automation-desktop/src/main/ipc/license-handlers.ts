import {
  LicenseActivateRequestSchema,
  LicenseActivateResponseSchema,
  LicenseCheckRequestSchema,
  LicenseCheckResponseSchema,
  LicenseStatusRequestSchema,
  LicenseStatusResponseSchema,
  type IpcErrorResponse,
  type LicenseActivateResponse,
  type LicenseCheckResponse,
  type LicenseStatusResponse
} from '../../shared/ipc-schemas'
import type { LicenseService } from '../license/license-service'
import { LicenseServiceError } from '../license/license-service'
import type { IpcMainLike } from './settings-handlers'

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

function normalizeError(error: unknown): IpcErrorResponse {
  if (error instanceof LicenseServiceError) {
    return toErrorResponse(error.code, error.message, error.retryable, error.details)
  }
  return toErrorResponse('LICENSE_ERROR', 'Không thể xử lý license.', true, error)
}

export function registerLicenseHandlers(ipcMain: IpcMainLike, service: LicenseService): void {
  ipcMain.handle(
    'phase3:license:activate',
    async (_event, request): Promise<LicenseActivateResponse> => {
      const parsedRequest = LicenseActivateRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return LicenseActivateResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        const status = await service.activate(parsedRequest.data.key)
        return LicenseActivateResponseSchema.parse({ ok: true, status })
      } catch (error) {
        return LicenseActivateResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle(
    'phase3:license:status',
    async (_event, request): Promise<LicenseStatusResponse> => {
      const parsedRequest = LicenseStatusRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return LicenseStatusResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        const status = await service.getStatus()
        return LicenseStatusResponseSchema.parse({ ok: true, status })
      } catch (error) {
        return LicenseStatusResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle('phase3:license:check', async (_event, request): Promise<LicenseCheckResponse> => {
    const parsedRequest = LicenseCheckRequestSchema.safeParse(request)
    if (!parsedRequest.success)
      return LicenseCheckResponseSchema.parse(parseError(parsedRequest.error.flatten()))

    try {
      const status = await service.check()
      return LicenseCheckResponseSchema.parse({ ok: true, status })
    } catch (error) {
      return LicenseCheckResponseSchema.parse(normalizeError(error))
    }
  })
}
