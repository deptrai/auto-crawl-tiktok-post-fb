import { test, expect } from '@playwright/test'
import type { SecureStorage } from '../../src/adapters/secure-storage'
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

test('[P0] proxy service configGet returns configured=false without exposing api key', async () => {
  const storage = createMemoryStorage()
  const service = createProxyService({ storage, providers: { proxyfb: createProvider() } })

  await expect(service.configGet()).resolves.toEqual({ configured: false })
})

test('[P0] proxy service configSet stores trimmed api key in safeStorage only', async () => {
  const log: string[] = []
  const storage = createMemoryStorage(log)
  const service = createProxyService({ storage, providers: { proxyfb: createProvider() } })

  await service.configSet('  KEY-123  ')

  expect(await storage.get('proxy.proxyfb.api_key')).toBe('KEY-123')
  expect(log).toEqual(['set:proxy.proxyfb.api_key:KEY-123'])
  await expect(service.configGet()).resolves.toEqual({ configured: true })
})

test('[P1] proxy service configSet rejects empty api key', async () => {
  const storage = createMemoryStorage()
  const service = createProxyService({ storage, providers: { proxyfb: createProvider() } })

  await expect(service.configSet('   ')).rejects.toMatchObject({
    code: 'PROXY_CONFIG_INVALID',
    retryable: false
  } satisfies Partial<ProxyServiceError>)
})

test('[P0] proxy service rotate uses stored key and returns full ProxyInfo for main process', async () => {
  const storage = createMemoryStorage()
  const provider = createProvider()
  storage.data.set('proxy.proxyfb.api_key', 'KEY-123')
  const service = createProxyService({ storage, providers: { proxyfb: provider } })

  const proxy = await service.rotate('profile-1')

  expect(proxy).toEqual({ host: '1.2.3.4', port: 8080, username: 'user', password: 'pass' })
  expect(provider.keys).toEqual(['KEY-123'])
})

test('[P0] proxy service rotate throws PROXY_NOT_CONFIGURED when key is missing', async () => {
  const storage = createMemoryStorage()
  const service = createProxyService({ storage, providers: { proxyfb: createProvider() } })

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
  const service = createProxyService({ storage, providers: { proxyfb: failingProvider } })

  await expect(service.rotate()).rejects.toMatchObject({
    code: 'PROXY_UNAVAILABLE',
    retryable: true
  } satisfies Partial<ProxyServiceError>)
})
