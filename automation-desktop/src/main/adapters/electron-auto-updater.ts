import type { AutoUpdater } from '../../adapters/updater'

export class ElectronAutoUpdater implements AutoUpdater {
  async checkForUpdates(): Promise<void> {
    return Promise.resolve()
  }

  quitAndInstall(): void {
    // Story 1.1 provides only adapter stub implementation.
  }
}
