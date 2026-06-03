import type { z } from 'zod'
import {
  LicenseActivateRequestSchema,
  LicenseActivateResponseSchema,
  LicenseCheckRequestSchema,
  LicenseCheckResponseSchema,
  LicenseStatusRequestSchema,
  LicenseStatusResponseSchema,
  type LicenseActivateRequest,
  type LicenseActivateResponse,
  type LicenseCheckRequest,
  type LicenseCheckResponse,
  type LicenseStatusRequest,
  type LicenseStatusResponse
} from './license'
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
import {
  ProfileImportBulkRequestSchema,
  ProfileImportBulkResponseSchema,
  ProfileDeleteRequestSchema,
  ProfileDeleteResponseSchema,
  ProfileListRequestSchema,
  ProfileListResponseSchema,
  ProfileUpdateRequestSchema,
  ProfileUpdateResponseSchema,
  type ProfileImportBulkRequest,
  type ProfileImportBulkResponse,
  type ProfileDeleteRequest,
  type ProfileDeleteResponse,
  type ProfileListRequest,
  type ProfileListResponse,
  type ProfileUpdateRequest,
  type ProfileUpdateResponse
} from './profile'
import {
  ProxyConfigGetRequestSchema,
  ProxyConfigGetResponseSchema,
  ProxyConfigSetRequestSchema,
  ProxyConfigSetResponseSchema,
  ProxyRotateRequestSchema,
  ProxyRotateResponseSchema,
  type ProxyConfigGetRequest,
  type ProxyConfigGetResponse,
  type ProxyConfigSetRequest,
  type ProxyConfigSetResponse,
  type ProxyRotateRequest,
  type ProxyRotateResponse
} from './proxy'

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
  } satisfies ChannelRegistryEntry<ShellOpenExternalRequest, ShellOpenExternalResponse>,
  {
    channel: 'phase3:license:activate',
    requestSchema: LicenseActivateRequestSchema,
    responseSchema: LicenseActivateResponseSchema
  } satisfies ChannelRegistryEntry<LicenseActivateRequest, LicenseActivateResponse>,
  {
    channel: 'phase3:license:status',
    requestSchema: LicenseStatusRequestSchema,
    responseSchema: LicenseStatusResponseSchema
  } satisfies ChannelRegistryEntry<LicenseStatusRequest, LicenseStatusResponse>,
  {
    channel: 'phase3:license:check',
    requestSchema: LicenseCheckRequestSchema,
    responseSchema: LicenseCheckResponseSchema
  } satisfies ChannelRegistryEntry<LicenseCheckRequest, LicenseCheckResponse>,
  {
    channel: 'phase3:profile:import-bulk',
    requestSchema: ProfileImportBulkRequestSchema,
    responseSchema: ProfileImportBulkResponseSchema
  } satisfies ChannelRegistryEntry<ProfileImportBulkRequest, ProfileImportBulkResponse>,
  {
    channel: 'phase3:profile:list',
    requestSchema: ProfileListRequestSchema,
    responseSchema: ProfileListResponseSchema
  } satisfies ChannelRegistryEntry<ProfileListRequest, ProfileListResponse>,
  {
    channel: 'phase3:profile:update',
    requestSchema: ProfileUpdateRequestSchema,
    responseSchema: ProfileUpdateResponseSchema
  } satisfies ChannelRegistryEntry<ProfileUpdateRequest, ProfileUpdateResponse>,
  {
    channel: 'phase3:profile:delete',
    requestSchema: ProfileDeleteRequestSchema,
    responseSchema: ProfileDeleteResponseSchema
  } satisfies ChannelRegistryEntry<ProfileDeleteRequest, ProfileDeleteResponse>,
  {
    channel: 'phase3:proxy:config-get',
    requestSchema: ProxyConfigGetRequestSchema,
    responseSchema: ProxyConfigGetResponseSchema
  } satisfies ChannelRegistryEntry<ProxyConfigGetRequest, ProxyConfigGetResponse>,
  {
    channel: 'phase3:proxy:config-set',
    requestSchema: ProxyConfigSetRequestSchema,
    responseSchema: ProxyConfigSetResponseSchema
  } satisfies ChannelRegistryEntry<ProxyConfigSetRequest, ProxyConfigSetResponse>,
  {
    channel: 'phase3:proxy:rotate',
    requestSchema: ProxyRotateRequestSchema,
    responseSchema: ProxyRotateResponseSchema
  } satisfies ChannelRegistryEntry<ProxyRotateRequest, ProxyRotateResponse>
] as const satisfies ReadonlyArray<ChannelRegistryEntry>

export * from './common'
export * from './settings'
export * from './shell'
export * from './license'
export * from './profile'
export * from './proxy'
