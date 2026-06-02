import { z } from 'zod'

export const ErrorEnvelopeSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  details: z.unknown().optional()
})

export const IpcErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: ErrorEnvelopeSchema
})

export type IpcErrorResponse = z.infer<typeof IpcErrorResponseSchema>
