import {
  ProfileImportBulkRequestSchema,
  ProfileImportBulkResponseSchema,
  ProfileListRequestSchema,
  ProfileListResponseSchema,
  type IpcErrorResponse,
  type ProfileImportBulkResponse,
  type ProfileListResponse
} from '../../shared/ipc-schemas'
import type { ProfileService } from '../profile/profile-service'
import { ProfileServiceError } from '../profile/profile-service'
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
  if (error instanceof ProfileServiceError) {
    return toErrorResponse(error.code, error.message, error.retryable)
  }
  return toErrorResponse('PROFILE_ERROR', 'Không thể xử lý profile.', false)
}

export function registerProfileHandlers(ipcMain: IpcMainLike, service: ProfileService): void {
  ipcMain.handle(
    'phase3:profile:import-bulk',
    async (_event, request): Promise<ProfileImportBulkResponse> => {
      const parsedRequest = ProfileImportBulkRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return ProfileImportBulkResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        const result = await service.importBulk(parsedRequest.data.text)
        return ProfileImportBulkResponseSchema.parse({ ok: true, result })
      } catch (error) {
        return ProfileImportBulkResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle('phase3:profile:list', async (_event, request): Promise<ProfileListResponse> => {
    const parsedRequest = ProfileListRequestSchema.safeParse(request)
    if (!parsedRequest.success)
      return ProfileListResponseSchema.parse(parseError(parsedRequest.error.flatten()))

    try {
      return ProfileListResponseSchema.parse({ ok: true, profiles: service.listProfiles() })
    } catch (error) {
      return ProfileListResponseSchema.parse(normalizeError(error))
    }
  })
}
