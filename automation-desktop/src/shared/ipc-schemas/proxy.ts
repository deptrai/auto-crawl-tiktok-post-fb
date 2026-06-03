import { z } from 'zod'
import { IpcErrorResponseSchema } from './common'

export const ProxyConfigGetRequestSchema = z.object({}).strict()

export const ProxyConfigSetRequestSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(500)
  })
  .strict()

export const ProxyRotateRequestSchema = z
  .object({
    profileId: z.string().min(1).optional()
  })
  .strict()

export const ProxyHealthRequestSchema = z.object({}).strict()

export const PublicProxyInfoSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().max(65535)
})

export const ProxyConfigGetSuccessResponseSchema = z.object({
  ok: z.literal(true),
  configured: z.boolean()
})

export const ProxyConfigGetResponseSchema = z.union([
  ProxyConfigGetSuccessResponseSchema,
  IpcErrorResponseSchema
])

export const ProxyConfigSetSuccessResponseSchema = z.object({
  ok: z.literal(true)
})

export const ProxyConfigSetResponseSchema = z.union([
  ProxyConfigSetSuccessResponseSchema,
  IpcErrorResponseSchema
])

export const ProxyRotateSuccessResponseSchema = z.object({
  ok: z.literal(true),
  proxy: PublicProxyInfoSchema
})

export const ProxyRotateResponseSchema = z.union([
  ProxyRotateSuccessResponseSchema,
  IpcErrorResponseSchema
])

export const ProxyHealthStatusSchema = z.object({
  state: z.enum(['healthy', 'quarantined']),
  configured: z.boolean(),
  cooldownRemainingMs: z.number().int().nonnegative().optional()
})

export const ProxyHealthSuccessResponseSchema = z.object({
  ok: z.literal(true),
  health: ProxyHealthStatusSchema
})

export const ProxyHealthResponseSchema = z.union([
  ProxyHealthSuccessResponseSchema,
  IpcErrorResponseSchema
])

export type ProxyConfigGetRequest = z.infer<typeof ProxyConfigGetRequestSchema>
export type ProxyConfigGetResponse = z.infer<typeof ProxyConfigGetResponseSchema>
export type ProxyConfigSetRequest = z.infer<typeof ProxyConfigSetRequestSchema>
export type ProxyConfigSetResponse = z.infer<typeof ProxyConfigSetResponseSchema>
export type ProxyRotateRequest = z.infer<typeof ProxyRotateRequestSchema>
export type ProxyRotateResponse = z.infer<typeof ProxyRotateResponseSchema>
export type ProxyHealthRequest = z.infer<typeof ProxyHealthRequestSchema>
export type ProxyHealthResponse = z.infer<typeof ProxyHealthResponseSchema>
export type ProxyHealthStatus = z.infer<typeof ProxyHealthStatusSchema>
export type PublicProxyInfo = z.infer<typeof PublicProxyInfoSchema>
