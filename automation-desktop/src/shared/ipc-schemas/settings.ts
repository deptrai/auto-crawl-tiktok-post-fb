import { z } from 'zod'
import { IpcErrorResponseSchema } from './common'

export const SettingKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9_.:-]+$/)

export const SettingValueSchema = z.string().min(1).max(4096)

export const SettingsGetRequestSchema = z.object({
  key: SettingKeySchema
})

export const SettingsGetSuccessResponseSchema = z.object({
  ok: z.literal(true),
  value: z.string().nullable()
})

export const SettingsGetResponseSchema = z.union([
  SettingsGetSuccessResponseSchema,
  IpcErrorResponseSchema
])

export const SettingsSetRequestSchema = z.object({
  key: SettingKeySchema,
  value: SettingValueSchema
})

export const SettingsSetSuccessResponseSchema = z.object({
  ok: z.literal(true)
})

export const SettingsSetResponseSchema = z.union([
  SettingsSetSuccessResponseSchema,
  IpcErrorResponseSchema
])

export type SettingsGetRequest = z.infer<typeof SettingsGetRequestSchema>
export type SettingsGetResponse = z.infer<typeof SettingsGetResponseSchema>
export type SettingsSetRequest = z.infer<typeof SettingsSetRequestSchema>
export type SettingsSetResponse = z.infer<typeof SettingsSetResponseSchema>
