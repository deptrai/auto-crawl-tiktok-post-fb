import {
  ProxyConfigGetRequestSchema,
  ProxyConfigGetResponseSchema,
  ProxyConfigSetRequestSchema,
  ProxyConfigSetResponseSchema,
  ProxyHealthRequestSchema,
  ProxyHealthResponseSchema,
  ProxyPoolAcquireRequestSchema,
  ProxyPoolAcquireResponseSchema,
  ProxyPoolListRequestSchema,
  ProxyPoolListResponseSchema,
  ProxyPoolReleaseRequestSchema,
  ProxyPoolReleaseResponseSchema,
  ProxyRotateRequestSchema,
  ProxyRotateResponseSchema,
  type IpcErrorResponse,
  type ProxyConfigGetResponse,
  type ProxyConfigSetResponse,
  type ProxyHealthResponse,
  type ProxyPoolAcquireResponse,
  type ProxyPoolListResponse,
  type ProxyPoolReleaseResponse,
  type ProxyRotateResponse
} from '../../shared/ipc-schemas'
import { ProxyServiceError, type ProxyPool, type ProxyService } from '../proxy'
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

export function registerProxyHandlers(
  ipcMain: IpcMainLike,
  service: ProxyService,
  proxyPool?: ProxyPool,
  // Optional app-level invariant check: profileId must reference a real profile.
  // Kept at the IPC boundary so the pool stays pure infra (no DB coupling).
  profileExists?: (profileId: string) => boolean
): void {
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

  ipcMain.handle(
    'phase3:proxy-pool:acquire',
    async (_event, request): Promise<ProxyPoolAcquireResponse> => {
      const parsedRequest = ProxyPoolAcquireRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return ProxyPoolAcquireResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      if (!proxyPool) {
        return ProxyPoolAcquireResponseSchema.parse(
          toErrorResponse('PROXY_POOL_UNAVAILABLE', 'Proxy pool chưa sẵn sàng.', true)
        )
      }

      // Guard against draining provider quota for non-existent profile ids.
      if (profileExists && !profileExists(parsedRequest.data.profileId)) {
        return ProxyPoolAcquireResponseSchema.parse(
          toErrorResponse('PROFILE_NOT_FOUND', 'Không tìm thấy profile để gán proxy.', false)
        )
      }

      try {
        const proxy = await proxyPool.acquire(parsedRequest.data.profileId)
        return ProxyPoolAcquireResponseSchema.parse({
          ok: true,
          assignment: {
            profileId: parsedRequest.data.profileId,
            host: proxy.host,
            port: proxy.port
          }
        })
      } catch (error) {
        return ProxyPoolAcquireResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle(
    'phase3:proxy-pool:release',
    async (_event, request): Promise<ProxyPoolReleaseResponse> => {
      const parsedRequest = ProxyPoolReleaseRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return ProxyPoolReleaseResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      if (!proxyPool) {
        return ProxyPoolReleaseResponseSchema.parse(
          toErrorResponse('PROXY_POOL_UNAVAILABLE', 'Proxy pool chưa sẵn sàng.', true)
        )
      }

      proxyPool.release(parsedRequest.data.profileId)
      return ProxyPoolReleaseResponseSchema.parse({ ok: true })
    }
  )

  ipcMain.handle(
    'phase3:proxy-pool:list',
    async (_event, request): Promise<ProxyPoolListResponse> => {
      const parsedRequest = ProxyPoolListRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return ProxyPoolListResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      if (!proxyPool) {
        return ProxyPoolListResponseSchema.parse(
          toErrorResponse('PROXY_POOL_UNAVAILABLE', 'Proxy pool chưa sẵn sàng.', true)
        )
      }

      return ProxyPoolListResponseSchema.parse({
        ok: true,
        assignments: proxyPool.listAssignments()
      })
    }
  )
}
