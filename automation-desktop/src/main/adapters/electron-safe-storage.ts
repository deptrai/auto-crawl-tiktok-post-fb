import type { SecureStorage } from '../../adapters/secure-storage'

export class ElectronSafeStorage implements SecureStorage {
  async get(key: string): Promise<string | null> {
    void key
    return null
  }

  async set(key: string, value: string): Promise<void> {
    void key
    void value
    return Promise.resolve()
  }

  async delete(key: string): Promise<void> {
    void key
    return Promise.resolve()
  }
}
