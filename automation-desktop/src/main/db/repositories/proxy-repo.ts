import type Database from 'better-sqlite3-multiple-ciphers'

export interface ProxyConfigRow {
  provider: string
  enabled: boolean
  lastRotatedAt: string | null
}

export interface UpsertProxyConfigParams {
  enabled: boolean
  lastRotatedAt: string | null
}

export interface ProxyRepository {
  getConfig(provider: string): ProxyConfigRow | undefined
  upsertConfig(provider: string, params: UpsertProxyConfigParams): void
}

export function createProxyRepository(db: Database.Database): ProxyRepository {
  const stmtGet = db.prepare<
    [string],
    { provider: string; enabled: number; last_rotated_at: string | null }
  >('SELECT provider, enabled, last_rotated_at FROM proxy_configs WHERE provider = ?')
  const stmtUpsert = db.prepare<[string, number, string | null]>(
    `INSERT INTO proxy_configs(provider, enabled, last_rotated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       enabled = excluded.enabled,
       last_rotated_at = excluded.last_rotated_at`
  )

  return {
    getConfig(provider) {
      const row = stmtGet.get(provider)
      if (!row) return undefined
      return {
        provider: row.provider,
        enabled: row.enabled === 1,
        lastRotatedAt: row.last_rotated_at
      }
    },

    upsertConfig(provider, params) {
      stmtUpsert.run(provider, params.enabled ? 1 : 0, params.lastRotatedAt)
    }
  }
}
