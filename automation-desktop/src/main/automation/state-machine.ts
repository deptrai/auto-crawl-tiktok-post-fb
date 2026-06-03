import type { AutomationJob, AutomationJobState } from '../../shared/types/automation-job'
import { TERMINAL_STATES } from '../../shared/types/automation-job'
import type {
  AutomationJobRepository,
  CreateAutomationJobParams
} from '../db/repositories/automation-job-repo'

export const TRANSITIONS: Record<AutomationJobState, readonly AutomationJobState[]> = {
  PENDING: ['ACQUIRING_PROXY', 'FAILED', 'CANCELLED'],
  ACQUIRING_PROXY: ['LOGGING_IN', 'FAILED', 'CANCELLED'],
  LOGGING_IN: ['SOLVING_CHECKPOINT', 'WARMING_UP', 'CHECKPOINT_BLOCKED', 'FAILED', 'CANCELLED'],
  SOLVING_CHECKPOINT: ['WARMING_UP', 'CHECKPOINT_BLOCKED', 'FAILED', 'CANCELLED'],
  WARMING_UP: ['EXECUTING', 'FAILED', 'CANCELLED'],
  EXECUTING: ['DONE', 'FAILED', 'CANCELLED'],
  DONE: [],
  CHECKPOINT_BLOCKED: [],
  FAILED: [],
  CANCELLED: []
}

export type AutomationTransitionErrorCode = 'JOB_NOT_FOUND' | 'JOB_TERMINAL' | 'INVALID_TRANSITION'

export type AutomationTransitionResult =
  | { ok: true; job: AutomationJob }
  | { ok: false; code: 'JOB_NOT_FOUND' }
  | { ok: false; code: 'JOB_TERMINAL'; from: AutomationJobState }
  | { ok: false; code: 'INVALID_TRANSITION'; from: AutomationJobState; to: AutomationJobState }

export interface CreateAutomationJobInput {
  id: string
  profileId: string
  type: string
}

export interface TransitionOptions {
  result?: string | null
}

export interface AutomationStateMachine {
  createJob(input: CreateAutomationJobInput): AutomationJob
  transition(
    jobId: string,
    to: AutomationJobState,
    options?: TransitionOptions
  ): AutomationTransitionResult
}

export interface AutomationStateMachineDeps {
  repo: Pick<AutomationJobRepository, 'createJob' | 'getJob' | 'updateState'>
  now: () => string
}

export function isTerminal(state: AutomationJobState): boolean {
  return TERMINAL_STATES.has(state)
}

export function canTransition(from: AutomationJobState, to: AutomationJobState): boolean {
  return TRANSITIONS[from].includes(to)
}

export function createStateMachine(deps: AutomationStateMachineDeps): AutomationStateMachine {
  return {
    createJob(input) {
      const params: CreateAutomationJobParams = {
        id: input.id,
        profileId: input.profileId,
        type: input.type,
        state: 'PENDING',
        startedAt: deps.now()
      }
      deps.repo.createJob(params)
      return {
        ...params,
        completedAt: null,
        result: null
      }
    },

    transition(jobId, to, options = {}) {
      const job = deps.repo.getJob(jobId)
      if (!job) return { ok: false, code: 'JOB_NOT_FOUND' }
      if (isTerminal(job.state)) return { ok: false, code: 'JOB_TERMINAL', from: job.state }
      if (!canTransition(job.state, to)) {
        return { ok: false, code: 'INVALID_TRANSITION', from: job.state, to }
      }

      const terminal = isTerminal(to)
      const completedAt = terminal ? deps.now() : undefined
      const result = terminal ? (options.result ?? null) : null
      deps.repo.updateState(jobId, to, { completedAt, result })

      return {
        ok: true,
        job: {
          ...job,
          state: to,
          completedAt: completedAt ?? null,
          result
        }
      }
    }
  }
}
