import type { ProxyInfo, ProxyProvider } from '../../../shared/types/proxy'
import { ProxyServiceError } from '../proxy-service'

interface ProxyfbProviderOptions {
  baseUrl?: string
  timeoutMs?: number
}

interface ProxyfbResponse {
  success?: string
  proxy?: string
}

const DEFAULT_BASE_URL = 'http://api.proxyfb.com/api'
const DEFAULT_TIMEOUT_MS = 10_000

export function parseProxyString(raw: string): ProxyInfo {
  const parts = raw.split(':')
  if (parts.length !== 4 || parts.some((part) => part.trim().length === 0)) {
    throw new ProxyServiceError('PROXY_FORMAT_INVALID', 'Định dạng proxy không hợp lệ.', true)
  }

  const portRaw = parts[1].trim()
  const port = Number(portRaw)
  if (!Number.isInteger(port) || String(port) !== portRaw || port <= 0 || port >= 65536) {
    throw new ProxyServiceError('PROXY_PORT_INVALID', 'Port proxy không hợp lệ.', true)
  }

  return {
    host: parts[0].trim(),
    port,
    username: parts[2].trim(),
    password: parts[3].trim()
  }
}

export class ProxyfbProvider implements ProxyProvider {
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(options: ProxyfbProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async getProxy(key: string): Promise<ProxyInfo> {
    const changed = await this.fetchProxy('changeProxy.php', key)
    if (changed) return changed

    const current = await this.fetchProxy('getProxy.php', key)
    if (current) return current

    throw new ProxyServiceError('PROXY_UNAVAILABLE', 'Không thể lấy proxy proxyfb.', true)
  }

  private async fetchProxy(endpoint: string, key: string): Promise<ProxyInfo | null> {
    try {
      const response = await fetch(`${this.baseUrl}/${endpoint}?key=${encodeURIComponent(key)}`, {
        signal: AbortSignal.timeout(this.timeoutMs)
      })
      const body = (await response.json()) as ProxyfbResponse
      if (body.success !== 'True' || !body.proxy) return null
      return parseProxyString(body.proxy)
    } catch {
      return null
    }
  }
}
