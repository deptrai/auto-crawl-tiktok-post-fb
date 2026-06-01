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
  return db
}
