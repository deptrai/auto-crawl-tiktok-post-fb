import { test, expect } from '@playwright/test'
import { registerProxyHandlers } from '../../src/main/ipc/proxy-handlers'
import { ProxyServiceError, type ProxyService } from '../../src/main/proxy'

type IpcHandler = (_event: unknown, request: unknown) => Promise<unknown>

class FakeIpcMain {
  readonly handlers = new Map<string, IpcHandler>()
  handle(channel: string, handler: IpcHandler): void {
    this.handlers.set(channel, handler)
  }
  async invoke(channel: string, request: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`Missing handler: ${channel}`)
    return handler({}, request)
  }
}

function createService(overrides: Partial<ProxyService> = {}): ProxyService {
  return {
    configGet: async () => ({ configured: true }),
    configSet: async () => undefined,
    rotate: async () => ({ host: '1.2.3.4', port: 8080, username: 'user', password: 'pass' }),
    getHealth: async () => ({ state: 'healthy', configured: true }),
    ...overrides
  }
}

test('[P0] proxy IPC config-get returns configured flag without api key', async () => {
  const fakeIpc = new FakeIpcMain()
  registerProxyHandlers(fakeIpc, createService())

  const response = await fakeIpc.invoke('phase3:proxy:config-get', {})

  expect(response).toEqual({ ok: true, configured: true })
  expect(JSON.stringify(response)).not.toMatch(/KEY|apiKey|proxyfb\.api_key/i)
})

test('[P0] proxy IPC config-set validates and stores api key without echoing it', async () => {
  const fakeIpc = new FakeIpcMain()
  const calls: string[] = []
  registerProxyHandlers(
    fakeIpc,
    createService({
      configSet: async (apiKey) => {
        calls.push(apiKey)
      }
    })
  )

  const response = await fakeIpc.invoke('phase3:proxy:config-set', { apiKey: '  KEY-123  ' })

  expect(response).toEqual({ ok: true })
  expect(calls).toEqual(['KEY-123'])
  expect(JSON.stringify(response)).not.toContain('KEY-123')
})

test('[P1] proxy IPC config-set rejects invalid payload with ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  registerProxyHandlers(fakeIpc, createService())

  const response = await fakeIpc.invoke('phase3:proxy:config-set', { apiKey: '' })

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean; message: string } }).error
  expect(err.code).toBe('VALIDATION_ERROR')
  expect(err.retryable).toBe(false)
  expect(err.message).toBe('Dữ liệu yêu cầu không hợp lệ')
})

test('[P0] proxy IPC rotate returns public proxy host and port only', async () => {
  const fakeIpc = new FakeIpcMain()
  const profiles: Array<string | undefined> = []
  registerProxyHandlers(
    fakeIpc,
    createService({
      rotate: async (profileId) => {
        profiles.push(profileId)
        return { host: '1.2.3.4', port: 8080, username: 'user', password: 'pass' }
      }
    })
  )

  const response = await fakeIpc.invoke('phase3:proxy:rotate', { profileId: 'profile-1' })

  expect(response).toEqual({ ok: true, proxy: { host: '1.2.3.4', port: 8080 } })
  expect(profiles).toEqual(['profile-1'])
  expect(JSON.stringify(response)).not.toMatch(/user|pass|username|password/i)
})

test('[P0] proxy IPC rotate maps missing key to non-retryable ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  registerProxyHandlers(
    fakeIpc,
    createService({
      rotate: async () => {
        throw new ProxyServiceError('PROXY_NOT_CONFIGURED', 'Chưa cấu hình API key proxyfb.', false)
      }
    })
  )

  const response = await fakeIpc.invoke('phase3:proxy:rotate', {})

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean; message: string } }).error
  expect(err.code).toBe('PROXY_NOT_CONFIGURED')
  expect(err.retryable).toBe(false)
  expect(err.message).toBe('Chưa cấu hình API key proxyfb.')
})

test('[P0] proxy IPC rotate maps provider failure to retryable ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  registerProxyHandlers(
    fakeIpc,
    createService({
      rotate: async () => {
        throw new ProxyServiceError('PROXY_UNAVAILABLE', 'Không thể lấy proxy proxyfb.', true)
      }
    })
  )

  const response = await fakeIpc.invoke('phase3:proxy:rotate', {})

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean; message: string } }).error
  expect(err.code).toBe('PROXY_UNAVAILABLE')
  expect(err.retryable).toBe(true)
})

test('[P1] proxy IPC health returns public health without secrets', async () => {
  const fakeIpc = new FakeIpcMain()
  registerProxyHandlers(
    fakeIpc,
    createService({
      getHealth: async () => ({
        state: 'quarantined',
        configured: true,
        cooldownRemainingMs: 12_000
      })
    })
  )

  const response = await fakeIpc.invoke('phase3:proxy:health', {})

  expect(response).toEqual({
    ok: true,
    health: { state: 'quarantined', configured: true, cooldownRemainingMs: 12_000 }
  })
  expect(JSON.stringify(response)).not.toMatch(/KEY|apiKey|username|password|proxyfb\.api_key/i)
})

test('[P1] proxy IPC health rejects unexpected payload with ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  registerProxyHandlers(fakeIpc, createService())

  const response = await fakeIpc.invoke('phase3:proxy:health', { provider: 'proxyfb' })

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean; message: string } }).error
  expect(err.code).toBe('VALIDATION_ERROR')
  expect(err.retryable).toBe(false)
  expect(err.message).toBe('Dữ liệu yêu cầu không hợp lệ')
})
