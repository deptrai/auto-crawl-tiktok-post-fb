import type Database from 'better-sqlite3-multiple-ciphers'

export interface SettingsRepository {
  getSetting(key: string): string | null
  setSetting(key: string, value: string): void
}

export function createSettingsRepository(db: Database.Database): SettingsRepository {
  return {
    getSetting(key) {
      const row = db.prepare('SELECT value FROM local_settings WHERE key = ?').get(key) as
        | { value: string }
        | undefined
      return row?.value ?? null
    },

    setSetting(key, value) {
      db.prepare(
        `INSERT INTO local_settings(key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(key, value)
    }
  }
}
