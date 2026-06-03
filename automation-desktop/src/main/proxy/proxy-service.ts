import type { SecureStorage } from '../../adapters/secure-storage'
import type { ProxyInfo, ProxyProvider } from '../../shared/types/proxy'

const PROXYFB_API_KEY_STORAGE_KEY = 'proxy.proxyfb.api_key'

export class ProxyServiceError extends Error {
  code: string
  retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.name = 'ProxyServiceError'
    this.code = code
    this.retryable = retryable
  }
}

export interface ProxyConfigStatus {
  configured: boolean
}

export interface ProxyService {
  configGet(): Promise<ProxyConfigStatus>
  configSet(apiKey: string): Promise<void>
  rotate(profileId?: string): Promise<ProxyInfo>
}

export interface ProxyServiceDeps {
  storage: SecureStorage
  providers: {
    proxyfb: ProxyProvider
  }
}

export function createProxyService(deps: ProxyServiceDeps): ProxyService {
  const { storage, providers } = deps

  return {
    async configGet() {
      const key = await storage.get(PROXYFB_API_KEY_STORAGE_KEY)
      return { configured: Boolean(key?.trim()) }
    },

    async configSet(apiKey) {
      const trimmed = apiKey.trim()
      if (!trimmed) {
        throw new ProxyServiceError('PROXY_CONFIG_INVALID', 'API key proxyfb không hợp lệ.', false)
      }
      await storage.set(PROXYFB_API_KEY_STORAGE_KEY, trimmed)
    },

    async rotate() {
      const apiKey = (await storage.get(PROXYFB_API_KEY_STORAGE_KEY))?.trim()
      if (!apiKey) {
        throw new ProxyServiceError('PROXY_NOT_CONFIGURED', 'Chưa cấu hình API key proxyfb.', false)
      }

      try {
        return await providers.proxyfb.getProxy(apiKey)
      } catch (error) {
        if (error instanceof ProxyServiceError) throw error
        throw new ProxyServiceError('PROXY_UNAVAILABLE', 'Không thể lấy proxy proxyfb.', true)
      }
    }
  }
}
