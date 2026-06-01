import { BrowserWindow } from 'electron'
import type { WindowManager } from '../../adapters/window'
import { buildMainWindowOptions } from './electron-security-baseline'

export class ElectronWindowManager implements WindowManager {
  private mainWindow: BrowserWindow | null = null

  createMainWindow(): void {
    if (this.mainWindow) return
    this.mainWindow = new BrowserWindow(buildMainWindowOptions())
  }

  showMainWindow(): void {
    this.mainWindow?.show()
  }
}
