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

const profileList = [
  {
    id: 'profile-new',
    uid: 'uid_new',
    displayName: 'uid_new',
    status: 'running',
    createdAt: '2026-06-03T02:00:00.000Z'
  },
  {
    id: 'profile-old',
    uid: 'uid_old',
    displayName: 'uid_old',
    status: 'idle',
    createdAt: '2026-06-03T01:00:00.000Z'
  }
]

test('[P0] profile IPC import-bulk returns result without secrets', async () => {
  const fakeIpc = new FakeIpcMain()
  const service: ProfileService = {
    importBulk: async () => successResult,
    listProfiles: () => [],
    updateProfile: () => profileList[0],
    deleteProfile: async () => undefined
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
    importBulk: async () => successResult,
    listProfiles: () => [],
    updateProfile: () => profileList[0],
    deleteProfile: async () => undefined
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
    },
    listProfiles: () => [],
    updateProfile: () => profileList[0],
    deleteProfile: async () => undefined
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
    },
    listProfiles: () => [],
    updateProfile: () => profileList[0],
    deleteProfile: async () => undefined
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
      updateDisplayName: () => 1,
      getProfileById: () => undefined,
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
    importBulk: async () => successResult,
    listProfiles: () => [],
    updateProfile: () => profileList[0],
    deleteProfile: async () => undefined
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

test('[P0] profile IPC list returns profile summaries without secrets', async () => {
  const fakeIpc = new FakeIpcMain()
  const service: ProfileService = {
    importBulk: async () => successResult,
    listProfiles: () => profileList,
    updateProfile: () => profileList[0],
    deleteProfile: async () => undefined
  }
  registerProfileHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:profile:list', {})

  expect(response).toEqual({ ok: true, profiles: profileList })
  const json = JSON.stringify(response)
  expect(json).not.toMatch(/cookie|password|twofa|email|secret/i)
})

test('[P0] profile IPC list rejects non-empty payload with ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  const service: ProfileService = {
    importBulk: async () => successResult,
    listProfiles: () => profileList,
    updateProfile: () => profileList[0],
    deleteProfile: async () => undefined
  }
  registerProfileHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:profile:list', { unexpected: true })

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean; message: string } }).error
  expect(err.code).toBe('VALIDATION_ERROR')
  expect(err.retryable).toBe(false)
  expect(err.message).toBe('Dữ liệu yêu cầu không hợp lệ')
})

test('[P1] profile IPC list maps unknown service errors to non-retryable ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  const service: ProfileService = {
    importBulk: async () => successResult,
    listProfiles: () => {
      throw new Error('internal details')
    },
    updateProfile: () => profileList[0],
    deleteProfile: async () => undefined
  }
  registerProfileHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:profile:list', {})

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean; message: string } }).error
  expect(err.code).toBe('PROFILE_ERROR')
  expect(err.retryable).toBe(false)
  expect(err.message).toBe('Không thể xử lý profile.')
})

test('[P0] profile IPC update returns updated profile without secrets', async () => {
  const fakeIpc = new FakeIpcMain()
  const updated = { ...profileList[0], displayName: 'Tên mới' }
  const service: ProfileService = {
    importBulk: async () => successResult,
    listProfiles: () => profileList,
    updateProfile: () => updated,
    deleteProfile: async () => undefined
  }
  registerProfileHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:profile:update', {
    id: 'profile-new',
    displayName: 'Tên mới'
  })

  expect(response).toEqual({ ok: true, profile: updated })
  expect(JSON.stringify(response)).not.toMatch(/cookie|password|twofa|email|secret/i)
})

test('[P0] profile IPC update maps not-found service error to ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  const { ProfileServiceError } = await import('../../src/main/profile/profile-service')
  const service: ProfileService = {
    importBulk: async () => successResult,
    listProfiles: () => profileList,
    updateProfile: () => {
      throw new ProfileServiceError('PROFILE_NOT_FOUND', 'Không tìm thấy profile.', false)
    },
    deleteProfile: async () => undefined
  }
  registerProfileHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:profile:update', {
    id: 'missing-id',
    displayName: 'Tên mới'
  })

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean; message: string } }).error
  expect(err.code).toBe('PROFILE_NOT_FOUND')
  expect(err.retryable).toBe(false)
  expect(err.message).toBe('Không tìm thấy profile.')
})

test('[P1] profile IPC update rejects invalid payload with validation ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  const service: ProfileService = {
    importBulk: async () => successResult,
    listProfiles: () => profileList,
    updateProfile: () => profileList[0],
    deleteProfile: async () => undefined
  }
  registerProfileHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:profile:update', {
    id: 'profile-new',
    displayName: ''
  })

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean } }).error
  expect(err.code).toBe('VALIDATION_ERROR')
  expect(err.retryable).toBe(false)
})

test('[P0] profile IPC delete returns ok response', async () => {
  const fakeIpc = new FakeIpcMain()
  const calls: string[] = []
  const service: ProfileService = {
    importBulk: async () => successResult,
    listProfiles: () => profileList,
    updateProfile: () => profileList[0],
    deleteProfile: async (id) => {
      calls.push(id)
    }
  }
  registerProfileHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:profile:delete', { id: 'profile-new' })

  expect(response).toEqual({ ok: true })
  expect(calls).toEqual(['profile-new'])
})

test('[P1] profile IPC delete rejects invalid payload with validation ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  const service: ProfileService = {
    importBulk: async () => successResult,
    listProfiles: () => profileList,
    updateProfile: () => profileList[0],
    deleteProfile: async () => undefined
  }
  registerProfileHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:profile:delete', { id: '' })

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; retryable: boolean } }).error
  expect(err.code).toBe('VALIDATION_ERROR')
  expect(err.retryable).toBe(false)
})

test('[P1] profile IPC delete propagates PROFILE_DELETE_FAILED as retryable ErrorEnvelope', async () => {
  const fakeIpc = new FakeIpcMain()
  const { ProfileServiceError } = await import('../../src/main/profile/profile-service')
  const service: ProfileService = {
    importBulk: async () => successResult,
    listProfiles: () => profileList,
    updateProfile: () => profileList[0],
    deleteProfile: async () => {
      throw new ProfileServiceError(
        'PROFILE_DELETE_FAILED',
        'Không thể xóa dữ liệu nhạy cảm của profile. Vui lòng thử lại.',
        true
      )
    }
  }
  registerProfileHandlers(fakeIpc, service)

  const response = await fakeIpc.invoke('phase3:profile:delete', { id: 'profile-new' })

  expect((response as { ok: boolean }).ok).toBe(false)
  const err = (response as { error: { code: string; message: string; retryable: boolean } }).error
  expect(err.code).toBe('PROFILE_DELETE_FAILED')
  expect(err.retryable).toBe(true)
  expect(err.message).toContain('Không thể xóa')
})
