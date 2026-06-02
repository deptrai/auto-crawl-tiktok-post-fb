import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'

export interface EncryptedDbOptions {
  path: string
  key: string
}

export function openEncryptedDatabase(options: EncryptedDbOptions): Database.Database {
  mkdirSync(dirname(options.path), { recursive: true })
  const db = new Database(options.path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma(`legacy=4`)
  db.pragma(`key="${options.key}"`)
  db.prepare(
    'CREATE TABLE IF NOT EXISTS __smoke(id INTEGER PRIMARY KEY, value TEXT NOT NULL)'
  ).run()
  db.prepare(
    'CREATE TABLE IF NOT EXISTS local_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)'
  ).run()
  // Enable FK enforcement before creating tables that use FK (Story 2.1+)
  db.pragma('foreign_keys = ON')
  db.prepare(
    `CREATE TABLE IF NOT EXISTS profiles(
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      created_at TEXT NOT NULL
    )`
  ).run()
  db.prepare(
    `CREATE TABLE IF NOT EXISTS profile_metadata(
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY(profile_id, key)
    )`
  ).run()
  return db
}
