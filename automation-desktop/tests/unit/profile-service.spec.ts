import { test, expect } from '@playwright/test'
import type { SecureStorage } from '../../src/adapters/secure-storage'
import type { ProfileRepository } from '../../src/main/db/repositories/profile-repo'
import { MAX_LINES } from '../../src/main/profile/parser'
import { createProfileService, ProfileServiceError } from '../../src/main/profile/profile-service'

// ---- Memory fakes ----

function createMemoryStorage(
  log: string[] = []
): SecureStorage & { data: Map<string, string>; valueTypes: string[] } {
  const data = new Map<string, string>()
  const valueTypes: string[] = []
  return {
    data,
    valueTypes,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      log.push(`set:${key}`)
      valueTypes.push(typeof value)
      data.set(key, value)
    },
    delete: async (key) => {
      log.push(`del:${key}`)
      data.delete(key)
    }
  }
}

function createMemoryRepo(): ProfileRepository & {
  profiles: Map<string, object>
  metadata: Map<string, string>
} {
  const profiles = new Map<string, object>()
  const metadata = new Map<string, string>()
  const uids = new Set<string>()
  return {
    profiles,
    metadata,
    uidExists: (uid) => uids.has(uid),
    insertProfileAtomic: (p, metaEntries) => {
      profiles.set(p.id, p)
      uids.add(p.uid)
      for (const { key, value } of metaEntries) {
        metadata.set(`${p.id}:${key}`, value)
      }
    },
    deleteProfile: (id) => {
      const p = profiles.get(id) as { uid?: string } | undefined
      if (p?.uid) uids.delete(p.uid)
      profiles.delete(id)
      for (const k of metadata.keys()) {
        if (k.startsWith(`${id}:`)) metadata.delete(k)
      }
    },
    listProfiles: () => [...profiles.values()] as never,
    countProfiles: () => profiles.size
  }
}

// ---- Tests ----

test('[P0] importBulk stores secret in storage, metadata in repo', async () => {
  const log: string[] = []
  const storage = createMemoryStorage(log)
  const repo = createMemoryRepo()
  const service = createProfileService({ storage, repo })

  const result = await service.importBulk('uid1|pass1|seed1|cookie1|hot@m.com|mailpass1')

  expect(result.imported).toBe(1)
  expect(result.failed).toHaveLength(0)
  expect(result.skipped).toHaveLength(0)
  expect(result.profiles).toHaveLength(1)
  const p = result.profiles[0]
  expect(p.uid).toBe('uid1')
  expect(p.status).toBe('idle')

  // Secret in storage
  const id = p.id
  expect(await storage.get(`profile.${id}.cookie`)).toBe('cookie1')
  expect(await storage.get(`profile.${id}.twofa`)).toBe('seed1')
  expect(await storage.get(`profile.${id}.fb_password`)).toBe('pass1')
  expect(await storage.get(`profile.${id}.mail_password`)).toBe('mailpass1')
  expect(storage.valueTypes).toEqual(['string', 'string', 'string', 'string'])

  // Metadata in repo
  expect(repo.metadata.get(`${id}:email`)).toBe('hot@m.com')
})

test('[P0] importBulk response NEVER contains cookie/2fa/password', async () => {
  const storage = createMemoryStorage()
  const repo = createMemoryRepo()
  const service = createProfileService({ storage, repo })

  const result = await service.importBulk('uid1|pass1|seed1|cookie1|hot@m.com|mailpass1')
  const json = JSON.stringify(result)

  expect(json).not.toContain('cookie1')
  expect(json).not.toContain('pass1')
  expect(json).not.toContain('seed1')
  expect(json).not.toContain('mailpass1')
})

test('[P1] importBulk skips duplicate uid in same batch', async () => {
  const storage = createMemoryStorage()
  const repo = createMemoryRepo()
  const service = createProfileService({ storage, repo })

  const text = ['uid1|p|2fa|ck1', 'uid1|p2|2fa2|ck2'].join('\n')
  const result = await service.importBulk(text)

  expect(result.imported).toBe(1)
  expect(result.skipped).toHaveLength(1)
  expect(result.skipped[0].reason).toMatch(/uid/)
})

test('[P1] importBulk skips uid already in repo', async () => {
  const storage = createMemoryStorage()
  const repo = createMemoryRepo()
  // Pre-insert uid via insertProfileAtomic
  repo.insertProfileAtomic(
    {
      id: 'existing-id',
      uid: 'uid1',
      displayName: 'uid1',
      status: 'idle',
      createdAt: new Date().toISOString()
    },
    []
  )
  const service = createProfileService({ storage, repo })

  const result = await service.importBulk('uid1|p|2fa|ck1')
  expect(result.skipped).toHaveLength(1)
  expect(result.imported).toBe(0)
})

test('[P1] atomicity: storage.set failure cleans up and marks profile failed', async () => {
  const data = new Map<string, string>()
  let callCount = 0
  const failingStorage: SecureStorage = {
    get: async (key) => data.get(key) ?? null,
    set: async (key) => {
      callCount++
      if (callCount >= 2) throw new Error('storage fail')
      data.set(key, 'value')
    },
    delete: async (key) => {
      data.delete(key)
    }
  }
  const repo = createMemoryRepo()
  const service = createProfileService({ storage: failingStorage, repo })

  const result = await service.importBulk('uid1|pass|2fa|cookie1')

  expect(result.failed).toHaveLength(1)
  expect(result.imported).toBe(0)
  // No orphan profile in repo
  expect(repo.profiles.size).toBe(0)
  // No orphan secrets (the first partial key should be cleaned up)
  expect(data.size).toBe(0)
})

test('[P1] skips empty lines and comment lines, only counts real lines', async () => {
  const storage = createMemoryStorage()
  const repo = createMemoryRepo()
  const service = createProfileService({ storage, repo })

  const text = ['# comment', '', 'uid1|p|2fa|ck1', '   ', 'uid2|p|2fa|ck2'].join('\n')
  const result = await service.importBulk(text)

  expect(result.imported).toBe(2)
  expect(result.total).toBe(2)
})

test('[P1] empty pass/twofa fields are not stored in safeStorage', async () => {
  const log: string[] = []
  const storage = createMemoryStorage(log)
  const repo = createMemoryRepo()
  const service = createProfileService({ storage, repo })

  // uid|||cookie (no pass, no 2fa, no hotmail, no passmail)
  const result = await service.importBulk('uid1|||ck1')
  expect(result.imported).toBe(1)
  const id = result.profiles[0].id

  // Only cookie should be stored
  expect(log.filter((e) => e.startsWith('set:'))).toEqual([`set:profile.${id}.cookie`])
})

test('[P0] importBulk throws non-retryable service error when line cap is exceeded', async () => {
  const storage = createMemoryStorage()
  const repo = createMemoryRepo()
  const service = createProfileService({ storage, repo })
  const text = Array.from({ length: MAX_LINES + 1 }, (_, i) => `uid${i}|p|2fa|ck${i}`).join('\n')

  await expect(service.importBulk(text)).rejects.toMatchObject({
    code: 'LINE_CAP_EXCEEDED',
    retryable: false
  } satisfies Partial<ProfileServiceError>)
})

test('[P1] importBulk sanitizes DB errors and maps UNIQUE race to Vietnamese reason', async () => {
  const storage = createMemoryStorage()
  const repo = createMemoryRepo()
  repo.insertProfileAtomic = () => {
    throw new Error('SqliteError: UNIQUE constraint failed: profiles.uid')
  }
  const service = createProfileService({ storage, repo })

  const result = await service.importBulk('uid1|p|2fa|ck1')

  expect(result.failed).toHaveLength(1)
  expect(result.failed[0].reason).toBe('uid đã tồn tại trong cơ sở dữ liệu.')
  expect(JSON.stringify(result)).not.toMatch(/UNIQUE constraint failed|profiles\.uid/i)
})

test('[P1] importBulk sanitizes non-unique storage/internal errors', async () => {
  const storage = createMemoryStorage()
  const repo = createMemoryRepo()
  repo.insertProfileAtomic = () => {
    throw new Error('SqliteError: no such table: profile_metadata')
  }
  const service = createProfileService({ storage, repo })

  const result = await service.importBulk('uid1|p|2fa|ck1')

  expect(result.failed).toHaveLength(1)
  expect(result.failed[0].reason).toBe('Không thể lưu profile (lỗi lưu trữ nội bộ).')
  expect(JSON.stringify(result)).not.toMatch(/no such table|profile_metadata/i)
})
