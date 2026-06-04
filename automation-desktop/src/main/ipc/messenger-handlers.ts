import { randomUUID } from 'node:crypto'
import {
  MessengerStartRequestSchema,
  MessengerStartResponseSchema,
  MessengerStatusRequestSchema,
  MessengerStatusResponseSchema,
  type IpcErrorResponse,
  type MessengerStartResponse,
  type MessengerStatusResponse
} from '../../shared/ipc-schemas'
import type {
  AutomationStateMachine,
  MessengerSeedOrchestrator,
  MessengerTarget,
  runMessengerSeedBatch
} from '../automation'
import { isTerminal } from '../automation'
import type { AutomationJobRepository } from '../db/repositories/automation-job-repo'
import type { JobActionRepository } from '../db/repositories/job-action-repo'
import type { TargetListRepository } from '../db/repositories/target-list-repo'
import type { IpcMainLike } from './settings-handlers'

type MessengerBatchRunner = typeof runMessengerSeedBatch

function toErrorResponse(
  code: string,
  message: string,
  retryable = false,
  details?: unknown
): IpcErrorResponse {
  return { ok: false, error: { code, message, retryable, details } }
}

function parseError(details: unknown): IpcErrorResponse {
  return toErrorResponse('VALIDATION_ERROR', 'Dữ liệu yêu cầu không hợp lệ', false, details)
}

function normalizeError(error: unknown): IpcErrorResponse {
  void error
  return toErrorResponse('MESSENGER_ERROR', 'Không thể xử lý Messenger seeding.', false)
}

function missingTargetList(): IpcErrorResponse {
  return toErrorResponse('TARGET_LIST_NOT_FOUND', 'Không tìm thấy danh sách target.', false)
}

function parseJobReason(result: string | null): string | undefined {
  if (!result) return undefined
  try {
    const parsed = JSON.parse(result) as unknown
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const reason = (parsed as Record<string, unknown>)['reason']
    return typeof reason === 'string' && reason.trim() ? reason : undefined
  } catch {
    return undefined
  }
}

function terminalReason(state: string, result: string | null): string | undefined {
  const reason = parseJobReason(result)
  if (reason) return reason
  if (state === 'CHECKPOINT_BLOCKED') return 'CHECKPOINT'
  if (state === 'FAILED') return 'FAILED'
  if (state === 'CANCELLED') return 'CANCELLED'
  return undefined
}

export function registerMessengerHandlers(
  ipcMain: IpcMainLike,
  deps: {
    orchestrator: Pick<MessengerSeedOrchestrator, 'runMessengerSeed'>
    batch: MessengerBatchRunner
    stateMachine: Pick<AutomationStateMachine, 'createJob' | 'transition'>
    jobRepo: Pick<AutomationJobRepository, 'getJob'>
    jobActions: Pick<JobActionRepository, 'countByJob' | 'countSuccessByJob'>
    targetLists?: Pick<TargetListRepository, 'listExists' | 'linkJobs' | 'applyJobOutcomes'>
  }
): void {
  ipcMain.handle(
    'phase3:messenger:start',
    async (_event, request): Promise<MessengerStartResponse> => {
      const parsedRequest = MessengerStartRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return MessengerStartResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        if (parsedRequest.data.targetListId) {
          if (!deps.targetLists?.listExists(parsedRequest.data.targetListId)) {
            return MessengerStartResponseSchema.parse(missingTargetList())
          }
        }

        const jobIds = parsedRequest.data.profileIds.map((profileId) => {
          const jobId = randomUUID()
          deps.stateMachine.createJob({ id: jobId, profileId, type: 'messenger_seed' })
          return jobId
        })
        const jobByProfile = new Map(
          parsedRequest.data.profileIds.map((profileId, index) => [profileId, jobIds[index]])
        )
        const targets: MessengerTarget[] = parsedRequest.data.targets.map((target) => ({
          uid: target.uid,
          ...(target.name ? { name: target.name } : {})
        }))

        if (parsedRequest.data.targetListId) {
          try {
            const linked = deps.targetLists?.linkJobs({
              listId: parsedRequest.data.targetListId,
              jobIds,
              createdAt: new Date().toISOString()
            })
            if (linked !== jobIds.length) throw new Error('target list job link mismatch')
          } catch {
            for (const jobId of jobIds) {
              deps.stateMachine.transition(jobId, 'FAILED', {
                result: JSON.stringify({ reason: 'TARGET_LIST_LINK_FAILED' })
              })
            }
            return MessengerStartResponseSchema.parse(
              toErrorResponse(
                'TARGET_LIST_LINK_FAILED',
                'Không thể liên kết job với danh sách target.',
                false
              )
            )
          }
        }

        void deps
          .batch({
            profiles: parsedRequest.data.profileIds,
            targets,
            createJobId: (profileId) => jobByProfile.get(profileId) ?? randomUUID(),
            runProfile: (jobId, profileId, slice) =>
              deps.orchestrator.runMessengerSeed(jobId, profileId, { targets: slice })
          })
          .catch(() => undefined)

        return MessengerStartResponseSchema.parse({ ok: true, jobIds })
      } catch (error) {
        return MessengerStartResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle(
    'phase3:messenger:status',
    async (_event, request): Promise<MessengerStatusResponse> => {
      const parsedRequest = MessengerStatusRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return MessengerStatusResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        const jobs = parsedRequest.data.jobIds.map((jobId) => {
          const job = deps.jobRepo.getJob(jobId)
          if (!job)
            return { jobId, state: 'FAILED' as const, sent: 0, total: 0, reason: 'JOB_NOT_FOUND' }

          if (isTerminal(job.state)) {
            deps.targetLists?.applyJobOutcomes(jobId, new Date().toISOString())
          }

          const reason = terminalReason(job.state, job.result)
          return {
            jobId,
            state: job.state,
            sent: deps.jobActions.countSuccessByJob(jobId),
            total: deps.jobActions.countByJob(jobId),
            ...(reason ? { reason } : {})
          }
        })
        return MessengerStatusResponseSchema.parse({ ok: true, jobs })
      } catch (error) {
        return MessengerStatusResponseSchema.parse(normalizeError(error))
      }
    }
  )
}
