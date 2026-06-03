import {
  ProxyConfigGetRequestSchema,
  ProxyConfigGetResponseSchema,
  ProxyConfigSetRequestSchema,
  ProxyConfigSetResponseSchema,
  ProxyHealthRequestSchema,
  ProxyHealthResponseSchema,
  ProxyRotateRequestSchema,
  ProxyRotateResponseSchema,
  type IpcErrorResponse,
  type ProxyConfigGetResponse,
  type ProxyConfigSetResponse,
  type ProxyHealthResponse,
  type ProxyRotateResponse
} from '../../shared/ipc-schemas'
import { ProxyServiceError, type ProxyService } from '../proxy'
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
  if (error instanceof ProxyServiceError) {
    return toErrorResponse(error.code, error.message, error.retryable)
  }
  return toErrorResponse('PROXY_ERROR', 'Không thể xử lý proxy.', false)
}

export function registerProxyHandlers(ipcMain: IpcMainLike, service: ProxyService): void {
  ipcMain.handle(
    'phase3:proxy:config-get',
    async (_event, request): Promise<ProxyConfigGetResponse> => {
      const parsedRequest = ProxyConfigGetRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return ProxyConfigGetResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        const status = await service.configGet()
        return ProxyConfigGetResponseSchema.parse({ ok: true, configured: status.configured })
      } catch (error) {
        return ProxyConfigGetResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle(
    'phase3:proxy:config-set',
    async (_event, request): Promise<ProxyConfigSetResponse> => {
      const parsedRequest = ProxyConfigSetRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return ProxyConfigSetResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        await service.configSet(parsedRequest.data.apiKey)
        return ProxyConfigSetResponseSchema.parse({ ok: true })
      } catch (error) {
        return ProxyConfigSetResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle('phase3:proxy:rotate', async (_event, request): Promise<ProxyRotateResponse> => {
    const parsedRequest = ProxyRotateRequestSchema.safeParse(request)
    if (!parsedRequest.success)
      return ProxyRotateResponseSchema.parse(parseError(parsedRequest.error.flatten()))

    try {
      const proxy = await service.rotate(parsedRequest.data.profileId)
      return ProxyRotateResponseSchema.parse({
        ok: true,
        proxy: { host: proxy.host, port: proxy.port }
      })
    } catch (error) {
      return ProxyRotateResponseSchema.parse(normalizeError(error))
    }
  })

  ipcMain.handle('phase3:proxy:health', async (_event, request): Promise<ProxyHealthResponse> => {
    const parsedRequest = ProxyHealthRequestSchema.safeParse(request)
    if (!parsedRequest.success)
      return ProxyHealthResponseSchema.parse(parseError(parsedRequest.error.flatten()))

    try {
      const health = await service.getHealth()
      return ProxyHealthResponseSchema.parse({ ok: true, health })
    } catch (error) {
      return ProxyHealthResponseSchema.parse(normalizeError(error))
    }
  })
}
