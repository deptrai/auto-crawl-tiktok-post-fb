import { z } from 'zod'
import { IpcErrorResponseSchema } from './common'

export const ContentTemplateListRequestSchema = z.object({}).strict()

export const ContentTemplateCreateRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(2_000)
  })
  .strict()

export const ContentTemplateUpdateRequestSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(2_000)
  })
  .strict()

export const ContentTemplateDeleteRequestSchema = z
  .object({
    id: z.string().min(1)
  })
  .strict()

export const ContentTemplateSummarySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  body: z.string().min(1),
  createdAt: z.string().min(1)
})

export const ContentTemplateListSuccessResponseSchema = z.object({
  ok: z.literal(true),
  templates: z.array(ContentTemplateSummarySchema)
})

export const ContentTemplateCreateSuccessResponseSchema = z.object({
  ok: z.literal(true),
  template: ContentTemplateSummarySchema
})

export const ContentTemplateUpdateSuccessResponseSchema = z.object({
  ok: z.literal(true),
  template: ContentTemplateSummarySchema
})

export const ContentTemplateDeleteSuccessResponseSchema = z.object({
  ok: z.literal(true)
})

export const ContentTemplateListResponseSchema = z.union([
  ContentTemplateListSuccessResponseSchema,
  IpcErrorResponseSchema
])
export const ContentTemplateCreateResponseSchema = z.union([
  ContentTemplateCreateSuccessResponseSchema,
  IpcErrorResponseSchema
])
export const ContentTemplateUpdateResponseSchema = z.union([
  ContentTemplateUpdateSuccessResponseSchema,
  IpcErrorResponseSchema
])
export const ContentTemplateDeleteResponseSchema = z.union([
  ContentTemplateDeleteSuccessResponseSchema,
  IpcErrorResponseSchema
])

export type ContentTemplateListRequest = z.infer<typeof ContentTemplateListRequestSchema>
export type ContentTemplateCreateRequest = z.infer<typeof ContentTemplateCreateRequestSchema>
export type ContentTemplateUpdateRequest = z.infer<typeof ContentTemplateUpdateRequestSchema>
export type ContentTemplateDeleteRequest = z.infer<typeof ContentTemplateDeleteRequestSchema>
export type ContentTemplateSummary = z.infer<typeof ContentTemplateSummarySchema>
export type ContentTemplateListResponse = z.infer<typeof ContentTemplateListResponseSchema>
export type ContentTemplateCreateResponse = z.infer<typeof ContentTemplateCreateResponseSchema>
export type ContentTemplateUpdateResponse = z.infer<typeof ContentTemplateUpdateResponseSchema>
export type ContentTemplateDeleteResponse = z.infer<typeof ContentTemplateDeleteResponseSchema>
