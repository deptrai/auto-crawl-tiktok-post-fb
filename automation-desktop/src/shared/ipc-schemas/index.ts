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
  ProxyHealthRequestSchema,
  ProxyHealthResponseSchema,
  ProxyPoolAcquireRequestSchema,
  ProxyPoolAcquireResponseSchema,
  ProxyPoolListRequestSchema,
  ProxyPoolListResponseSchema,
  ProxyPoolReleaseRequestSchema,
  ProxyPoolReleaseResponseSchema,
  ProxyRotateRequestSchema,
  ProxyRotateResponseSchema,
  type ProxyConfigGetRequest,
  type ProxyConfigGetResponse,
  type ProxyConfigSetRequest,
  type ProxyConfigSetResponse,
  type ProxyHealthRequest,
  type ProxyHealthResponse,
  type ProxyPoolAcquireRequest,
  type ProxyPoolAcquireResponse,
  type ProxyPoolListRequest,
  type ProxyPoolListResponse,
  type ProxyPoolReleaseRequest,
  type ProxyPoolReleaseResponse,
  type ProxyRotateRequest,
  type ProxyRotateResponse
} from './proxy'
import {
  ContentTemplateCreateRequestSchema,
  ContentTemplateCreateResponseSchema,
  ContentTemplateDeleteRequestSchema,
  ContentTemplateDeleteResponseSchema,
  ContentTemplateListRequestSchema,
  ContentTemplateListResponseSchema,
  ContentTemplateUpdateRequestSchema,
  ContentTemplateUpdateResponseSchema,
  type ContentTemplateCreateRequest,
  type ContentTemplateCreateResponse,
  type ContentTemplateDeleteRequest,
  type ContentTemplateDeleteResponse,
  type ContentTemplateListRequest,
  type ContentTemplateListResponse,
  type ContentTemplateUpdateRequest,
  type ContentTemplateUpdateResponse
} from './content-template'
import {
  TargetListCreateRequestSchema,
  TargetListCreateResponseSchema,
  TargetListDeleteRequestSchema,
  TargetListDeleteResponseSchema,
  TargetListEntriesRequestSchema,
  TargetListEntriesResponseSchema,
  TargetListImportRequestSchema,
  TargetListImportResponseSchema,
  TargetListListRequestSchema,
  TargetListListResponseSchema,
  type TargetListCreateRequest,
  type TargetListCreateResponse,
  type TargetListDeleteRequest,
  type TargetListDeleteResponse,
  type TargetListEntriesRequest,
  type TargetListEntriesResponse,
  type TargetListImportRequest,
  type TargetListImportResponse,
  type TargetListListRequest,
  type TargetListListResponse
} from './target-list'
import {
  AutomationStartRequestSchema,
  AutomationStartResponseSchema,
  AutomationStatusRequestSchema,
  AutomationStatusResponseSchema,
  type AutomationStartRequest,
  type AutomationStartResponse,
  type AutomationStatusRequest,
  type AutomationStatusResponse
} from './automation'
import {
  MessengerStartRequestSchema,
  MessengerStartResponseSchema,
  MessengerStatusRequestSchema,
  MessengerStatusResponseSchema,
  type MessengerStartRequest,
  type MessengerStartResponse,
  type MessengerStatusRequest,
  type MessengerStatusResponse
} from './messenger'
import {
  CaptchaSetKeyRequestSchema,
  CaptchaSetKeyResponseSchema,
  CaptchaStatusRequestSchema,
  CaptchaStatusResponseSchema,
  type CaptchaSetKeyRequest,
  type CaptchaSetKeyResponse,
  type CaptchaStatusRequest,
  type CaptchaStatusResponse
} from './captcha'

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
  } satisfies ChannelRegistryEntry<ProxyRotateRequest, ProxyRotateResponse>,
  {
    channel: 'phase3:proxy:health',
    requestSchema: ProxyHealthRequestSchema,
    responseSchema: ProxyHealthResponseSchema
  } satisfies ChannelRegistryEntry<ProxyHealthRequest, ProxyHealthResponse>,
  {
    channel: 'phase3:proxy-pool:acquire',
    requestSchema: ProxyPoolAcquireRequestSchema,
    responseSchema: ProxyPoolAcquireResponseSchema
  } satisfies ChannelRegistryEntry<ProxyPoolAcquireRequest, ProxyPoolAcquireResponse>,
  {
    channel: 'phase3:proxy-pool:release',
    requestSchema: ProxyPoolReleaseRequestSchema,
    responseSchema: ProxyPoolReleaseResponseSchema
  } satisfies ChannelRegistryEntry<ProxyPoolReleaseRequest, ProxyPoolReleaseResponse>,
  {
    channel: 'phase3:proxy-pool:list',
    requestSchema: ProxyPoolListRequestSchema,
    responseSchema: ProxyPoolListResponseSchema
  } satisfies ChannelRegistryEntry<ProxyPoolListRequest, ProxyPoolListResponse>,
  {
    channel: 'phase3:content-template:list',
    requestSchema: ContentTemplateListRequestSchema,
    responseSchema: ContentTemplateListResponseSchema
  } satisfies ChannelRegistryEntry<ContentTemplateListRequest, ContentTemplateListResponse>,
  {
    channel: 'phase3:content-template:create',
    requestSchema: ContentTemplateCreateRequestSchema,
    responseSchema: ContentTemplateCreateResponseSchema
  } satisfies ChannelRegistryEntry<ContentTemplateCreateRequest, ContentTemplateCreateResponse>,
  {
    channel: 'phase3:content-template:update',
    requestSchema: ContentTemplateUpdateRequestSchema,
    responseSchema: ContentTemplateUpdateResponseSchema
  } satisfies ChannelRegistryEntry<ContentTemplateUpdateRequest, ContentTemplateUpdateResponse>,
  {
    channel: 'phase3:content-template:delete',
    requestSchema: ContentTemplateDeleteRequestSchema,
    responseSchema: ContentTemplateDeleteResponseSchema
  } satisfies ChannelRegistryEntry<ContentTemplateDeleteRequest, ContentTemplateDeleteResponse>,
  {
    channel: 'phase3:target-list:list',
    requestSchema: TargetListListRequestSchema,
    responseSchema: TargetListListResponseSchema
  } satisfies ChannelRegistryEntry<TargetListListRequest, TargetListListResponse>,
  {
    channel: 'phase3:target-list:create',
    requestSchema: TargetListCreateRequestSchema,
    responseSchema: TargetListCreateResponseSchema
  } satisfies ChannelRegistryEntry<TargetListCreateRequest, TargetListCreateResponse>,
  {
    channel: 'phase3:target-list:delete',
    requestSchema: TargetListDeleteRequestSchema,
    responseSchema: TargetListDeleteResponseSchema
  } satisfies ChannelRegistryEntry<TargetListDeleteRequest, TargetListDeleteResponse>,
  {
    channel: 'phase3:target-list:entries',
    requestSchema: TargetListEntriesRequestSchema,
    responseSchema: TargetListEntriesResponseSchema
  } satisfies ChannelRegistryEntry<TargetListEntriesRequest, TargetListEntriesResponse>,
  {
    channel: 'phase3:target-list:import',
    requestSchema: TargetListImportRequestSchema,
    responseSchema: TargetListImportResponseSchema
  } satisfies ChannelRegistryEntry<TargetListImportRequest, TargetListImportResponse>,
  {
    channel: 'phase3:automation:start',
    requestSchema: AutomationStartRequestSchema,
    responseSchema: AutomationStartResponseSchema
  } satisfies ChannelRegistryEntry<AutomationStartRequest, AutomationStartResponse>,
  {
    channel: 'phase3:automation:status',
    requestSchema: AutomationStatusRequestSchema,
    responseSchema: AutomationStatusResponseSchema
  } satisfies ChannelRegistryEntry<AutomationStatusRequest, AutomationStatusResponse>,
  {
    channel: 'phase3:messenger:start',
    requestSchema: MessengerStartRequestSchema,
    responseSchema: MessengerStartResponseSchema
  } satisfies ChannelRegistryEntry<MessengerStartRequest, MessengerStartResponse>,
  {
    channel: 'phase3:messenger:status',
    requestSchema: MessengerStatusRequestSchema,
    responseSchema: MessengerStatusResponseSchema
  } satisfies ChannelRegistryEntry<MessengerStatusRequest, MessengerStatusResponse>,
  {
    channel: 'phase3:captcha:set-key',
    requestSchema: CaptchaSetKeyRequestSchema,
    responseSchema: CaptchaSetKeyResponseSchema
  } satisfies ChannelRegistryEntry<CaptchaSetKeyRequest, CaptchaSetKeyResponse>,
  {
    channel: 'phase3:captcha:status',
    requestSchema: CaptchaStatusRequestSchema,
    responseSchema: CaptchaStatusResponseSchema
  } satisfies ChannelRegistryEntry<CaptchaStatusRequest, CaptchaStatusResponse>
] as const satisfies ReadonlyArray<ChannelRegistryEntry>

export * from './common'
export * from './settings'
export * from './shell'
export * from './license'
export * from './profile'
export * from './proxy'
export * from './content-template'
export * from './target-list'
export * from './automation'
export * from './messenger'
export * from './captcha'
