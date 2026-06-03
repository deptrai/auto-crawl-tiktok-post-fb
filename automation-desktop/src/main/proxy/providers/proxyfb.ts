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
  if (parts.length < 4) {
    throw new ProxyServiceError('PROXY_FORMAT_INVALID', 'Định dạng proxy không hợp lệ.', false)
  }
  const hasControlChars = (s: string): boolean =>
    [...s].some((char) => {
      const code = char.charCodeAt(0)
      return code <= 0x1f || code === 0x7f
    })
  const rawHost = parts[0]
  const rawUsername = parts[2]
  const rawPassword = parts.slice(3).join(':')
  if (hasControlChars(rawHost) || hasControlChars(rawUsername) || hasControlChars(rawPassword)) {
    throw new ProxyServiceError('PROXY_FORMAT_INVALID', 'Định dạng proxy không hợp lệ.', false)
  }

  const host = rawHost.trim()
  const portRaw = parts[1].trim()
  const username = rawUsername.trim()
  const password = rawPassword.trim()

  if (
    !host ||
    !username ||
    !password ||
    hasControlChars(host) ||
    hasControlChars(username) ||
    hasControlChars(password)
  ) {
    throw new ProxyServiceError('PROXY_FORMAT_INVALID', 'Định dạng proxy không hợp lệ.', false)
  }

  const port = Number(portRaw)
  if (!Number.isInteger(port) || String(port) !== portRaw || port <= 0 || port >= 65536) {
    throw new ProxyServiceError('PROXY_PORT_INVALID', 'Port proxy không hợp lệ.', false)
  }

  return { host, port, username, password }
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
      if (!response.ok) return null
      const body = (await response.json()) as ProxyfbResponse
      if (body.success !== 'True' || !body.proxy) return null
      return parseProxyString(body.proxy)
    } catch {
      return null
    }
  }
}
