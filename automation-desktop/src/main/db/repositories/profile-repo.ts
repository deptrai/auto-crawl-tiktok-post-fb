import type Database from 'better-sqlite3-multiple-ciphers'

export interface ProfileRow {
  id: string
  uid: string
  displayName: string
  status: string
  createdAt: string
}

export interface InsertProfileParams {
  id: string
  uid: string
  displayName: string
  status: string
  createdAt: string
}

export interface ProfileMetadataEntry {
  key: string
  value: string
}

export interface ProfileRepository {
  uidExists(uid: string): boolean
  /** Atomically insert profile + metadata in one SQLite transaction. */
  insertProfileAtomic(params: InsertProfileParams, metadata: ProfileMetadataEntry[]): void
  deleteProfile(id: string): void
  listProfiles(): ProfileRow[]
  countProfiles(): number
}

export function createProfileRepository(db: Database.Database): ProfileRepository {
  const stmtUidExists = db.prepare<[string], { c: number }>(
    'SELECT COUNT(*) AS c FROM profiles WHERE uid = ?'
  )
  const stmtInsert = db.prepare<[string, string, string, string, string]>(
    'INSERT INTO profiles(id, uid, display_name, status, created_at) VALUES (?, ?, ?, ?, ?)'
  )
  const stmtSetMeta = db.prepare<[string, string, string]>(
    `INSERT INTO profile_metadata(profile_id, key, value)
     VALUES (?, ?, ?)
     ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value`
  )
  const stmtDelete = db.prepare<[string]>('DELETE FROM profiles WHERE id = ?')
  const stmtList = db.prepare<
    [],
    { id: string; uid: string; display_name: string; status: string; created_at: string }
  >('SELECT id, uid, display_name, status, created_at FROM profiles ORDER BY created_at DESC')
  const stmtCount = db.prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM profiles')

  // Synchronous SQLite transaction for profile + metadata
  const txInsert = db.transaction(
    (params: InsertProfileParams, metadata: ProfileMetadataEntry[]) => {
      stmtInsert.run(params.id, params.uid, params.displayName, params.status, params.createdAt)
      for (const { key, value } of metadata) {
        stmtSetMeta.run(params.id, key, value)
      }
    }
  )

  return {
    uidExists(uid) {
      const row = stmtUidExists.get(uid)
      return (row?.c ?? 0) > 0
    },

    insertProfileAtomic(params, metadata) {
      txInsert(params, metadata)
    },

    deleteProfile(id) {
      stmtDelete.run(id)
    },

    listProfiles() {
      return stmtList.all().map((row) => ({
        id: row.id,
        uid: row.uid,
        displayName: row.display_name,
        status: row.status,
        createdAt: row.created_at
      }))
    },

    countProfiles() {
      return stmtCount.get()?.c ?? 0
    }
  }
}
