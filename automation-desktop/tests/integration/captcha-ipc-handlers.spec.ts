import { test, expect } from '@playwright/test'
import { registerCaptchaHandlers } from '../../src/main/ipc/captcha-handlers'

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

function createDeps(): {
  storage: Map<string, string>
  settings: Map<string, string>
  deps: Parameters<typeof registerCaptchaHandlers>[1]
} {
  const storage = new Map<string, string>()
  const settings = new Map<string, string>()
  return {
    storage,
    settings,
    deps: {
      storage: {
        get: async (key) => storage.get(key) ?? null,
        set: async (key, value) => {
          storage.set(key, value)
        }
      },
      settings: {
        getSetting: (key) => settings.get(key) ?? null,
        setSetting: (key, value) => {
          settings.set(key, value)
        }
      }
    }
  }
}

test('[P0] captcha IPC set-key stores trimmed CapSolver key without echoing it', async () => {
  const fakeIpc = new FakeIpcMain()
  const { storage, settings, deps } = createDeps()
  registerCaptchaHandlers(fakeIpc, deps)

  const response = await fakeIpc.invoke('phase3:captcha:set-key', {
    provider: 'capsolver',
    apiKey: '  CAPSOLVER_SECRET_123  '
  })

  expect(response).toEqual({ ok: true })
  expect(storage.get('captcha.capsolver.api_key')).toBe('CAPSOLVER_SECRET_123')
  expect(settings.has('captcha.capsolver.api_key')).toBe(false)
  expect(settings.has('captcha.solver.enabled')).toBe(false)
  expect(JSON.stringify(response)).not.toContain('CAPSOLVER_SECRET_123')
})

test('[P0] captcha IPC set-key stores trimmed 2captcha key without echoing it', async () => {
  const fakeIpc = new FakeIpcMain()
  const { storage, settings, deps } = createDeps()
  registerCaptchaHandlers(fakeIpc, deps)

  const response = await fakeIpc.invoke('phase3:captcha:set-key', {
    provider: '2captcha',
    apiKey: '  TWO_CAPTCHA_SECRET_456  '
  })

  expect(response).toEqual({ ok: true })
  expect(storage.get('captcha.2captcha.api_key')).toBe('TWO_CAPTCHA_SECRET_456')
  expect(settings.has('captcha.2captcha.api_key')).toBe(false)
  expect(settings.has('captcha.solver.enabled')).toBe(false)
  expect(JSON.stringify(response)).not.toContain('TWO_CAPTCHA_SECRET_456')
})

test('[P0] captcha IPC status returns booleans only and follows enabled setting', async () => {
  const fakeIpc = new FakeIpcMain()
  const { storage, settings, deps } = createDeps()
  storage.set('captcha.capsolver.api_key', 'CAPSOLVER_SECRET_123')
  storage.set('captcha.2captcha.api_key', '  ')
  settings.set('captcha.solver.enabled', 'true')
  registerCaptchaHandlers(fakeIpc, deps)

  const response = await fakeIpc.invoke('phase3:captcha:status', {})

  expect(response).toEqual({
    ok: true,
    capsolverConfigured: true,
    twoCaptchaConfigured: false,
    enabled: true
  })
  expect(Object.keys(response as Record<string, unknown>).sort()).toEqual([
    'capsolverConfigured',
    'enabled',
    'ok',
    'twoCaptchaConfigured'
  ])
  expect(JSON.stringify(response)).not.toMatch(/CAPSOLVER_SECRET|apiKey|token|password|proxy/i)
})

test('[P1] captcha IPC status defaults disabled when setting is absent', async () => {
  const fakeIpc = new FakeIpcMain()
  const { deps } = createDeps()
  registerCaptchaHandlers(fakeIpc, deps)

  const response = await fakeIpc.invoke('phase3:captcha:status', {})

  expect(response).toEqual({
    ok: true,
    capsolverConfigured: false,
    twoCaptchaConfigured: false,
    enabled: false
  })
})

test('[P1] captcha IPC rejects invalid set-key payload with Vietnamese ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  const { deps } = createDeps()
  registerCaptchaHandlers(fakeIpc, deps)

  const response = await fakeIpc.invoke('phase3:captcha:set-key', {
    provider: 'unknown',
    apiKey: ''
  })

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean; message: string } }).error
  expect(err.code).toBe('VALIDATION_ERROR')
  expect(err.retryable).toBe(false)
  expect(err.message).toBe('Dữ liệu yêu cầu không hợp lệ')
})

test('[P1] captcha IPC rejects unexpected status payload with Vietnamese ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  const { deps } = createDeps()
  registerCaptchaHandlers(fakeIpc, deps)

  const response = await fakeIpc.invoke('phase3:captcha:status', { key: true })

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean; message: string } }).error
  expect(err.code).toBe('VALIDATION_ERROR')
  expect(err.retryable).toBe(false)
  expect(err.message).toBe('Dữ liệu yêu cầu không hợp lệ')
})

test('[P1] captcha IPC storage failures return sanitized retryable ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  registerCaptchaHandlers(fakeIpc, {
    storage: {
      get: async () => null,
      set: async () => {
        throw new Error('CAPSOLVER_SECRET_123 failed')
      }
    },
    settings: {
      getSetting: () => null,
      setSetting: () => undefined
    }
  })

  const response = await fakeIpc.invoke('phase3:captcha:set-key', {
    provider: 'capsolver',
    apiKey: 'CAPSOLVER_SECRET_123'
  })

  expect((response as { ok: boolean }).ok).toBe(false)
  const json = JSON.stringify(response)
  expect(json).not.toContain('CAPSOLVER_SECRET_123')
  const err = (response as { error: { code: string; retryable: boolean; message: string } }).error
  expect(err.code).toBe('CAPTCHA_KEY_SAVE_FAILED')
  expect(err.retryable).toBe(true)
  expect(err.message).toBe('Không thể lưu API key CAPTCHA.')
})
