import { randomUUID } from 'node:crypto'
import {
  AutomationStartRequestSchema,
  AutomationStartResponseSchema,
  AutomationStatusRequestSchema,
  AutomationStatusResponseSchema,
  type AutomationStartResponse,
  type AutomationStatusResponse,
  type IpcErrorResponse
} from '../../shared/ipc-schemas'
import type { AutomationStateMachine, SelfCommentOrchestrator } from '../automation'
import type { AutomationJobRepository } from '../db/repositories/automation-job-repo'
import type { JobActionRepository } from '../db/repositories/job-action-repo'
import type { IpcMainLike } from './settings-handlers'

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
  return toErrorResponse('AUTOMATION_ERROR', 'Không thể xử lý automation.', false)
}

function stateOutcome(state: string): string | undefined {
  if (state === 'DONE') return 'success'
  if (state === 'CHECKPOINT_BLOCKED') return 'checkpoint'
  if (state === 'FAILED') return 'error'
  return undefined
}

export function registerAutomationHandlers(
  ipcMain: IpcMainLike,
  deps: {
    orchestrator: Pick<SelfCommentOrchestrator, 'runSelfComment'>
    stateMachine: Pick<AutomationStateMachine, 'createJob'>
    jobRepo: Pick<AutomationJobRepository, 'getJob'>
    jobActions?: Pick<JobActionRepository, 'getLatestByJob'>
  }
): void {
  ipcMain.handle(
    'phase3:automation:start',
    async (_event, request): Promise<AutomationStartResponse> => {
      const parsedRequest = AutomationStartRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return AutomationStartResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        const jobId = randomUUID()
        deps.stateMachine.createJob({
          id: jobId,
          profileId: parsedRequest.data.profileId,
          type: 'self_comment'
        })
        void deps.orchestrator
          .runSelfComment(jobId, parsedRequest.data.profileId, {
            target: parsedRequest.data.target
          })
          .catch(() => undefined)
        return AutomationStartResponseSchema.parse({ ok: true, jobId })
      } catch (error) {
        return AutomationStartResponseSchema.parse(normalizeError(error))
      }
    }
  )

  ipcMain.handle(
    'phase3:automation:status',
    async (_event, request): Promise<AutomationStatusResponse> => {
      const parsedRequest = AutomationStatusRequestSchema.safeParse(request)
      if (!parsedRequest.success)
        return AutomationStatusResponseSchema.parse(parseError(parsedRequest.error.flatten()))

      try {
        const job = deps.jobRepo.getJob(parsedRequest.data.jobId)
        if (!job) {
          return AutomationStatusResponseSchema.parse(
            toErrorResponse('JOB_NOT_FOUND', 'Không tìm thấy job automation.', false)
          )
        }
        const latest = deps.jobActions?.getLatestByJob(job.id)
        return AutomationStatusResponseSchema.parse({
          ok: true,
          state: job.state,
          outcome: latest?.outcome ?? stateOutcome(job.state)
        })
      } catch (error) {
        return AutomationStatusResponseSchema.parse(normalizeError(error))
      }
    }
  )
}
