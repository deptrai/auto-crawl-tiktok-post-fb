import { test, expect } from '@playwright/test'
import {
  LicenseServiceError,
  createFetchLicenseBackendClient,
  createLicenseService
} from '../../src/main/license/license-service'
import type { SecureStorage } from '../../src/adapters/secure-storage'
import type { SettingsRepository } from '../../src/main/db/repositories/settings-repo'

function createMemorySettings(): SettingsRepository {
  const values = new Map<string, string>()
  return {
    getSetting: (key) => values.get(key) ?? null,
    setSetting: (key, value) => {
      values.set(key, value)
    }
  }
}

function createMemoryStorage(events: string[] = []): SecureStorage {
  const values = new Map<string, string>()
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
      })
    }
  })

  await service.activate('LIC-OK')

  expect(events[0]).toBe('storage:license.activation_id')
  expect(events.slice(1)).toEqual(['setting:license.expires_at', 'setting:license.rebind_count'])
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
      })
    }
  })

  await expect(service.activate('LIC-OK')).rejects.toBeInstanceOf(LicenseServiceError)
  expect(events).toEqual(['storage:license.activation_id', 'delete:license.activation_id'])
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
