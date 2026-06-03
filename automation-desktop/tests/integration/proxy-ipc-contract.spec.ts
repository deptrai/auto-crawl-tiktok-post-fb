import { test, expect } from '@playwright/test'
import { registerProxyHandlers } from '../../src/main/ipc/proxy-handlers'
import type { ProxyService } from '../../src/main/proxy'
import { channelRegistry } from '../../src/shared/ipc-schemas'
import {
  ProxyHealthResponseSchema,
  ProxyRotateResponseSchema
} from '../../src/shared/ipc-schemas/proxy'

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

function expectValidationError(response: unknown): void {
  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean; message: string } }).error
  expect(err.code).toBe('VALIDATION_ERROR')
  expect(err.retryable).toBe(false)
  expect(err.message).toBe('Dữ liệu yêu cầu không hợp lệ')
}

test('[P1] proxy IPC config-get rejects unexpected payload fields', async () => {
  const fakeIpc = new FakeIpcMain()
  registerProxyHandlers(fakeIpc, createService())

  const response = await fakeIpc.invoke('phase3:proxy:config-get', { apiKey: 'SHOULD-NOT-BE-HERE' })

  expectValidationError(response)
})

test('[P1] proxy IPC rotate rejects empty profileId before calling service', async () => {
  const fakeIpc = new FakeIpcMain()
  const rotateCalls: Array<string | undefined> = []
  registerProxyHandlers(
    fakeIpc,
    createService({
      rotate: async (profileId) => {
        rotateCalls.push(profileId)
        return { host: '1.2.3.4', port: 8080, username: 'user', password: 'pass' }
      }
    })
  )

  const response = await fakeIpc.invoke('phase3:proxy:rotate', { profileId: '' })

  expectValidationError(response)
  expect(rotateCalls).toEqual([])
})

test('[P1] proxy IPC schemas are registered and rotate response remains public-only', () => {
  const proxyEntries = channelRegistry.filter((entry) => entry.channel.startsWith('phase3:proxy:'))

  expect(proxyEntries.map((entry) => entry.channel).sort()).toEqual([
    'phase3:proxy:config-get',
    'phase3:proxy:config-set',
    'phase3:proxy:health',
    'phase3:proxy:rotate'
  ])

  const parsed = ProxyRotateResponseSchema.parse({
    ok: true,
    proxy: { host: '1.2.3.4', port: 8080, username: 'user', password: 'pass' }
  })

  expect(parsed).toEqual({ ok: true, proxy: { host: '1.2.3.4', port: 8080 } })
  expect(JSON.stringify(parsed)).not.toMatch(/user|pass|username|password/i)
})

test('[P1] proxy health response schema remains public-only', () => {
  const parsed = ProxyHealthResponseSchema.parse({
    ok: true,
    health: {
      state: 'quarantined',
      configured: true,
      cooldownRemainingMs: 12_000,
      apiKey: 'KEY-SECRET',
      username: 'proxy-user',
      password: 'proxy-pass'
    }
  })

  expect(parsed).toEqual({
    ok: true,
    health: { state: 'quarantined', configured: true, cooldownRemainingMs: 12_000 }
  })
  expect(JSON.stringify(parsed)).not.toMatch(/KEY|apiKey|user|pass|username|password/i)
})
