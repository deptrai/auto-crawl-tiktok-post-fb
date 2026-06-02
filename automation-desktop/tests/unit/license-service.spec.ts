import { test, expect } from '@playwright/test'
import {
  LicenseServiceError,
  createFetchLicenseBackendClient,
  createLicenseService
} from '../../src/main/license/license-service'
import type { SecureStorage } from '../../src/adapters/secure-storage'
import type { SettingsRepository } from '../../src/main/db/repositories/settings-repo'
import type { LicenseService } from '../../src/main/license/license-service'

function createMemorySettings(): SettingsRepository {
  const values = new Map<string, string>()
  return {
    getSetting: (key) => values.get(key) ?? null,
    setSetting: (key, value) => {
      values.set(key, value)
    }
  }
}

function createMemoryStorage(
  events: string[] = [],
  initial: Record<string, string> = {}
): SecureStorage {
  const values = new Map<string, string>()
  Object.entries(initial).forEach(([key, value]) => values.set(key, value))
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      events.push(`storage:${key}`)
      values.set(key, value)
    },
    delete: async (key) => {
      events.push(`delete:${key}`)
      values.delete(key)
    }
  }
}

test('[P1] license service persists activation id before public settings', async () => {
  const events: string[] = []
  const settings = createMemorySettings()
  const originalSet = settings.setSetting
  settings.setSetting = (key, value) => {
    events.push(`setting:${key}`)
    originalSet(key, value)
  }
  const service = createLicenseService({
    settings,
    storage: createMemoryStorage(events),
    generateHwid: async () => 'a'.repeat(64),
    backendClient: {
      activate: async () => ({
        activation_id: '550e8400-e29b-41d4-a716-446655440000',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        rebind_count: 0
      }),
      check: async () => ({
        active: true,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        revoked: false,
        rebind_count: 0
      })
    }
  })

  await service.activate('LIC-OK')

  expect(events[0]).toBe('storage:license.activation_id')
  expect(events.slice(1)).toEqual([
    'setting:license.expires_at',
    'setting:license.last_success_check',
    'setting:license.rebind_count'
  ])
})

test('[P1] license service rolls back activation id when public settings fail', async () => {
  const events: string[] = []
  const settings = createMemorySettings()
  settings.setSetting = () => {
    throw new Error('settings write failed')
  }
  const service = createLicenseService({
    settings,
    storage: createMemoryStorage(events),
    generateHwid: async () => 'a'.repeat(64),
    backendClient: {
      activate: async () => ({
        activation_id: '550e8400-e29b-41d4-a716-446655440000',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        rebind_count: 0
      }),
      check: async () => ({
        active: true,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        revoked: false,
        rebind_count: 0
      })
    }
  })

  await expect(service.activate('LIC-OK')).rejects.toBeInstanceOf(LicenseServiceError)
  expect(events).toEqual(['storage:license.activation_id', 'delete:license.activation_id'])
})

test('[P1] license service check stores last successful server check timestamp', async () => {
  const settings = createMemorySettings()
  const storage = createMemoryStorage([], {
    'license.activation_id': '550e8400-e29b-41d4-a716-446655440000'
  })
  const expiresAt = new Date('2026-06-09T00:00:00.000Z').toISOString()
  const service = createLicenseService({
    settings,
    storage,
    generateHwid: async () => 'a'.repeat(64),
    now: () => new Date('2026-06-02T00:00:00.000Z'),
    backendClient: {
      activate: async () => ({
        activation_id: '550e8400-e29b-41d4-a716-446655440000',
        expires_at: expiresAt,
        rebind_count: 0
      }),
      check: async () => ({ active: true, expires_at: expiresAt, revoked: false, rebind_count: 0 })
    }
  })

  const status = await service.check()

  expect(status).toMatchObject({ active: true, gate: 'active', daysRemaining: 7 })
  expect(settings.getSetting('license.expires_at')).toBe(expiresAt)
  expect(settings.getSetting('license.last_success_check')).toBe('2026-06-02T00:00:00.000Z')
})

test('[P1] license service falls back to offline grace only inside 24h boundary', async () => {
  const createService = (now: string): LicenseService => {
    const settings = createMemorySettings()
    settings.setSetting('license.expires_at', '2026-06-09T00:00:00.000Z')
    settings.setSetting('license.last_success_check', '2026-06-02T00:00:00.000Z')
    return createLicenseService({
      settings,
      storage: createMemoryStorage([], {
        'license.activation_id': '550e8400-e29b-41d4-a716-446655440000'
      }),
      generateHwid: async () => 'a'.repeat(64),
      now: () => new Date(now),
      backendClient: {
        activate: async () => ({
          activation_id: '550e8400-e29b-41d4-a716-446655440000',
          expires_at: '2026-06-09T00:00:00.000Z',
          rebind_count: 0
        }),
        check: async () => {
          throw new LicenseServiceError('NETWORK_TIMEOUT', 'Máy chủ phản hồi quá chậm.', true)
        }
      }
    })
  }

  await expect(createService('2026-06-02T23:59:00.000Z').check()).resolves.toMatchObject({
    active: true,
    gate: 'offline-grace',
    offlineGraceValid: true
  })
  await expect(createService('2026-06-03T00:01:00.000Z').check()).resolves.toMatchObject({
    active: false,
    gate: 'locked',
    offlineGraceValid: false
  })
})

test('[P1] license service gates expired license into 7 day read-only then locked', async () => {
  const createStatus = async (
    now: string
  ): Promise<Awaited<ReturnType<LicenseService['getStatus']>>> => {
    const settings = createMemorySettings()
    settings.setSetting('license.expires_at', '2026-06-02T00:00:00.000Z')
    settings.setSetting('license.last_success_check', '2026-06-01T00:00:00.000Z')
    const service = createLicenseService({
      settings,
      storage: createMemoryStorage([], {
        'license.activation_id': '550e8400-e29b-41d4-a716-446655440000'
      }),
      generateHwid: async () => 'a'.repeat(64),
      now: () => new Date(now),
      backendClient: {
        activate: async () => ({
          activation_id: '550e8400-e29b-41d4-a716-446655440000',
          expires_at: '2026-06-02T00:00:00.000Z',
          rebind_count: 0
        }),
        check: async () => ({
          active: false,
          expires_at: '2026-06-02T00:00:00.000Z',
          revoked: false,
          rebind_count: 0
        })
      }
    })
    return service.getStatus()
  }

  await expect(createStatus('2026-06-08T00:00:00.000Z')).resolves.toMatchObject({
    active: false,
    gate: 'expired-readonly',
    expiredReadonlyValid: true
  })
  await expect(createStatus('2026-06-10T00:00:00.000Z')).resolves.toMatchObject({
    active: false,
    gate: 'locked',
    expiredReadonlyValid: false
  })
})

test('[P1] backend client rejects invalid activation response shape', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ activation_id: 'bad-id', expires_at: 'bad-date' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  try {
    const client = createFetchLicenseBackendClient('http://localhost:8000')
    await expect(client.activate('LIC-OK', 'a'.repeat(64))).rejects.toMatchObject({
      code: 'BACKEND_RESPONSE_INVALID',
      retryable: true
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('[P1] backend client times out hung activation requests', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    await new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
    throw new Error('unreachable')
  }

  try {
    const client = createFetchLicenseBackendClient('http://localhost:8000', 10)
    await expect(client.activate('LIC-OK', 'a'.repeat(64))).rejects.toMatchObject({
      code: 'NETWORK_TIMEOUT',
      retryable: true
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
