import type { SecureStorage } from '../../adapters/secure-storage'
import type { ProxyRepository } from '../db/repositories/proxy-repo'
import type { ProxyInfo, ProxyProvider } from '../../shared/types/proxy'
import { CircuitBreaker, type CircuitBreakerConfig } from './circuit-breaker'

const PROXYFB_API_KEY_STORAGE_KEY = 'proxy.proxyfb.api_key'
const PROXYFB_PROVIDER = 'proxyfb'
const DEFAULT_BREAKER_CONFIG: CircuitBreakerConfig = { failureThreshold: 3, cooldownMs: 60_000 }

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

export interface ProxyHealthStatus {
  state: 'healthy' | 'quarantined'
  configured: boolean
  cooldownRemainingMs?: number
}

export interface ProxyErrorHookContext {
  provider: string
  code: string
  message: string
  retryable: boolean
}

export interface ProxyService {
  configGet(): Promise<ProxyConfigStatus>
  configSet(apiKey: string): Promise<void>
  rotate(profileId?: string): Promise<ProxyInfo>
  getHealth(): Promise<ProxyHealthStatus>
}

export interface ProxyServiceDeps {
  storage: SecureStorage
  providers: {
    proxyfb: ProxyProvider
  }
  repo: ProxyRepository
  clock?: () => number
  breakerConfig?: CircuitBreakerConfig
  onProxyError?: (ctx: ProxyErrorHookContext) => void
}

export function createProxyService(deps: ProxyServiceDeps): ProxyService {
  const { storage, providers, repo, onProxyError } = deps
  const clock = deps.clock ?? Date.now
  const breakerConfig = deps.breakerConfig ?? DEFAULT_BREAKER_CONFIG
  const breaker = new CircuitBreaker(breakerConfig, clock)

  async function isConfigured(): Promise<boolean> {
    const key = await storage.get(PROXYFB_API_KEY_STORAGE_KEY)
    return Boolean(key?.trim())
  }

  function quarantineProvider(error: ProxyServiceError): void {
    // Best-effort persist — KHÔNG để DB error che giấu lỗi proxy gốc cho caller.
    try {
      repo.upsertConfig(PROXYFB_PROVIDER, { enabled: false, lastRotatedAt: null })
    } catch {
      /* best-effort quarantine persist */
    }
    onProxyError?.({
      provider: PROXYFB_PROVIDER,
      code: error.code,
      message: error.message,
      retryable: error.retryable
    })
  }

  return {
    async configGet() {
      return { configured: await isConfigured() }
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

      if (!breaker.canRequest()) {
        throw new ProxyServiceError(
          'PROXY_QUARANTINED',
          'Proxy đang tạm ngừng do lỗi liên tục. Thử lại sau.',
          true
        )
      }

      try {
        const proxy = await providers.proxyfb.getProxy(apiKey)
        breaker.recordSuccess()
        // Best-effort persist — KHÔNG để DB error che giấu proxy đã lấy thành công.
        try {
          repo.upsertConfig(PROXYFB_PROVIDER, {
            enabled: true,
            lastRotatedAt: new Date(clock()).toISOString()
          })
        } catch {
          /* best-effort last_rotated_at persist */
        }
        return proxy
      } catch {
        breaker.recordFailure()
        const unavailable = new ProxyServiceError(
          'PROXY_UNAVAILABLE',
          'Không thể lấy proxy proxyfb.',
          true
        )
        if (breaker.getState().state === 'OPEN') quarantineProvider(unavailable)
        throw unavailable
      }
    },

    async getHealth() {
      const configured = await isConfigured()
      const state = breaker.getState()
      // OPEN = chưa xác nhận hồi phục (kể cả cooldown vừa hết) → quarantined cho tới khi
      // có trial success (breaker → CLOSED). Tránh báo "healthy" sớm tại boundary.
      if (state.state === 'OPEN' && state.openedAt !== undefined) {
        const cooldownRemainingMs = Math.max(0, state.openedAt + breakerConfig.cooldownMs - clock())
        return { state: 'quarantined', configured, cooldownRemainingMs }
      }
      return { state: 'healthy', configured }
    }
  }
}
