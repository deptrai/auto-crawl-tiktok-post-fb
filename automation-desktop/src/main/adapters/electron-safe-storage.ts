import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SecureStorage } from '../../adapters/secure-storage'

type Store = Record<string, number[]>

export class ElectronSafeStorage implements SecureStorage {
  private readonly path: string

  constructor(path = join(app.getPath('userData'), 'phase3-secure-storage.json')) {
    this.path = path
  }

  async get(key: string): Promise<string | null> {
    const blob = this.readStore()[key]
    if (!blob) return null
    const encrypted = Buffer.from(blob)
    return safeStorage.decryptString(encrypted)
  }

  async set(key: string, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Không thể mã hóa dữ liệu license trên máy này.')
    }
    const store = this.readStore()
    store[key] = Array.from(safeStorage.encryptString(value))
    this.writeStore(store)
  }

  async delete(key: string): Promise<void> {
    const store = this.readStore()
    delete store[key]
    this.writeStore(store)
  }

  private readStore(): Store {
    if (!existsSync(this.path)) return {}
    return JSON.parse(readFileSync(this.path, 'utf8')) as Store
  }

  private writeStore(store: Store): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(store, null, 2), 'utf8')
  }
}
