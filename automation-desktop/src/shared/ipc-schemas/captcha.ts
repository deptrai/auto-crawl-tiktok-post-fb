import { z } from 'zod'
import { IpcErrorResponseSchema } from './common'

export const CaptchaProviderSchema = z.enum(['capsolver', '2captcha'])

export const CaptchaSetKeyRequestSchema = z
  .object({
    provider: CaptchaProviderSchema,
    apiKey: z.string().trim().min(1).max(4096)
  })
  .strict()

export const CaptchaSetKeySuccessResponseSchema = z
  .object({
    ok: z.literal(true)
  })
  .strict()

export const CaptchaSetKeyResponseSchema = z.union([
  CaptchaSetKeySuccessResponseSchema,
  IpcErrorResponseSchema
])

export const CaptchaStatusRequestSchema = z.object({}).strict()

export const CaptchaStatusSuccessResponseSchema = z
  .object({
    ok: z.literal(true),
    capsolverConfigured: z.boolean(),
    twoCaptchaConfigured: z.boolean(),
    enabled: z.boolean()
  })
  .strict()

export const CaptchaStatusResponseSchema = z.union([
  CaptchaStatusSuccessResponseSchema,
  IpcErrorResponseSchema
])

export type CaptchaProvider = z.infer<typeof CaptchaProviderSchema>
export type CaptchaSetKeyRequest = z.infer<typeof CaptchaSetKeyRequestSchema>
export type CaptchaSetKeyResponse = z.infer<typeof CaptchaSetKeyResponseSchema>
export type CaptchaStatusRequest = z.infer<typeof CaptchaStatusRequestSchema>
export type CaptchaStatusResponse = z.infer<typeof CaptchaStatusResponseSchema>
