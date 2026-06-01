import { test, expect } from '@playwright/test'
import { ElectronIpcBridge } from '../../src/main/adapters/electron-ipc-bridge'
import { ElectronSafeStorage } from '../../src/main/adapters/electron-safe-storage'
import { ElectronAutoUpdater } from '../../src/main/adapters/electron-auto-updater'

test('[P2] ipc bridge stub throws not implemented', async () => {
  // Given: scaffold-level IPC bridge stub.
  const bridge = new ElectronIpcBridge()

  // Then: calls should fail with explicit not-wired error.
  await expect(bridge.call('phase3:test:call', {})).rejects.toThrow(/not wired/i)
})

test('[P2] safe storage stubs return stable placeholders', async () => {
  // Given/When: invoking storage methods on stub implementation.
  const storage = new ElectronSafeStorage()

  // Then: methods remain deterministic and side-effect free.
  await expect(storage.get('k')).resolves.toBeNull()
  await expect(storage.set('k', 'v')).resolves.toBeUndefined()
  await expect(storage.delete('k')).resolves.toBeUndefined()
})

test('[P2] auto updater stubs stay callable', async () => {
  // Given: updater stub in scaffold phase.
  const updater = new ElectronAutoUpdater()

  // Then: update hooks are callable without runtime dependency.
  await expect(updater.checkForUpdates()).resolves.toBeUndefined()
  expect(() => updater.quitAndInstall()).not.toThrow()
})
