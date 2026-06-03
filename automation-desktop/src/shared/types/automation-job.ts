export const AUTOMATION_JOB_STATES = [
  'PENDING',
  'ACQUIRING_PROXY',
  'LOGGING_IN',
  'SOLVING_CHECKPOINT',
  'WARMING_UP',
  'EXECUTING',
  'DONE',
  'CHECKPOINT_BLOCKED',
  'FAILED',
  'CANCELLED'
] as const

export type AutomationJobState = (typeof AUTOMATION_JOB_STATES)[number]

export const TERMINAL_STATES = new Set<AutomationJobState>([
  'DONE',
  'FAILED',
  'CANCELLED',
  'CHECKPOINT_BLOCKED'
])

export interface AutomationJob {
  id: string
  profileId: string
  type: string
  state: AutomationJobState
  startedAt: string
  completedAt: string | null
  /** JSON string only. Never store cookie, 2FA, password, CSRF, or access token here. */
  result: string | null
}
