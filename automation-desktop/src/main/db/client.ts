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
  db.prepare(
    `CREATE TABLE IF NOT EXISTS proxy_configs(
      provider TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_rotated_at TEXT
    )`
  ).run()
  db.prepare(
    `CREATE TABLE IF NOT EXISTS automation_jobs(
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      state TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      result TEXT
    )`
  ).run()
  db.prepare(
    `CREATE TABLE IF NOT EXISTS content_templates(
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  ).run()
  db.prepare(
    `CREATE TABLE IF NOT EXISTS target_lists(
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`
  ).run()
  db.prepare(
    `CREATE TABLE IF NOT EXISTS target_list_entries(
      list_id TEXT NOT NULL REFERENCES target_lists(id) ON DELETE CASCADE,
      uid TEXT NOT NULL,
      name TEXT,
      sent_at TEXT,
      failed_at TEXT,
      last_outcome TEXT,
      last_error_reason TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY(list_id, uid)
    )`
  ).run()
  db.prepare(
    `CREATE TABLE IF NOT EXISTS target_list_jobs(
      list_id TEXT NOT NULL REFERENCES target_lists(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL REFERENCES automation_jobs(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(list_id, job_id)
    )`
  ).run()
  db.prepare(
    `CREATE TABLE IF NOT EXISTS job_actions(
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES automation_jobs(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      target TEXT,
      action_token TEXT,
      executed_at TEXT NOT NULL,
      outcome TEXT NOT NULL
    )`
  ).run()
  return db
}
