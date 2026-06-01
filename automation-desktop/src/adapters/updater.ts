export interface AutoUpdater {
  checkForUpdates(): Promise<void>
  quitAndInstall(): void
}
