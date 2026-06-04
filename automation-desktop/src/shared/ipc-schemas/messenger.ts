import { z } from 'zod'
import { IpcErrorResponseSchema } from './common'
import { AUTOMATION_JOB_STATES } from '../types/automation-job'

export const MessengerTargetSchema = z
  .object({
    uid: z.string().trim().min(1),
    name: z.string().trim().min(1).optional()
  })
  .strict()

export const MessengerStartRequestSchema = z
  .object({
    profileIds: z
      .array(z.string().trim().min(1))
      .min(1)
      .refine((profileIds) => new Set(profileIds).size === profileIds.length, {
        message: 'profileIds must be unique'
      }),
    targets: z.array(MessengerTargetSchema).min(1),
    targetListId: z.string().trim().min(1).optional()
  })
  .strict()

export const MessengerStatusRequestSchema = z
  .object({
    jobIds: z.array(z.string().trim().min(1)).min(1)
  })
  .strict()

export const MessengerStartSuccessResponseSchema = z.object({
  ok: z.literal(true),
  jobIds: z.array(z.string().min(1)).min(1)
})

export const MessengerJobStatusSchema = z.object({
  jobId: z.string().min(1),
  state: z.enum(AUTOMATION_JOB_STATES),
  sent: z.number().int().min(0),
  total: z.number().int().min(0),
  reason: z.string().min(1).optional()
})

export const MessengerStatusSuccessResponseSchema = z.object({
  ok: z.literal(true),
  jobs: z.array(MessengerJobStatusSchema)
})

export const MessengerStartResponseSchema = z.union([
  MessengerStartSuccessResponseSchema,
  IpcErrorResponseSchema
])

export const MessengerStatusResponseSchema = z.union([
  MessengerStatusSuccessResponseSchema,
  IpcErrorResponseSchema
])

export type MessengerTargetPayload = z.infer<typeof MessengerTargetSchema>
export type MessengerStartRequest = z.infer<typeof MessengerStartRequestSchema>
export type MessengerStatusRequest = z.infer<typeof MessengerStatusRequestSchema>
export type MessengerJobStatus = z.infer<typeof MessengerJobStatusSchema>
export type MessengerStartResponse = z.infer<typeof MessengerStartResponseSchema>
export type MessengerStatusResponse = z.infer<typeof MessengerStatusResponseSchema>
