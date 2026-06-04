import {
  TargetListCreateRequestSchema,
  TargetListCreateResponseSchema,
  TargetListDeleteRequestSchema,
  TargetListDeleteResponseSchema,
  TargetListEntriesRequestSchema,
  TargetListEntriesResponseSchema,
  TargetListImportRequestSchema,
  TargetListImportResponseSchema,
  TargetListListRequestSchema,
  TargetListListResponseSchema,
  type IpcErrorResponse,
  type TargetListCreateResponse,
  type TargetListDeleteResponse,
  type TargetListEntriesResponse,
  type TargetListImportResponse,
  type TargetListListResponse
} from '../../shared/ipc-schemas'
import type { TargetListRepository } from '../db/repositories/target-list-repo'
import type { IpcMainLike } from './settings-handlers'

function toErrorResponse(
  code: string,
  message: string,
  retryable = false,
  details?: unknown
): IpcErrorResponse {
  return { ok: false, error: { code, message, retryable, details } }
}

function parseError(): IpcErrorResponse {
  return toErrorResponse('VALIDATION_ERROR', 'Dữ liệu yêu cầu không hợp lệ', false)
}

function missingList(): IpcErrorResponse {
  return toErrorResponse('TARGET_LIST_NOT_FOUND', 'Không tìm thấy danh sách target.', false)
}

function normalizeError(error: unknown): IpcErrorResponse {
  void error
  return toErrorResponse('TARGET_LIST_ERROR', 'Không thể xử lý danh sách target.', false)
}

export function registerTargetListHandlers(
  ipcMain: IpcMainLike,
  repo: TargetListRepository,
  now: () => string = () => new Date().toISOString()
): void {
  ipcMain.handle(
    'phase3:target-list:list',
    async (_event, request): Promise<TargetListListResponse> => {
      const parsedRequest = TargetListListRequestSchema.safeParse(request)
      if (!parsedRequest.success) return TargetListListResponseSchema.parse(parseError())

      try {
        return TargetListListResponseSchema.parse({ ok: true, lists: repo.listLists() })
      } catch (error) {
        return TargetListListResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle(
    'phase3:target-list:create',
    async (_event, request): Promise<TargetListCreateResponse> => {
      const parsedRequest = TargetListCreateRequestSchema.safeParse(request)
      if (!parsedRequest.success) return TargetListCreateResponseSchema.parse(parseError())

      try {
        return TargetListCreateResponseSchema.parse({
          ok: true,
          list: repo.createList({ label: parsedRequest.data.label, createdAt: now() })
        })
      } catch (error) {
        return TargetListCreateResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle(
    'phase3:target-list:delete',
    async (_event, request): Promise<TargetListDeleteResponse> => {
      const parsedRequest = TargetListDeleteRequestSchema.safeParse(request)
      if (!parsedRequest.success) return TargetListDeleteResponseSchema.parse(parseError())

      try {
        const changes = repo.deleteList(parsedRequest.data.id)
        if (changes === 0) return TargetListDeleteResponseSchema.parse(missingList())
        return TargetListDeleteResponseSchema.parse({ ok: true })
      } catch (error) {
        return TargetListDeleteResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle(
    'phase3:target-list:entries',
    async (_event, request): Promise<TargetListEntriesResponse> => {
      const parsedRequest = TargetListEntriesRequestSchema.safeParse(request)
      if (!parsedRequest.success) return TargetListEntriesResponseSchema.parse(parseError())

      try {
        if (!repo.listExists(parsedRequest.data.listId)) {
          return TargetListEntriesResponseSchema.parse(missingList())
        }
        return TargetListEntriesResponseSchema.parse({
          ok: true,
          entries: repo.listEntries(parsedRequest.data)
        })
      } catch (error) {
        return TargetListEntriesResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle(
    'phase3:target-list:import',
    async (_event, request): Promise<TargetListImportResponse> => {
      const parsedRequest = TargetListImportRequestSchema.safeParse(request)
      if (!parsedRequest.success) return TargetListImportResponseSchema.parse(parseError())

      try {
        if (!repo.listExists(parsedRequest.data.listId)) {
          return TargetListImportResponseSchema.parse(missingList())
        }
        return TargetListImportResponseSchema.parse({
          ok: true,
          result: repo.importEntries({
            listId: parsedRequest.data.listId,
            entries: parsedRequest.data.entries,
            createdAt: now()
          })
        })
      } catch (error) {
        return TargetListImportResponseSchema.parse(normalizeError(error))
      }
    }
  )
}
