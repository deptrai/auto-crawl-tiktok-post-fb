import type { AutomationJobState } from '../../shared/types/automation-job'
import type { ActionToken, ActionTokenClient } from '../license/action-token-client'
import type { ContentTemplateRepository } from '../db/repositories/content-template-repo'
import type { JobActionRepository } from '../db/repositories/job-action-repo'
import type { SessionTokens } from './token-extractor'
import type { AutomationStateMachine } from './state-machine'
import { executeSelfComment, type ActionOutcome, type CommentPageLike } from './action-executor'

const DEFAULT_OWN_FEED_URL = 'https://www.facebook.com/me'

export interface SelfCommentSession {
  page: CommentPageLike & {
    content?: () => Promise<string>
    goto?: (
      url: string,
      options?: { timeout?: number; waitUntil?: 'domcontentloaded' }
    ) => Promise<unknown>
    getAttribute?: (selector: string, name: string) => Promise<string | null>
  }
  close(): Promise<void>
}

export interface RunSelfCommentOptions {
  target?: string
}

export type SelfCommentLoginResult =
  | { ok: true; state: 'LOGGED_IN'; session: SelfCommentSession }
  | {
      ok: true
      state: 'CHECKPOINT' | 'TWO_FA_REQUIRED' | 'LOGIN_FAILED'
      session?: SelfCommentSession
    }
  | { ok: false; code: 'LOGIN_FAILED'; session?: SelfCommentSession }

export interface SelfCommentOrchestratorDeps {
  stateMachine: Pick<AutomationStateMachine, 'transition'>
  login: (jobId: string, profileId: string) => Promise<SelfCommentLoginResult>
  extractTokens: (page: SelfCommentSession['page']) => Promise<SessionTokens>
  actionTokenClient: Pick<ActionTokenClient, 'requestActionToken' | 'consumeActionToken'>
  contentTemplates: Pick<ContentTemplateRepository, 'getRandomTemplate'>
  actionExecutor: { executeSelfComment: typeof executeSelfComment }
  jobActions: Pick<JobActionRepository, 'recordAction'>
  now: () => string
  nowMs: () => number
  rng: () => number
  navigate?: (page: SelfCommentSession['page'], target: string) => Promise<void>
  resolveOwnPostTarget?: (page: SelfCommentSession['page']) => Promise<string | null>
  onActionOutcome?: (event: { outcome: ActionOutcome; durationMs: number }) => void
  onTransitionError?: (jobId: string, to: AutomationJobState, code: string) => void
}

export interface SelfCommentOrchestrator {
  runSelfComment(
    jobId: string,
    profileId: string,
    options?: RunSelfCommentOptions
  ): Promise<{ outcome: ActionOutcome }>
}

function transition(
  deps: SelfCommentOrchestratorDeps,
  jobId: string,
  to: AutomationJobState
): boolean {
  const result = deps.stateMachine.transition(jobId, to)
  if (!result.ok) {
    deps.onTransitionError?.(jobId, to, result.code)
    return false
  }
  return true
}

function record(
  deps: SelfCommentOrchestratorDeps,
  jobId: string,
  outcome: ActionOutcome,
  actionToken: ActionToken | null,
  target: string | null
): void {
  deps.jobActions.recordAction({
    jobId,
    actionType: 'comment',
    target,
    actionTokenJti: actionToken?.jti ?? null,
    executedAt: deps.now(),
    outcome
  })
}

function emit(deps: SelfCommentOrchestratorDeps, outcome: ActionOutcome, startedMs: number): void {
  deps.onActionOutcome?.({ outcome, durationMs: Math.max(0, deps.nowMs() - startedMs) })
}

async function navigateToTarget(
  deps: SelfCommentOrchestratorDeps,
  page: SelfCommentSession['page'],
  target: string
): Promise<void> {
  if (deps.navigate) {
    await deps.navigate(page, target)
    return
  }
  if (!page.goto) throw new Error('Self-comment page cannot navigate')
  await page.goto(target, { timeout: 30_000, waitUntil: 'domcontentloaded' })
}

export function createSelfCommentOrchestrator(
  deps: SelfCommentOrchestratorDeps
): SelfCommentOrchestrator {
  return {
    async runSelfComment(jobId, profileId, options = {}) {
      const startedMs = deps.nowMs()
      let session: SelfCommentSession | undefined
      let actionToken: ActionToken | null = null
      const explicitTarget = options.target?.trim()
      let target: string = explicitTarget ?? DEFAULT_OWN_FEED_URL

      try {
        transition(deps, jobId, 'ACQUIRING_PROXY')
        transition(deps, jobId, 'LOGGING_IN')

        const loginResult = await deps.login(jobId, profileId)
        session = loginResult.session
        if (!loginResult.ok || loginResult.state === 'LOGIN_FAILED') {
          transition(deps, jobId, 'FAILED')
          record(deps, jobId, 'error', null, explicitTarget ?? DEFAULT_OWN_FEED_URL)
          emit(deps, 'error', startedMs)
          return { outcome: 'error' }
        }
        if (loginResult.state === 'CHECKPOINT' || loginResult.state === 'TWO_FA_REQUIRED') {
          transition(deps, jobId, 'CHECKPOINT_BLOCKED')
          record(deps, jobId, 'checkpoint', null, explicitTarget ?? DEFAULT_OWN_FEED_URL)
          emit(deps, 'checkpoint', startedMs)
          return { outcome: 'checkpoint' }
        }

        const activeSession = loginResult.session
        if (!activeSession) {
          throw new Error('Login session is required for self-comment execution')
        }
        session = activeSession

        transition(deps, jobId, 'WARMING_UP')
        await deps.extractTokens(activeSession.page)

        const template = deps.contentTemplates.getRandomTemplate(deps.rng)
        if (!template) {
          transition(deps, jobId, 'FAILED')
          record(deps, jobId, 'error', null, explicitTarget ?? DEFAULT_OWN_FEED_URL)
          emit(deps, 'error', startedMs)
          return { outcome: 'error' }
        }

        // Resolve the navigation target:
        // 1. Use explicit target URL if provided.
        // 2. Otherwise navigate to own feed and attempt to find the first post URL via
        //    bundled selector (⚠️ fragile — Epic 5 will replace with 4-tier own-post finder).
        // 3. Fall back to own feed if no post URL found.
        if (explicitTarget) {
          target = explicitTarget
        } else {
          await navigateToTarget(deps, activeSession.page, DEFAULT_OWN_FEED_URL)
          const resolved = await deps.resolveOwnPostTarget?.(activeSession.page)
          target = resolved ?? DEFAULT_OWN_FEED_URL
        }

        actionToken = await deps.actionTokenClient.requestActionToken({ actionType: 'comment' })
        await navigateToTarget(deps, activeSession.page, target)
        transition(deps, jobId, 'EXECUTING')
        const outcome = await deps.actionExecutor.executeSelfComment({
          page: activeSession.page,
          content: template.body
        })
        await deps.actionTokenClient.consumeActionToken(actionToken.token).catch(() => undefined)
        record(deps, jobId, outcome, actionToken, target)
        emit(deps, outcome, startedMs)
        transition(deps, jobId, outcome === 'success' ? 'DONE' : 'FAILED')
        return { outcome }
      } catch {
        transition(deps, jobId, 'FAILED')
        record(deps, jobId, 'error', actionToken, target)
        emit(deps, 'error', startedMs)
        return { outcome: 'error' }
      } finally {
        await session?.close().catch(() => undefined)
      }
    }
  }
}
