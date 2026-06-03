import { z } from 'zod'
import { IpcErrorResponseSchema } from './common'

// ---- Request ----

export const ProfileImportBulkRequestSchema = z.object({
  text: z.string().min(1).max(1_000_000)
})

export const ProfileListRequestSchema = z.object({}).strict()

export const ProfileUpdateRequestSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().trim().min(1).max(200)
})

export const ProfileDeleteRequestSchema = z.object({
  id: z.string().min(1)
})

// ---- Response payload ----

export const ImportedProfileSchema = z.object({
  id: z.string().min(1),
  uid: z.string().min(1),
  displayName: z.string().min(1),
  status: z.enum(['idle', 'active', 'error'])
})

export const SkippedEntrySchema = z.object({
  line: z.number().int().positive(),
  uid: z.string().min(1),
  reason: z.string().min(1)
})

export const FailedEntrySchema = z.object({
  line: z.number().int().positive(),
  uid: z.string().min(1).optional(),
  reason: z.string().min(1)
})

export const ImportResultSchema = z.object({
  total: z.number().int().min(0),
  imported: z.number().int().min(0),
  skipped: z.array(SkippedEntrySchema),
  failed: z.array(FailedEntrySchema),
  profiles: z.array(ImportedProfileSchema)
})

export const ProfileImportBulkSuccessResponseSchema = z.object({
  ok: z.literal(true),
  result: ImportResultSchema
})

export const ProfileImportBulkResponseSchema = z.union([
  ProfileImportBulkSuccessResponseSchema,
  IpcErrorResponseSchema
])

export const ProfileSummarySchema = z.object({
  id: z.string().min(1),
  uid: z.string().min(1),
  displayName: z.string().min(1),
  status: z.string().min(1),
  createdAt: z.string().min(1)
})

export const ProfileListSuccessResponseSchema = z.object({
  ok: z.literal(true),
  profiles: z.array(ProfileSummarySchema)
})

export const ProfileListResponseSchema = z.union([
  ProfileListSuccessResponseSchema,
  IpcErrorResponseSchema
])

export const ProfileUpdateSuccessResponseSchema = z.object({
  ok: z.literal(true),
  profile: ProfileSummarySchema
})

export const ProfileUpdateResponseSchema = z.union([
  ProfileUpdateSuccessResponseSchema,
  IpcErrorResponseSchema
])

export const ProfileDeleteSuccessResponseSchema = z.object({
  ok: z.literal(true)
})

export const ProfileDeleteResponseSchema = z.union([
  ProfileDeleteSuccessResponseSchema,
  IpcErrorResponseSchema
])

// ---- Types ----

export type ProfileImportBulkRequest = z.infer<typeof ProfileImportBulkRequestSchema>
export type ImportedProfile = z.infer<typeof ImportedProfileSchema>
export type ImportResult = z.infer<typeof ImportResultSchema>
export type ProfileImportBulkResponse = z.infer<typeof ProfileImportBulkResponseSchema>
export type ProfileListRequest = z.infer<typeof ProfileListRequestSchema>
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>
export type ProfileListResponse = z.infer<typeof ProfileListResponseSchema>
export type ProfileUpdateRequest = z.infer<typeof ProfileUpdateRequestSchema>
export type ProfileUpdateResponse = z.infer<typeof ProfileUpdateResponseSchema>
export type ProfileDeleteRequest = z.infer<typeof ProfileDeleteRequestSchema>
export type ProfileDeleteResponse = z.infer<typeof ProfileDeleteResponseSchema>
