import { z } from 'zod'
import { IpcErrorResponseSchema } from './common'

export const LicensePublicStatusSchema = z.object({
  active: z.boolean(),
  gate: z.enum(['active', 'offline-grace', 'expired-readonly', 'locked']),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  daysRemaining: z.number().int().min(0).optional(),
  offlineGraceValid: z.boolean().optional(),
  expiredReadonlyValid: z.boolean().optional()
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

export const LicenseCheckRequestSchema = z.object({}).strict()

export const LicenseCheckSuccessResponseSchema = z.object({
  ok: z.literal(true),
  status: LicensePublicStatusSchema
})

export const LicenseCheckResponseSchema = z.union([
  LicenseCheckSuccessResponseSchema,
  IpcErrorResponseSchema
])

/**
 * Push channel: main → renderer. Emitted by the background license checker
 * after every successful periodic check so the UI gate reacts in real time to
 * expiry/revocation without waiting for an app restart. Payload is validated
 * with LicensePublicStatusSchema on the renderer side.
 */
export const LICENSE_CHANGED_CHANNEL = 'phase3:license:changed' as const
export const LicenseChangedEventSchema = LicensePublicStatusSchema

export type LicensePublicStatus = z.infer<typeof LicensePublicStatusSchema>
export type LicenseActivateRequest = z.infer<typeof LicenseActivateRequestSchema>
export type LicenseActivateResponse = z.infer<typeof LicenseActivateResponseSchema>
export type LicenseStatusRequest = z.infer<typeof LicenseStatusRequestSchema>
export type LicenseStatusResponse = z.infer<typeof LicenseStatusResponseSchema>
export type LicenseCheckRequest = z.infer<typeof LicenseCheckRequestSchema>
export type LicenseCheckResponse = z.infer<typeof LicenseCheckResponseSchema>
