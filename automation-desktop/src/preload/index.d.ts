import type { IpcBridge } from '../adapters/ipc'
import type { DesktopElectronApi } from './index'

declare global {
  interface Window {
    electron: DesktopElectronApi
    api: {
      ipc: IpcBridge
    }
  }
}
