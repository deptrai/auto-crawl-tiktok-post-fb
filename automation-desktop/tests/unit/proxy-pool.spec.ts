import { test, expect } from '@playwright/test'
import type { ProxyInfo } from '../../src/shared/types/proxy'
import { createProxyPool, ProxyServiceError, toPlaywrightProxy } from '../../src/main/proxy'

type RotateCall = { profileId?: string }

interface FakeProxyService {
  calls: RotateCall[]
  rotate: (profileId?: string) => Promise<ProxyInfo>
}

function proxy(host: string, port = 8080, username = 'user', password = 'pass'): ProxyInfo {
  return { host, port, username, password }
}

function createSequentialProxyService(proxies: ProxyInfo[]): FakeProxyService {
  const calls: RotateCall[] = []
  let index = 0
  return {
    calls,
    rotate: async (profileId?: string) => {
      calls.push({ profileId })
      const next = proxies[index]
      if (!next) throw new Error('no proxy queued')
      index += 1
      return next
    }
  }
}

test('[P0] proxy pool acquires distinct proxies for two profile sessions', async () => {
  const service = createSequentialProxyService([proxy('10.0.0.1'), proxy('10.0.0.2')])
  const pool = createProxyPool({ proxyService: service })

  const first = await pool.acquire('profile-1')
  const second = await pool.acquire('profile-2')

  expect(first.host).toBe('10.0.0.1')
  expect(second.host).toBe('10.0.0.2')
  expect(pool.listAssignments()).toEqual([
    { profileId: 'profile-1', host: '10.0.0.1', port: 8080 },
    { profileId: 'profile-2', host: '10.0.0.2', port: 8080 }
  ])
})

test('[P0] proxy pool retries rotation when provider returns an already assigned host port', async () => {
  const service = createSequentialProxyService([
    proxy('10.0.0.1'),
    proxy('10.0.0.1', 8080, 'other-user', 'other-pass'),
    proxy('10.0.0.2')
  ])
  const pool = createProxyPool({ proxyService: service, maxAttempts: 3 })

  await pool.acquire('profile-1')
  const second = await pool.acquire('profile-2')

  expect(second.host).toBe('10.0.0.2')
  expect(service.calls).toHaveLength(3)
})

test('[P0] proxy pool throws retryable exhausted error after max collision attempts', async () => {
  const service = createSequentialProxyService([
    proxy('10.0.0.1'),
    proxy('10.0.0.1'),
    proxy('10.0.0.1')
  ])
  const pool = createProxyPool({ proxyService: service, maxAttempts: 2 })

  await pool.acquire('profile-1')

  await expect(pool.acquire('profile-2')).rejects.toMatchObject({
    code: 'PROXY_POOL_EXHAUSTED',
    message: 'Không cấp được proxy duy nhất cho profile.',
    retryable: true
  } satisfies Partial<ProxyServiceError>)
  expect(service.calls).toHaveLength(3)
})

test('[P0] proxy pool release frees a proxy and is idempotent', async () => {
  const reused = proxy('10.0.0.1')
  const service = createSequentialProxyService([reused, reused])
  const pool = createProxyPool({ proxyService: service })

  await pool.acquire('profile-1')
  pool.release('profile-1')
  pool.release('profile-1')
  const second = await pool.acquire('profile-2')

  expect(second).toEqual(reused)
  expect(pool.getProxyFor('profile-1')).toBeUndefined()
  expect(pool.listAssignments()).toEqual([{ profileId: 'profile-2', host: '10.0.0.1', port: 8080 }])
})

test('[P0] proxy pool acquire is idempotent for the same profile id', async () => {
  const assigned = proxy('10.0.0.1')
  const service = createSequentialProxyService([assigned, proxy('10.0.0.2')])
  const pool = createProxyPool({ proxyService: service })

  await expect(pool.acquire('profile-1')).resolves.toEqual(assigned)
  await expect(pool.acquire('profile-1')).resolves.toEqual(assigned)

  expect(service.calls).toHaveLength(1)
})

test('[P0] proxy pool propagates proxy service quarantine errors unchanged', async () => {
  const quarantined = new ProxyServiceError(
    'PROXY_QUARANTINED',
    'Proxy đang tạm ngừng do lỗi liên tục. Thử lại sau.',
    true
  )
  const service: FakeProxyService = {
    calls: [],
    rotate: async (profileId?: string) => {
      service.calls.push({ profileId })
      throw quarantined
    }
  }
  const pool = createProxyPool({ proxyService: service })

  await expect(pool.acquire('profile-1')).rejects.toBe(quarantined)
  expect(pool.listAssignments()).toEqual([])
})

test('[P0] proxy pool serializes concurrent acquire calls to prevent duplicate host port assignment', async () => {
  const events: string[] = []
  const service: FakeProxyService = {
    calls: [],
    rotate: async (profileId?: string) => {
      service.calls.push({ profileId })
      events.push(`start:${profileId}`)
      await Promise.resolve()
      events.push(`end:${profileId}`)
      return profileId === 'profile-1' ? proxy('10.0.0.1') : proxy('10.0.0.2')
    }
  }
  const pool = createProxyPool({ proxyService: service })

  const [first, second] = await Promise.all([pool.acquire('profile-1'), pool.acquire('profile-2')])

  expect(first.host).toBe('10.0.0.1')
  expect(second.host).toBe('10.0.0.2')
  expect(events).toEqual(['start:profile-1', 'end:profile-1', 'start:profile-2', 'end:profile-2'])
})

test('[P0] proxy pool listAssignments never exposes proxy credentials', async () => {
  const service = createSequentialProxyService([
    proxy('10.0.0.1', 8080, 'secret-user', 'secret-pass')
  ])
  const pool = createProxyPool({ proxyService: service })

  await pool.acquire('profile-1')

  const assignments = pool.listAssignments()
  expect(assignments).toEqual([{ profileId: 'profile-1', host: '10.0.0.1', port: 8080 }])
  expect(JSON.stringify(assignments)).not.toContain('secret-user')
  expect(JSON.stringify(assignments)).not.toContain('secret-pass')
})

test('[P0] toPlaywrightProxy converts ProxyInfo to Playwright proxy config shape', () => {
  expect(toPlaywrightProxy(proxy('proxy.local', 3128, 'u1', 'p1'))).toEqual({
    server: 'http://proxy.local:3128',
    username: 'u1',
    password: 'p1'
  })
})
