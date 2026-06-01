import type { IpcBridge } from '../../adapters/ipc'

export class ElectronIpcBridge implements IpcBridge {
  async call<C extends string, Req, Res>(channel: C, request: Req): Promise<Res> {
    void channel
    void request
    throw new Error('Renderer-to-main IPC bridge is not wired in Story 1.1 yet')
  }
}
