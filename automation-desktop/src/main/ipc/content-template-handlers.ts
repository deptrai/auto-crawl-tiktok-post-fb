import {
  ContentTemplateCreateRequestSchema,
  ContentTemplateCreateResponseSchema,
  ContentTemplateDeleteRequestSchema,
  ContentTemplateDeleteResponseSchema,
  ContentTemplateListRequestSchema,
  ContentTemplateListResponseSchema,
  ContentTemplateUpdateRequestSchema,
  ContentTemplateUpdateResponseSchema,
  type ContentTemplateCreateResponse,
  type ContentTemplateDeleteResponse,
  type ContentTemplateListResponse,
  type ContentTemplateUpdateResponse,
  type IpcErrorResponse
} from '../../shared/ipc-schemas'
import type { ContentTemplateRepository } from '../db/repositories/content-template-repo'
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
  void error
  return toErrorResponse('CONTENT_TEMPLATE_ERROR', 'Không thể xử lý template bình luận.', false)
}

export function registerContentTemplateHandlers(
  ipcMain: IpcMainLike,
  repo: ContentTemplateRepository,
  now: () => string = () => new Date().toISOString()
): void {
  ipcMain.handle(
    'phase3:content-template:list',
    async (_event, request): Promise<ContentTemplateListResponse> => {
      const parsedRequest = ContentTemplateListRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return ContentTemplateListResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        return ContentTemplateListResponseSchema.parse({
          ok: true,
          templates: repo.listTemplates()
        })
      } catch (error) {
        return ContentTemplateListResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle(
    'phase3:content-template:create',
    async (_event, request): Promise<ContentTemplateCreateResponse> => {
      const parsedRequest = ContentTemplateCreateRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return ContentTemplateCreateResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        const template = repo.createTemplate({ ...parsedRequest.data, createdAt: now() })
        return ContentTemplateCreateResponseSchema.parse({ ok: true, template })
      } catch (error) {
        return ContentTemplateCreateResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle(
    'phase3:content-template:update',
    async (_event, request): Promise<ContentTemplateUpdateResponse> => {
      const parsedRequest = ContentTemplateUpdateRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return ContentTemplateUpdateResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        const template = repo.updateTemplate(parsedRequest.data)
        if (!template) {
          return ContentTemplateUpdateResponseSchema.parse(
            toErrorResponse('CONTENT_TEMPLATE_NOT_FOUND', 'Không tìm thấy template.', false)
          )
        }
        return ContentTemplateUpdateResponseSchema.parse({ ok: true, template })
      } catch (error) {
        return ContentTemplateUpdateResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle(
    'phase3:content-template:delete',
    async (_event, request): Promise<ContentTemplateDeleteResponse> => {
      const parsedRequest = ContentTemplateDeleteRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return ContentTemplateDeleteResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        if (repo.countTemplates() <= 1) {
          return ContentTemplateDeleteResponseSchema.parse(
            toErrorResponse(
              'CONTENT_TEMPLATE_LAST_REQUIRED',
              'Cần ít nhất 1 template để chạy self-comment.',
              false
            )
          )
        }
        const changes = repo.deleteTemplate(parsedRequest.data.id)
        if (changes === 0) {
          return ContentTemplateDeleteResponseSchema.parse(
            toErrorResponse('CONTENT_TEMPLATE_NOT_FOUND', 'Không tìm thấy template.', false)
          )
        }
        return ContentTemplateDeleteResponseSchema.parse({ ok: true })
      } catch (error) {
        return ContentTemplateDeleteResponseSchema.parse(normalizeError(error))
      }
    }
  )
}
