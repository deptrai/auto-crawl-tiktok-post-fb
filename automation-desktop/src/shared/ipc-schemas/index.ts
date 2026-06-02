import type { z } from 'zod'
import {
  SettingsGetRequestSchema,
  SettingsGetResponseSchema,
  SettingsSetRequestSchema,
  SettingsSetResponseSchema,
  type SettingsGetRequest,
  type SettingsGetResponse,
  type SettingsSetRequest,
  type SettingsSetResponse
} from './settings'
import {
  ShellOpenExternalRequestSchema,
  ShellOpenExternalResponseSchema,
  type ShellOpenExternalRequest,
  type ShellOpenExternalResponse
} from './shell'

export type Phase3ChannelName = `phase3:${string}:${string}`

export interface ChannelRegistryEntry<Req = unknown, Res = unknown> {
  channel: Phase3ChannelName
  requestSchema: z.ZodType<Req>
  responseSchema: z.ZodType<Res>
  _types?: {
    request: Req
    response: Res
  }
}

export const channelRegistry = [
  {
    channel: 'phase3:settings:get',
    requestSchema: SettingsGetRequestSchema,
    responseSchema: SettingsGetResponseSchema
  } satisfies ChannelRegistryEntry<SettingsGetRequest, SettingsGetResponse>,
  {
    channel: 'phase3:settings:set',
    requestSchema: SettingsSetRequestSchema,
    responseSchema: SettingsSetResponseSchema
  } satisfies ChannelRegistryEntry<SettingsSetRequest, SettingsSetResponse>,
  {
    channel: 'phase3:shell:open-external',
    requestSchema: ShellOpenExternalRequestSchema,
    responseSchema: ShellOpenExternalResponseSchema
  } satisfies ChannelRegistryEntry<ShellOpenExternalRequest, ShellOpenExternalResponse>
] as const satisfies ReadonlyArray<ChannelRegistryEntry>

export * from './common'
export * from './settings'
export * from './shell'
