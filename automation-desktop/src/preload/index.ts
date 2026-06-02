import { contextBridge, ipcRenderer } from 'electron'
import type { IpcBridge } from '../adapters/ipc'
import {
  channelRegistry,
  type ChannelRegistryEntry,
  type Phase3ChannelName
} from '../shared/ipc-schemas'

export type DesktopElectronApi = {
  process: {
    versions: NodeJS.ProcessVersions
  }
  ipcRenderer: {
    send(channel: string, ...args: unknown[]): void
  }
}

type DesktopApi = {
  ipc: IpcBridge
}

const electronApi: DesktopElectronApi = {
  process: {
    versions: process.versions
  },
  ipcRenderer: {
    send(channel, ...args) {
      ipcRenderer.send(channel, ...args)
    }
  }
}

const api: DesktopApi = {
  ipc: {
    async call<C extends Phase3ChannelName, Req, Res>(channel: C, request: Req): Promise<Res> {
      const registryEntry = (channelRegistry as ReadonlyArray<ChannelRegistryEntry>).find(
        (entry) => entry.channel === channel
      )
      if (!registryEntry) throw new Error(`Unregistered IPC channel: ${channel}`)

      const parsedRequest = registryEntry.requestSchema.safeParse(request)
      if (!parsedRequest.success) throw new Error(`Invalid IPC request for ${channel}`)

      const response = await ipcRenderer.invoke(channel, parsedRequest.data)
      const parsedResponse = registryEntry.responseSchema.safeParse(response)
      if (!parsedResponse.success) {
        const envelope = {
          ok: false,
          error: {
            code: 'IPC_RESPONSE_INVALID',
            message: `Phản hồi IPC không hợp lệ: ${channel}`,
            retryable: false
          }
        }
        return envelope as unknown as Res
      }

      return parsedResponse.data as Res
    }
  }
}

if (!process.contextIsolated) {
  throw new Error('[Phase3] contextIsolation is required. Check BrowserWindow webPreferences.')
}

contextBridge.exposeInMainWorld('electron', electronApi)
contextBridge.exposeInMainWorld('api', api)
