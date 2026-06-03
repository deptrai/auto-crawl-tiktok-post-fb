import type { ProxyInfo } from '../../shared/types/proxy'
import { ProxyServiceError, type ProxyService } from './proxy-service'

const DEFAULT_MAX_ATTEMPTS = 5

export interface PlaywrightProxyConfig {
  server: string
  username: string
  password: string
}

export interface ProxyAssignmentSummary {
  profileId: string
  host: string
  port: number
}

export interface ProxyPool {
  acquire(profileId: string): Promise<ProxyInfo>
  release(profileId: string): void
  getProxyFor(profileId: string): ProxyInfo | undefined
  listAssignments(): ProxyAssignmentSummary[]
}

export interface ProxyPoolDeps {
  proxyService: Pick<ProxyService, 'rotate'>
  maxAttempts?: number
}

function proxyKey(proxy: ProxyInfo): string {
  return `${proxy.host}:${proxy.port}`
}

function normalizeMaxAttempts(maxAttempts?: number): number {
  if (maxAttempts === undefined) return DEFAULT_MAX_ATTEMPTS
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) return DEFAULT_MAX_ATTEMPTS
  return maxAttempts
}

export function toPlaywrightProxy(proxy: ProxyInfo): PlaywrightProxyConfig {
  return {
    server: `http://${proxy.host}:${proxy.port}`,
    username: proxy.username,
    password: proxy.password
  }
}

export function createProxyPool(deps: ProxyPoolDeps): ProxyPool {
  const maxAttempts = normalizeMaxAttempts(deps.maxAttempts)
  const assignments = new Map<string, ProxyInfo>()
  const activeKeys = new Set<string>()
  let acquireChain: Promise<unknown> = Promise.resolve()

  async function acquireLocked(profileId: string): Promise<ProxyInfo> {
    const existing = assignments.get(profileId)
    if (existing) return existing

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = await deps.proxyService.rotate(profileId)
      const key = proxyKey(candidate)
      if (activeKeys.has(key)) continue

      assignments.set(profileId, candidate)
      activeKeys.add(key)
      return candidate
    }

    throw new ProxyServiceError(
      'PROXY_POOL_EXHAUSTED',
      'Không cấp được proxy duy nhất cho profile.',
      true
    )
  }

  function enqueueAcquire(profileId: string): Promise<ProxyInfo> {
    const result = acquireChain.then(() => acquireLocked(profileId))
    acquireChain = result.catch(() => undefined)
    return result
  }

  return {
    acquire(profileId) {
      return enqueueAcquire(profileId)
    },

    release(profileId) {
      const existing = assignments.get(profileId)
      if (!existing) return
      assignments.delete(profileId)
      activeKeys.delete(proxyKey(existing))
    },

    getProxyFor(profileId) {
      return assignments.get(profileId)
    },

    listAssignments() {
      return Array.from(assignments.entries()).map(([profileId, proxy]) => ({
        profileId,
        host: proxy.host,
        port: proxy.port
      }))
    }
  }
}
