import { z } from 'zod'
import { IpcErrorResponseSchema } from './common'

export const TargetListFilterSchema = z.enum(['all', 'unsent', 'sent', 'error'])

export const TargetListListRequestSchema = z.object({}).strict()

export const TargetListCreateRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(120)
  })
  .strict()

export const TargetListDeleteRequestSchema = z
  .object({
    id: z.string().trim().min(1)
  })
  .strict()

export const TargetListEntriesRequestSchema = z
  .object({
    listId: z.string().trim().min(1),
    filter: TargetListFilterSchema.default('all')
  })
  .strict()

export const TargetListImportEntrySchema = z
  .object({
    uid: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(240).optional()
  })
  .strict()

export const TargetListImportRequestSchema = z
  .object({
    listId: z.string().trim().min(1),
    entries: z.array(TargetListImportEntrySchema).min(1).max(50_000)
  })
  .strict()

export const TargetListSummarySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  createdAt: z.string().min(1),
  total: z.number().int().min(0),
  sent: z.number().int().min(0),
  unsent: z.number().int().min(0),
  error: z.number().int().min(0)
})

export const TargetListEntrySchema = z.object({
  listId: z.string().min(1),
  uid: z.string().min(1),
  name: z.string().min(1).optional(),
  sentAt: z.string().min(1).optional(),
  failedAt: z.string().min(1).optional(),
  lastOutcome: z.string().min(1).optional(),
  lastErrorReason: z.string().min(1).optional(),
  createdAt: z.string().min(1)
})

export const TargetListImportResultSchema = z.object({
  created: z.number().int().min(0),
  skippedDuplicate: z.number().int().min(0),
  total: z.number().int().min(0)
})

export const TargetListListSuccessResponseSchema = z.object({
  ok: z.literal(true),
  lists: z.array(TargetListSummarySchema)
})

export const TargetListCreateSuccessResponseSchema = z.object({
  ok: z.literal(true),
  list: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    createdAt: z.string().min(1)
  })
})

export const TargetListDeleteSuccessResponseSchema = z.object({ ok: z.literal(true) })

export const TargetListEntriesSuccessResponseSchema = z.object({
  ok: z.literal(true),
  entries: z.array(TargetListEntrySchema)
})

export const TargetListImportSuccessResponseSchema = z.object({
  ok: z.literal(true),
  result: TargetListImportResultSchema
})

export const TargetListListResponseSchema = z.union([
  TargetListListSuccessResponseSchema,
  IpcErrorResponseSchema
])
export const TargetListCreateResponseSchema = z.union([
  TargetListCreateSuccessResponseSchema,
  IpcErrorResponseSchema
])
export const TargetListDeleteResponseSchema = z.union([
  TargetListDeleteSuccessResponseSchema,
  IpcErrorResponseSchema
])
export const TargetListEntriesResponseSchema = z.union([
  TargetListEntriesSuccessResponseSchema,
  IpcErrorResponseSchema
])
export const TargetListImportResponseSchema = z.union([
  TargetListImportSuccessResponseSchema,
  IpcErrorResponseSchema
])

export type TargetListFilter = z.infer<typeof TargetListFilterSchema>
export type TargetListListRequest = z.infer<typeof TargetListListRequestSchema>
export type TargetListCreateRequest = z.infer<typeof TargetListCreateRequestSchema>
export type TargetListDeleteRequest = z.infer<typeof TargetListDeleteRequestSchema>
export type TargetListEntriesRequest = z.infer<typeof TargetListEntriesRequestSchema>
export type TargetListImportRequest = z.infer<typeof TargetListImportRequestSchema>
export type TargetListSummary = z.infer<typeof TargetListSummarySchema>
export type TargetListEntry = z.infer<typeof TargetListEntrySchema>
export type TargetListImportResult = z.infer<typeof TargetListImportResultSchema>
export type TargetListListResponse = z.infer<typeof TargetListListResponseSchema>
export type TargetListCreateResponse = z.infer<typeof TargetListCreateResponseSchema>
export type TargetListDeleteResponse = z.infer<typeof TargetListDeleteResponseSchema>
export type TargetListEntriesResponse = z.infer<typeof TargetListEntriesResponseSchema>
export type TargetListImportResponse = z.infer<typeof TargetListImportResponseSchema>
