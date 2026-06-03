import { test, expect } from '@playwright/test'
import type { SecureStorage } from '../../src/adapters/secure-storage'
import type {
  ProxyRepository,
  UpsertProxyConfigParams
} from '../../src/main/db/repositories/proxy-repo'
import type { ProxyProvider } from '../../src/shared/types/proxy'
import { createProxyService, ProxyServiceError } from '../../src/main/proxy'

function createMemoryStorage(log: string[] = []): SecureStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      log.push(`set:${key}:${value}`)
      data.set(key, value)
    },
    delete: async (key) => {
      log.push(`delete:${key}`)
      data.delete(key)
    }
  }
}

function createProvider(): ProxyProvider & { keys: string[] } {
  const keys: string[] = []
  return {
    keys,
    getProxy: async (key) => {
      keys.push(key)
      return { host: '1.2.3.4', port: 8080, username: 'user', password: 'pass' }
    }
  }
}

function createProxyRepo(): ProxyRepository & { writes: Array<UpsertProxyConfigParams> } {
  const writes: Array<UpsertProxyConfigParams> = []
  return {
    writes,
    getConfig: () => undefined,
    upsertConfig: (_provider, params) => {
      writes.push(params)
    }
  }
}

test('[P0] proxy service configGet returns configured=false without exposing api key', async () => {
  const storage = createMemoryStorage()
  const service = createProxyService({
    storage,
    providers: { proxyfb: createProvider() },
    repo: createProxyRepo()
  })

  await expect(service.configGet()).resolves.toEqual({ configured: false })
})

test('[P1] proxy service health reports unconfigured state without touching provider', async () => {
  const storage = createMemoryStorage()
  const provider = createProvider()
  const service = createProxyService({
    storage,
    providers: { proxyfb: provider },
    repo: createProxyRepo()
  })

  await expect(service.getHealth()).resolves.toEqual({ state: 'healthy', configured: false })
  expect(provider.keys).toEqual([])
})

test('[P0] proxy service configSet stores trimmed api key in safeStorage only', async () => {
  const log: string[] = []
  const storage = createMemoryStorage(log)
  const service = createProxyService({
    storage,
    providers: { proxyfb: createProvider() },
    repo: createProxyRepo()
  })

  await service.configSet('  KEY-123  ')

  expect(await storage.get('proxy.proxyfb.api_key')).toBe('KEY-123')
  expect(log).toEqual(['set:proxy.proxyfb.api_key:KEY-123'])
  await expect(service.configGet()).resolves.toEqual({ configured: true })
})

test('[P1] proxy service configSet rejects empty api key', async () => {
  const storage = createMemoryStorage()
  const service = createProxyService({
    storage,
    providers: { proxyfb: createProvider() },
    repo: createProxyRepo()
  })

  await expect(service.configSet('   ')).rejects.toMatchObject({
    code: 'PROXY_CONFIG_INVALID',
    retryable: false
  } satisfies Partial<ProxyServiceError>)
})

test('[P0] proxy service rotate uses stored key and returns full ProxyInfo for main process', async () => {
  const storage = createMemoryStorage()
  const provider = createProvider()
  const repo = createProxyRepo()
  storage.data.set('proxy.proxyfb.api_key', 'KEY-123')
  const service = createProxyService({
    storage,
    providers: { proxyfb: provider },
    repo,
    clock: () => Date.UTC(2026, 5, 3, 0, 0, 0)
  })

  const proxy = await service.rotate('profile-1')

  expect(proxy).toEqual({ host: '1.2.3.4', port: 8080, username: 'user', password: 'pass' })
  expect(provider.keys).toEqual(['KEY-123'])
  expect(repo.writes).toEqual([{ enabled: true, lastRotatedAt: '2026-06-03T00:00:00.000Z' }])
})

test('[P0] proxy service rotate throws PROXY_NOT_CONFIGURED when key is missing', async () => {
  const storage = createMemoryStorage()
  const service = createProxyService({
    storage,
    providers: { proxyfb: createProvider() },
    repo: createProxyRepo()
  })

  await expect(service.rotate()).rejects.toMatchObject({
    code: 'PROXY_NOT_CONFIGURED',
    retryable: false
  } satisfies Partial<ProxyServiceError>)
})

test('[P0] proxy service rotate maps provider failures to retryable PROXY_UNAVAILABLE', async () => {
  const storage = createMemoryStorage()
  storage.data.set('proxy.proxyfb.api_key', 'KEY-123')
  const failingProvider: ProxyProvider = {
    getProxy: async () => {
      throw new Error('network details')
    }
  }
  const service = createProxyService({
    storage,
    providers: { proxyfb: failingProvider },
    repo: createProxyRepo()
  })

  await expect(service.rotate()).rejects.toMatchObject({
    code: 'PROXY_UNAVAILABLE',
    retryable: true
  } satisfies Partial<ProxyServiceError>)
})

test('[P0] proxy service opens quarantine after threshold failures and blocks provider calls during cooldown', async () => {
  let now = Date.UTC(2026, 5, 3, 0, 0, 0)
  const storage = createMemoryStorage()
  storage.data.set('proxy.proxyfb.api_key', 'KEY-123')
  const repo = createProxyRepo()
  const proxyErrors: Array<{ provider: string; code: string }> = []
  let providerCalls = 0
  const failingProvider: ProxyProvider = {
    getProxy: async () => {
      providerCalls += 1
      throw new Error('proxyfb down')
    }
  }
  const service = createProxyService({
    storage,
    providers: { proxyfb: failingProvider },
    repo,
    clock: () => now,
    breakerConfig: { failureThreshold: 3, cooldownMs: 60_000 },
    onProxyError: (ctx) => proxyErrors.push({ provider: ctx.provider, code: ctx.code })
  })

  await expect(service.rotate()).rejects.toMatchObject({ code: 'PROXY_UNAVAILABLE' })
  await expect(service.rotate()).rejects.toMatchObject({ code: 'PROXY_UNAVAILABLE' })
  await expect(service.rotate()).rejects.toMatchObject({ code: 'PROXY_UNAVAILABLE' })
  await expect(service.rotate()).rejects.toMatchObject({
    code: 'PROXY_QUARANTINED',
    retryable: true
  } satisfies Partial<ProxyServiceError>)

  expect(providerCalls).toBe(3)
  expect(repo.writes).toEqual([{ enabled: false, lastRotatedAt: null }])
  expect(proxyErrors).toEqual([{ provider: 'proxyfb', code: 'PROXY_UNAVAILABLE' }])
  await expect(service.getHealth()).resolves.toEqual({
    state: 'quarantined',
    configured: true,
    cooldownRemainingMs: 60_000
  })

  now += 60_000
  await expect(service.rotate()).rejects.toMatchObject({ code: 'PROXY_UNAVAILABLE' })
  expect(providerCalls).toBe(4)
  expect(repo.writes).toEqual([
    { enabled: false, lastRotatedAt: null },
    { enabled: false, lastRotatedAt: null }
  ])
})

test('[P0] proxy service half-open success closes quarantine and reports healthy', async () => {
  let now = Date.UTC(2026, 5, 3, 0, 0, 0)
  const storage = createMemoryStorage()
  storage.data.set('proxy.proxyfb.api_key', 'KEY-123')
  const repo = createProxyRepo()
  let providerCalls = 0
  const provider: ProxyProvider = {
    getProxy: async () => {
      providerCalls += 1
      if (providerCalls === 1) throw new Error('first failure')
      return { host: '1.2.3.4', port: 8080, username: 'user', password: 'pass' }
    }
  }
  const service = createProxyService({
    storage,
    providers: { proxyfb: provider },
    repo,
    clock: () => now,
    breakerConfig: { failureThreshold: 1, cooldownMs: 5_000 }
  })

  await expect(service.rotate()).rejects.toMatchObject({ code: 'PROXY_UNAVAILABLE' })
  now += 5_000
  await expect(service.rotate()).resolves.toEqual({
    host: '1.2.3.4',
    port: 8080,
    username: 'user',
    password: 'pass'
  })

  expect(repo.writes).toEqual([
    { enabled: false, lastRotatedAt: null },
    { enabled: true, lastRotatedAt: '2026-06-03T00:00:05.000Z' }
  ])
  await expect(service.getHealth()).resolves.toEqual({ state: 'healthy', configured: true })
})
