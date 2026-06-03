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

const SAFE_REASON_MESSAGES: Record<string, string> = {
  COOKIE_MISSING: 'Không tìm thấy cookie đã lưu cho profile này. Hãy import lại profile.',
  COOKIE_DECRYPT_FAILED:
    'Cookie đã lưu nhưng không giải mã được. Hãy xóa profile này rồi import lại profile.',
  COOKIE_PARSE_FAILED: 'Cookie đã lưu không đúng định dạng name=value. Hãy import lại đúng format.',
  FINGERPRINT_FAILED: 'Không tạo được fingerprint cho profile.',
  BROWSER_LAUNCH_FAILED: 'Không mở được Chromium để đăng nhập Facebook.',
  LOGIN_STATE_FAILED: 'Cookie không vào được Facebook hoặc phiên đăng nhập đã hết hạn.',
  LOGIN_FAILED: 'Đăng nhập Facebook thất bại.',
  TWO_FA_REQUIRED: 'Facebook yêu cầu 2FA. Profile chưa có seed 2FA hoặc mã không hợp lệ.',
  CHECKPOINT_BLOCKED: 'Facebook đang chặn checkpoint, cần xử lý thủ công.',
  TEMPLATE_MISSING: 'Chưa có template nội dung để bình luận.',
  TARGET_POST_NOT_FOUND:
    'Không tìm được URL bài viết cụ thể trên profile. Hãy dán URL post đích rồi chạy lại.',
  ACTION_EXECUTION_FAILED: 'Không thực hiện được thao tác bình luận trên trang.',
  AUTOMATION_FAILED: 'Automation thất bại trước khi thực hiện bình luận.',
  STUB_MODE_NO_COMMENT: 'Đang chạy chế độ mô phỏng nên chưa bình luận thật lên Facebook.'
}

function parseJobResult(result: string | null): {
  outcome?: string
  reason?: string
  message?: string
} {
  if (!result) return {}
  try {
    const parsed = JSON.parse(result) as unknown
    if (typeof parsed !== 'object' || parsed === null) return {}
    const record = parsed as Record<string, unknown>
    const outcome = typeof record['outcome'] === 'string' ? record['outcome'] : undefined
    const reason = typeof record['reason'] === 'string' ? record['reason'] : undefined
    return {
      ...(outcome ? { outcome } : {}),
      ...(reason ? { reason, message: SAFE_REASON_MESSAGES[reason] ?? reason } : {})
    }
  } catch {
    return {}
  }
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
        const result = parseJobResult(job.result)
        return AutomationStatusResponseSchema.parse({
          ok: true,
          state: job.state,
          outcome: latest?.outcome ?? result.outcome ?? stateOutcome(job.state),
          ...(latest?.target ? { target: latest.target } : {}),
          ...(result.reason ? { reason: result.reason } : {}),
          ...(result.message ? { message: result.message } : {})
        })
      } catch (error) {
        return AutomationStatusResponseSchema.parse(normalizeError(error))
      }
    }
  )
}
