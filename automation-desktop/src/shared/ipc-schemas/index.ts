export type Phase3ChannelName = `phase3:${string}:${string}`

export interface ChannelRegistryEntry<Req = unknown, Res = unknown> {
  channel: Phase3ChannelName
  requestSchema: unknown
  responseSchema: unknown
  _types?: {
    request: Req
    response: Res
  }
}

export const channelRegistry: ReadonlyArray<ChannelRegistryEntry> = []
