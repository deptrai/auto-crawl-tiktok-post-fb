import type { AutomationStartResponse, AutomationStatusResponse } from '../../../shared/ipc-schemas'
import type { AutomationJobState } from '../../../shared/types/automation-job'

export interface AutomationStatusView {
  state: AutomationJobState
  outcome?: string
}

function assertOk<T extends { ok: boolean; error?: { message: string } }>(
  response: T
): asserts response is T & { ok: true } {
  if (!response.ok) throw new Error(response.error?.message ?? 'IPC request failed')
}

export async function startSelfComment(input: {
  profileId: string
  target?: string
}): Promise<{ jobId: string }> {
  const response = await window.api.ipc.call<
    'phase3:automation:start',
    { profileId: string; target?: string },
    AutomationStartResponse
  >('phase3:automation:start', input)
  assertOk(response)
  return { jobId: response.jobId }
}

export async function getAutomationStatus(jobId: string): Promise<AutomationStatusView> {
  const response = await window.api.ipc.call<
    'phase3:automation:status',
    { jobId: string },
    AutomationStatusResponse
  >('phase3:automation:status', { jobId })
  assertOk(response)
  return { state: response.state, outcome: response.outcome }
}
