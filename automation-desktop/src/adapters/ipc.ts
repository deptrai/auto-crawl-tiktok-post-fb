import type { Phase3ChannelName } from '../shared/ipc-schemas'

export interface IpcBridge {
  call<C extends Phase3ChannelName, Req, Res>(channel: C, request: Req): Promise<Res>
}
