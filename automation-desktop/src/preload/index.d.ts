import type { ElectronAPI } from '@electron-toolkit/preload'
import type { IpcBridge } from '../adapters/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      ipc: IpcBridge
    }
  }
}
