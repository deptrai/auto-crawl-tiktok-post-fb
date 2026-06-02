import { z } from 'zod'
import { IpcErrorResponseSchema } from './common'

export const ShellOpenExternalRequestSchema = z.object({
  url: z
    .string()
    .url()
    .refine(
      (value) => {
        const protocol = new URL(value).protocol
        return protocol === 'https:' || protocol === 'http:'
      },
      { message: 'Only http(s) URLs may be opened externally' }
    )
})

export const ShellOpenExternalSuccessResponseSchema = z.object({
  ok: z.literal(true)
})

export const ShellOpenExternalResponseSchema = z.union([
  ShellOpenExternalSuccessResponseSchema,
  IpcErrorResponseSchema
])

export type ShellOpenExternalRequest = z.infer<typeof ShellOpenExternalRequestSchema>
export type ShellOpenExternalResponse = z.infer<typeof ShellOpenExternalResponseSchema>
