import { test, expect } from '@playwright/test'
import { registerProfileHandlers } from '../../src/main/ipc/profile-handlers'
import { MAX_LINES } from '../../src/main/profile/parser'
import type { ProfileService } from '../../src/main/profile/profile-service'

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

const successResult = {
  total: 1,
  imported: 1,
  skipped: [],
  failed: [],
  profiles: [{ id: 'test-id', uid: 'uid1', displayName: 'uid1', status: 'idle' as const }]
}

test('[P0] profile IPC import-bulk returns result without secrets', async () => {
  const fakeIpc = new FakeIpcMain()
  const service: ProfileService = {
    importBulk: async () => successResult
  }
  registerProfileHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:profile:import-bulk', {
    text: 'uid1|pass|2fa|cookie|hot@m.com|passmail'
  })

  expect((response as { ok: boolean }).ok).toBe(true)
  const json = JSON.stringify(response)
  expect(json).not.toContain('cookie')
  expect(json).not.toContain('pass')
  expect(json).not.toContain('2fa')
})

test('[P1] profile IPC rejects invalid payload with ErrorEnvelope retryable=false', async () => {
  const fakeIpc = new FakeIpcMain()
  const service: ProfileService = {
    importBulk: async () => successResult
  }
  registerProfileHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:profile:import-bulk', { bad: 'payload' })

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean } }).error
  expect(err.code).toBe('VALIDATION_ERROR')
  expect(err.retryable).toBe(false)
})

test('[P1] profile IPC propagates service error as retryable ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  const { ProfileServiceError } = await import('../../src/main/profile/profile-service')
  const service: ProfileService = {
    importBulk: async () => {
      throw new ProfileServiceError('PROFILE_ERROR', 'Lỗi xử lý profile', true)
    }
  }
  registerProfileHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:profile:import-bulk', { text: 'uid|p|f|ck' })

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean } }).error
  expect(err.retryable).toBe(true)
})

test('[P1] profile IPC maps unknown service errors to non-retryable ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  const service: ProfileService = {
    importBulk: async () => {
      throw new Error('programmer bug')
    }
  }
  registerProfileHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:profile:import-bulk', { text: 'uid|p|f|ck' })

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean } }).error
  expect(err.code).toBe('PROFILE_ERROR')
  expect(err.retryable).toBe(false)
})

test('[P0] profile IPC returns ErrorEnvelope when line cap is exceeded', async () => {
  const fakeIpc = new FakeIpcMain()
  const { createProfileService } = await import('../../src/main/profile/profile-service')
  const service = createProfileService({
    storage: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined
    },
    repo: {
      uidExists: () => false,
      insertProfileAtomic: () => undefined,
      deleteProfile: () => undefined,
      listProfiles: () => [],
      countProfiles: () => 0
    }
  })
  registerProfileHandlers(fakeIpc, service)
  const text = Array.from({ length: MAX_LINES + 1 }, (_, i) => `uid${i}|p|2fa|ck${i}`).join('\n')

  const response = await fakeIpc.invoke('phase3:profile:import-bulk', { text })

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean } }).error
  expect(err.code).toBe('LINE_CAP_EXCEEDED')
  expect(err.retryable).toBe(false)
})

test('[P1] profile IPC rejects text larger than 1MB with validation ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  const service: ProfileService = {
    importBulk: async () => successResult
  }
  registerProfileHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:profile:import-bulk', {
    text: 'a'.repeat(1_000_001)
  })

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean } }).error
  expect(err.code).toBe('VALIDATION_ERROR')
  expect(err.retryable).toBe(false)
})
