import {
  ProfileImportBulkRequestSchema,
  ProfileImportBulkResponseSchema,
  ProfileDeleteRequestSchema,
  ProfileDeleteResponseSchema,
  ProfileListRequestSchema,
  ProfileListResponseSchema,
  ProfileUpdateRequestSchema,
  ProfileUpdateResponseSchema,
  type IpcErrorResponse,
  type ProfileDeleteResponse,
  type ProfileImportBulkResponse,
  type ProfileListResponse,
  type ProfileUpdateResponse
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

  ipcMain.handle(
    'phase3:profile:update',
    async (_event, request): Promise<ProfileUpdateResponse> => {
      const parsedRequest = ProfileUpdateRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return ProfileUpdateResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        const { id, displayName } = parsedRequest.data
        const profile = service.updateProfile(id, { displayName })
        return ProfileUpdateResponseSchema.parse({ ok: true, profile })
      } catch (error) {
        return ProfileUpdateResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle(
    'phase3:profile:delete',
    async (_event, request): Promise<ProfileDeleteResponse> => {
      const parsedRequest = ProfileDeleteRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return ProfileDeleteResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        await service.deleteProfile(parsedRequest.data.id)
        return ProfileDeleteResponseSchema.parse({ ok: true })
      } catch (error) {
        return ProfileDeleteResponseSchema.parse(normalizeError(error))
      }
    }
  )
}
