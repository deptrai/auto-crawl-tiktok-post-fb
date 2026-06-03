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
  deleteCalls: string[]
} {
  const profiles = new Map<string, object>()
  const metadata = new Map<string, string>()
  const deleteCalls: string[] = []
  const uids = new Set<string>()
  return {
    profiles,
    metadata,
    deleteCalls,
    uidExists: (uid) => uids.has(uid),
    insertProfileAtomic: (p, metaEntries) => {
      profiles.set(p.id, p)
      uids.add(p.uid)
      for (const { key, value } of metaEntries) {
        metadata.set(`${p.id}:${key}`, value)
      }
    },
    deleteProfile: (id) => {
      deleteCalls.push(id)
      const p = profiles.get(id) as { uid?: string } | undefined
      if (p?.uid) uids.delete(p.uid)
      profiles.delete(id)
      for (const k of metadata.keys()) {
        if (k.startsWith(`${id}:`)) metadata.delete(k)
      }
    },
    updateDisplayName: (id, displayName) => {
      const p = profiles.get(id) as { displayName?: string } | undefined
      if (!p) return 0
      p.displayName = displayName
      return 1
    },
    getProfileById: (id) => profiles.get(id) as never,
    listProfiles: () => [...profiles.values()] as never,
    countProfiles: () => profiles.size,
    getMetadata: (profileId, key) => metadata.get(`${profileId}:${key}`),
    setMetadata: (profileId, key, value) => {
      metadata.set(`${profileId}:${key}`, value)
    }
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

test('[P1] importBulk accepts JSON cookie export and stores converted cookie string', async () => {
  const storage = createMemoryStorage()
  const repo = createMemoryRepo()
  const service = createProfileService({ storage, repo })
  const jsonCookieExport = JSON.stringify([
    { domain: '.facebook.com', name: 'datr', value: 'datr-value' },
    { domain: '.facebook.com', name: 'c_user', value: '61554949615037' },
    { domain: '.facebook.com', name: 'xs', value: 'xs-value' }
  ])

  const result = await service.importBulk(jsonCookieExport)

  expect(result.imported).toBe(1)
  expect(result.failed).toHaveLength(0)
  expect(result.profiles[0].uid).toBe('61554949615037')
  const id = result.profiles[0].id
  expect(await storage.get(`profile.${id}.cookie`)).toBe(
    'datr=datr-value; c_user=61554949615037; xs=xs-value'
  )
  expect(JSON.stringify(result)).not.toContain('xs-value')
})

test('[P1] importBulk accepts external email-passmail-cookie-token-userAgent format', async () => {
  const storage = createMemoryStorage()
  const repo = createMemoryRepo()
  const service = createProfileService({ storage, repo })
  const cookie = 'c_user=100024652313185; xs=session-value; datr=datr-value'
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'

  const result = await service.importBulk(
    `100024652313185|fb-pass|mail@example.com|mail-pass|${cookie}|token-value|${userAgent}`
  )

  expect(result.imported).toBe(1)
  expect(result.failed).toHaveLength(0)
  const id = result.profiles[0].id
  expect(await storage.get(`profile.${id}.cookie`)).toBe(cookie)
  expect(await storage.get(`profile.${id}.twofa`)).toBeNull()
  expect(await storage.get(`profile.${id}.fb_password`)).toBe('fb-pass')
  expect(await storage.get(`profile.${id}.mail_password`)).toBe('mail-pass')
  expect(repo.metadata.get(`${id}:email`)).toBe('mail@example.com')
  expect(repo.metadata.get(`${id}:token`)).toBe('token-value')
  expect(repo.metadata.get(`${id}:user_agent`)).toBe(userAgent)
  expect(JSON.stringify(result)).not.toContain('session-value')
  expect(JSON.stringify(result)).not.toContain('token-value')
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

test('[P0] listProfiles maps repository rows without reading secure storage', () => {
  const storageCalls: string[] = []
  const storage: SecureStorage = {
    get: async (key) => {
      storageCalls.push(`get:${key}`)
      throw new Error('listProfiles must not read secure storage')
    },
    set: async (key) => {
      storageCalls.push(`set:${key}`)
    },
    delete: async (key) => {
      storageCalls.push(`delete:${key}`)
    }
  }
  const repo = createMemoryRepo()
  repo.insertProfileAtomic(
    {
      id: 'profile-2',
      uid: 'uid_new',
      displayName: 'uid_new',
      status: 'running',
      createdAt: '2026-06-03T02:00:00.000Z'
    },
    [{ key: 'email', value: 'secret@example.com' }]
  )
  repo.insertProfileAtomic(
    {
      id: 'profile-1',
      uid: 'uid_old',
      displayName: 'uid_old',
      status: 'idle',
      createdAt: '2026-06-03T01:00:00.000Z'
    },
    []
  )
  const service = createProfileService({ storage, repo })

  const profiles = service.listProfiles()

  expect(profiles).toEqual([
    {
      id: 'profile-2',
      uid: 'uid_new',
      displayName: 'uid_new',
      status: 'running',
      createdAt: '2026-06-03T02:00:00.000Z'
    },
    {
      id: 'profile-1',
      uid: 'uid_old',
      displayName: 'uid_old',
      status: 'idle',
      createdAt: '2026-06-03T01:00:00.000Z'
    }
  ])
  expect(storageCalls).toEqual([])
  const json = JSON.stringify(profiles)
  expect(json).not.toContain('secret@example.com')
  expect(json).not.toMatch(/cookie|password|twofa|email/i)
})

test('[P0] updateProfile updates displayName and returns updated summary without touching storage', () => {
  const storageCalls: string[] = []
  const storage: SecureStorage = {
    get: async (key) => {
      storageCalls.push(`get:${key}`)
      return null
    },
    set: async (key) => {
      storageCalls.push(`set:${key}`)
    },
    delete: async (key) => {
      storageCalls.push(`delete:${key}`)
    }
  }
  const repo = createMemoryRepo()
  repo.insertProfileAtomic(
    {
      id: 'profile-edit-1',
      uid: 'uid_edit',
      displayName: 'Tên cũ',
      status: 'idle',
      createdAt: '2026-06-03T03:00:00.000Z'
    },
    []
  )
  const service = createProfileService({ storage, repo })

  const updated = service.updateProfile('profile-edit-1', { displayName: 'Tên mới' })

  expect(updated).toEqual({
    id: 'profile-edit-1',
    uid: 'uid_edit',
    displayName: 'Tên mới',
    status: 'idle',
    createdAt: '2026-06-03T03:00:00.000Z'
  })
  expect(storageCalls).toEqual([])
  expect(JSON.stringify(updated)).not.toMatch(/cookie|password|twofa|email/i)
})

test('[P0] updateProfile throws PROFILE_NOT_FOUND when id does not exist', () => {
  const storage = createMemoryStorage()
  const repo = createMemoryRepo()
  const service = createProfileService({ storage, repo })

  expect(() => service.updateProfile('missing-id', { displayName: 'Tên mới' })).toThrow(
    ProfileServiceError
  )
  expect(() => service.updateProfile('missing-id', { displayName: 'Tên mới' })).toThrow(
    /Không tìm thấy profile/
  )
})

test('[P0] deleteProfile deletes all secret keys before deleting repo row', async () => {
  const log: string[] = []
  const storage = createMemoryStorage(log)
  const repo = createMemoryRepo()
  repo.insertProfileAtomic(
    {
      id: 'profile-delete-1',
      uid: 'uid_delete',
      displayName: 'uid_delete',
      status: 'idle',
      createdAt: '2026-06-03T03:00:00.000Z'
    },
    [{ key: 'email', value: 'delete@example.com' }]
  )
  const service = createProfileService({ storage, repo })

  await service.deleteProfile('profile-delete-1')

  expect(log).toEqual([
    'del:profile.profile-delete-1.cookie',
    'del:profile.profile-delete-1.twofa',
    'del:profile.profile-delete-1.fb_password',
    'del:profile.profile-delete-1.mail_password'
  ])
  expect(repo.deleteCalls).toEqual(['profile-delete-1'])
  expect(repo.profiles.has('profile-delete-1')).toBe(false)
  expect(repo.metadata.has('profile-delete-1:email')).toBe(false)
})

test('[P0] deleteProfile aborts row delete when any secret delete fails', async () => {
  const deleteAttempts: string[] = []
  const storage: SecureStorage = {
    get: async () => null,
    set: async () => undefined,
    delete: async (key) => {
      deleteAttempts.push(key)
      if (key.endsWith('.twofa')) throw new Error('disk fail')
    }
  }
  const repo = createMemoryRepo()
  repo.insertProfileAtomic(
    {
      id: 'profile-delete-fail',
      uid: 'uid_delete_fail',
      displayName: 'uid_delete_fail',
      status: 'idle',
      createdAt: '2026-06-03T03:00:00.000Z'
    },
    []
  )
  const service = createProfileService({ storage, repo })

  await expect(service.deleteProfile('profile-delete-fail')).rejects.toMatchObject({
    code: 'PROFILE_DELETE_FAILED',
    retryable: true
  } satisfies Partial<ProfileServiceError>)
  expect(deleteAttempts).toEqual([
    'profile.profile-delete-fail.cookie',
    'profile.profile-delete-fail.twofa',
    'profile.profile-delete-fail.fb_password',
    'profile.profile-delete-fail.mail_password'
  ])
  expect(repo.deleteCalls).toEqual([])
  expect(repo.profiles.has('profile-delete-fail')).toBe(true)
})

test('[P1] deleteProfile is idempotent when id does not exist', async () => {
  const log: string[] = []
  const storage = createMemoryStorage(log)
  const repo = createMemoryRepo()
  const service = createProfileService({ storage, repo })

  await expect(service.deleteProfile('missing-id')).resolves.toBeUndefined()

  expect(log).toEqual([
    'del:profile.missing-id.cookie',
    'del:profile.missing-id.twofa',
    'del:profile.missing-id.fb_password',
    'del:profile.missing-id.mail_password'
  ])
  expect(repo.deleteCalls).toEqual(['missing-id'])
})
