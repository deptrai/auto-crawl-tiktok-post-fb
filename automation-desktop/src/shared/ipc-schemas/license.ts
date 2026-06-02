import { z } from 'zod'
import { IpcErrorResponseSchema } from './common'

export const LicensePublicStatusSchema = z.object({
  active: z.boolean(),
  expiresAt: z.string().datetime().optional(),
  daysRemaining: z.number().int().min(0).optional()
})

export const LicenseActivateRequestSchema = z.object({
  key: z.string().min(1).max(128)
})

export const LicenseActivateSuccessResponseSchema = z.object({
  ok: z.literal(true),
  status: LicensePublicStatusSchema
})

export const LicenseActivateResponseSchema = z.union([
  LicenseActivateSuccessResponseSchema,
  IpcErrorResponseSchema
])

export const LicenseStatusRequestSchema = z.object({}).strict()

export const LicenseStatusSuccessResponseSchema = z.object({
  ok: z.literal(true),
  status: LicensePublicStatusSchema
})

export const LicenseStatusResponseSchema = z.union([
  LicenseStatusSuccessResponseSchema,
  IpcErrorResponseSchema
])

export type LicensePublicStatus = z.infer<typeof LicensePublicStatusSchema>
export type LicenseActivateRequest = z.infer<typeof LicenseActivateRequestSchema>
export type LicenseActivateResponse = z.infer<typeof LicenseActivateResponseSchema>
export type LicenseStatusRequest = z.infer<typeof LicenseStatusRequestSchema>
export type LicenseStatusResponse = z.infer<typeof LicenseStatusResponseSchema>
