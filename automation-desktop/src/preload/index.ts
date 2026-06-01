import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { IpcBridge } from '../adapters/ipc'

type DesktopApi = {
  ipc: IpcBridge
}

const api: DesktopApi = {
  ipc: {
    async call() {
      throw new Error('IPC bridge not implemented in Story 1.1')
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
}
