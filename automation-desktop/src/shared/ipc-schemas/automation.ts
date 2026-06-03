import { z } from 'zod'
import { IpcErrorResponseSchema } from './common'
import { AUTOMATION_JOB_STATES } from '../types/automation-job'

export const AutomationStartRequestSchema = z
  .object({
    profileId: z.string().min(1),
    target: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .refine((v) => /^https?:\/\//i.test(v), {
        message: 'URL phải bắt đầu bằng http:// hoặc https://'
      })
      .optional()
  })
  .strict()

export const AutomationStatusRequestSchema = z
  .object({
    jobId: z.string().min(1)
  })
  .strict()

export const AutomationStartSuccessResponseSchema = z.object({
  ok: z.literal(true),
  jobId: z.string().min(1)
})

export const AutomationStatusSuccessResponseSchema = z.object({
  ok: z.literal(true),
  state: z.enum(AUTOMATION_JOB_STATES),
  outcome: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  message: z.string().min(1).optional()
})

export const AutomationStartResponseSchema = z.union([
  AutomationStartSuccessResponseSchema,
  IpcErrorResponseSchema
])

export const AutomationStatusResponseSchema = z.union([
  AutomationStatusSuccessResponseSchema,
  IpcErrorResponseSchema
])

export type AutomationStartRequest = z.infer<typeof AutomationStartRequestSchema>
export type AutomationStatusRequest = z.infer<typeof AutomationStatusRequestSchema>
export type AutomationStartResponse = z.infer<typeof AutomationStartResponseSchema>
export type AutomationStatusResponse = z.infer<typeof AutomationStatusResponseSchema>
