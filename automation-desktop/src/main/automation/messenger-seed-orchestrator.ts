import type { AutomationJobState } from '../../shared/types/automation-job'
import {
  renderContentTemplate,
  type ContentTemplateVars
} from '../../shared/content-template-render'
import type { ActionToken, ActionTokenClient } from '../license/action-token-client'
import type { ContentTemplateRepository } from '../db/repositories/content-template-repo'
import type { JobActionRepository } from '../db/repositories/job-action-repo'
import type { SessionTokens } from './token-extractor'
import type { AutomationStateMachine } from './state-machine'
import type { ActionOutcome, CommentPageLike } from './action-executor'
import { executeMessengerSeed } from './messenger-seed-executor'

const DEFAULT_DELAY_MIN_MS = 1_000
const DEFAULT_DELAY_MAX_MS = 3_000

export interface MessengerTarget {
  uid: string
  name?: string
}

export interface MessengerSeedTargetResult {
  uid: string
  outcome: ActionOutcome
  reason?: string
}

export interface MessengerSeedResult {
  profileId: string
  sent: number
  failed: number
  stoppedReason?: string
  perTarget: MessengerSeedTargetResult[]
}

export interface MessengerSeedSession {
  page: CommentPageLike & {
    goto?: (
      url: string,
      options?: { timeout?: number; waitUntil?: 'domcontentloaded' }
    ) => Promise<unknown>
  }
  close(): Promise<void>
}

export type MessengerSeedLoginResult =
  | { ok: true; state: 'LOGGED_IN'; session: MessengerSeedSession }
  | {
      ok: true
      state: 'CHECKPOINT' | 'TWO_FA_REQUIRED' | 'LOGIN_FAILED'
      session?: MessengerSeedSession
      reason?: string
      keepSessionOpen?: boolean
    }
  | {
      ok: false
      code: 'LOGIN_FAILED'
      session?: MessengerSeedSession
      reason?: string
      keepSessionOpen?: boolean
    }

export interface RunMessengerSeedOptions {
  targets: MessengerTarget[]
}

export interface MessengerSeedOrchestratorDeps {
  stateMachine: Pick<AutomationStateMachine, 'transition'>
  login: (jobId: string, profileId: string) => Promise<MessengerSeedLoginResult>
  extractTokens?: (page: MessengerSeedSession['page']) => Promise<SessionTokens>
  actionTokenClient: Pick<ActionTokenClient, 'requestActionToken' | 'consumeActionToken'>
  contentTemplates: Pick<ContentTemplateRepository, 'getRandomTemplate'>
  actionExecutor: { executeMessengerSeed: typeof executeMessengerSeed }
  jobActions: Pick<JobActionRepository, 'recordAction'>
  render?: (body: string, vars: ContentTemplateVars) => string
  navigate?: (page: MessengerSeedSession['page'], target: string) => Promise<void>
  sleep: (ms: number) => Promise<void>
  rng: () => number
  now: () => string
  nowMs: () => number
  delayRangeMs?: { min: number; max: number }
  isProfileWarm?: (profileId: string) => boolean
  onActionOutcome?: (event: { outcome: ActionOutcome; durationMs: number }) => void
  onTransitionError?: (jobId: string, to: AutomationJobState, code: string) => void
}

export interface MessengerSeedOrchestrator {
  runMessengerSeed(
    jobId: string,
    profileId: string,
    options: RunMessengerSeedOptions
  ): Promise<MessengerSeedResult>
}

function transition(
  deps: MessengerSeedOrchestratorDeps,
  jobId: string,
  to: AutomationJobState,
  options?: { result?: string | null }
): boolean {
  const result = deps.stateMachine.transition(jobId, to, options)
  if (!result.ok) {
    deps.onTransitionError?.(jobId, to, result.code)
    return false
  }
  return true
}

function safeResult(params: {
  outcome: ActionOutcome
  reason?: string
  sent: number
  total: number
}): string {
  return JSON.stringify(
    params.reason
      ? { outcome: params.outcome, reason: params.reason, sent: params.sent, total: params.total }
      : { outcome: params.outcome, sent: params.sent, total: params.total }
  )
}

function record(
  deps: MessengerSeedOrchestratorDeps,
  jobId: string,
  target: string,
  outcome: ActionOutcome,
  actionToken: ActionToken | null
): void {
  deps.jobActions.recordAction({
    jobId,
    actionType: 'message',
    target,
    actionTokenJti: actionToken?.jti ?? null,
    executedAt: deps.now(),
    outcome
  })
}

function emit(
  deps: MessengerSeedOrchestratorDeps,
  outcome: ActionOutcome,
  startedMs: number
): void {
  deps.onActionOutcome?.({ outcome, durationMs: Math.max(0, deps.nowMs() - startedMs) })
}

async function navigateToMessageTarget(
  deps: MessengerSeedOrchestratorDeps,
  page: MessengerSeedSession['page'],
  uid: string
): Promise<void> {
  const url = `https://www.facebook.com/messages/t/${encodeURIComponent(uid)}`
  if (deps.navigate) {
    await deps.navigate(page, url)
    return
  }
  if (!page.goto) throw new Error('Messenger seed page cannot navigate')
  await page.goto(url, { timeout: 30_000, waitUntil: 'domcontentloaded' })
}

function computeDelayMs(deps: MessengerSeedOrchestratorDeps): number {
  const range = deps.delayRangeMs ?? { min: DEFAULT_DELAY_MIN_MS, max: DEFAULT_DELAY_MAX_MS }
  const min = Math.max(0, range.min)
  const max = Math.max(min, range.max)
  return Math.round(min + deps.rng() * (max - min))
}

function countFailedTarget(outcome: ActionOutcome): boolean {
  return outcome !== 'success'
}

export function createMessengerSeedOrchestrator(
  deps: MessengerSeedOrchestratorDeps
): MessengerSeedOrchestrator {
  return {
    async runMessengerSeed(jobId, profileId, options) {
      const targets = options.targets
      const total = targets.length
      const perTarget: MessengerSeedTargetResult[] = []
      let session: MessengerSeedSession | undefined
      let sent = 0
      let failed = 0
      let keepSessionOpen = false

      if (deps.isProfileWarm && !deps.isProfileWarm(profileId)) {
        failed = total
        transition(deps, jobId, 'FAILED', {
          result: safeResult({ outcome: 'error', reason: 'NOT_WARMED', sent, total })
        })
        return { profileId, sent, failed, stoppedReason: 'NOT_WARMED', perTarget }
      }

      if (total === 0) {
        transition(deps, jobId, 'DONE', {
          result: safeResult({ outcome: 'success', sent, total })
        })
        return { profileId, sent, failed, perTarget }
      }

      try {
        transition(deps, jobId, 'ACQUIRING_PROXY')
        transition(deps, jobId, 'LOGGING_IN')

        const loginResult = await deps.login(jobId, profileId)
        session = loginResult.session
        if (!loginResult.ok || loginResult.state === 'LOGIN_FAILED') {
          failed = total
          transition(deps, jobId, 'FAILED', {
            result: safeResult({
              outcome: 'error',
              reason: loginResult.reason ?? 'LOGIN_FAILED',
              sent,
              total
            })
          })
          return { profileId, sent, failed, stoppedReason: 'LOGIN_FAILED', perTarget }
        }
        if (loginResult.state === 'CHECKPOINT' || loginResult.state === 'TWO_FA_REQUIRED') {
          keepSessionOpen = loginResult.keepSessionOpen ?? Boolean(loginResult.session)
          failed = total
          const reason = loginResult.reason ?? loginResult.state
          transition(deps, jobId, 'CHECKPOINT_BLOCKED', {
            result: safeResult({ outcome: 'checkpoint', reason, sent, total })
          })
          return { profileId, sent, failed, stoppedReason: reason, perTarget }
        }

        const activeSession = loginResult.session
        if (!activeSession)
          throw new Error('Login session is required for messenger seed execution')
        session = activeSession

        transition(deps, jobId, 'WARMING_UP')
        await deps.extractTokens?.(activeSession.page)
        transition(deps, jobId, 'EXECUTING')

        const render = deps.render ?? renderContentTemplate
        for (let index = 0; index < targets.length; index += 1) {
          const target = targets[index]
          const startedMs = deps.nowMs()
          let actionToken: ActionToken | null = null
          try {
            const template = deps.contentTemplates.getRandomTemplate(deps.rng)
            if (!template) {
              failed += targets.length - index
              transition(deps, jobId, 'FAILED', {
                result: safeResult({ outcome: 'error', reason: 'TEMPLATE_MISSING', sent, total })
              })
              return { profileId, sent, failed, stoppedReason: 'TEMPLATE_MISSING', perTarget }
            }

            const content = render(template.body, { uid: target.uid, name: target.name })
            actionToken = await deps.actionTokenClient.requestActionToken({ actionType: 'message' })
            await navigateToMessageTarget(deps, activeSession.page, target.uid)
            const outcome = await deps.actionExecutor.executeMessengerSeed({
              page: activeSession.page,
              content
            })
            await deps.actionTokenClient
              .consumeActionToken(actionToken.token)
              .catch(() => undefined)
            record(deps, jobId, target.uid, outcome, actionToken)
            emit(deps, outcome, startedMs)
            perTarget.push({
              uid: target.uid,
              outcome,
              ...(outcome === 'checkpoint' ? { reason: 'CHECKPOINT' } : {})
            })
            if (outcome === 'success') sent += 1
            if (countFailedTarget(outcome)) failed += 1
            if (outcome === 'checkpoint') {
              keepSessionOpen = true
              transition(deps, jobId, 'CHECKPOINT_BLOCKED', {
                result: safeResult({ outcome, reason: 'CHECKPOINT', sent, total })
              })
              return { profileId, sent, failed, stoppedReason: 'CHECKPOINT', perTarget }
            }
          } catch {
            await (actionToken
              ? deps.actionTokenClient.consumeActionToken(actionToken.token).catch(() => undefined)
              : Promise.resolve())
            record(deps, jobId, target.uid, 'error', actionToken)
            emit(deps, 'error', startedMs)
            failed += 1
            perTarget.push({ uid: target.uid, outcome: 'error', reason: 'ACTION_EXECUTION_FAILED' })
          }

          if (index < targets.length - 1) {
            await deps.sleep(computeDelayMs(deps))
          }
        }

        transition(deps, jobId, 'DONE', {
          result: safeResult({ outcome: failed > 0 ? 'error' : 'success', sent, total })
        })
        return { profileId, sent, failed, perTarget }
      } catch {
        failed = Math.max(failed, total - sent)
        transition(deps, jobId, 'FAILED', {
          result: safeResult({ outcome: 'error', reason: 'AUTOMATION_FAILED', sent, total })
        })
        return { profileId, sent, failed, stoppedReason: 'AUTOMATION_FAILED', perTarget }
      } finally {
        if (!keepSessionOpen) await session?.close().catch(() => undefined)
      }
    }
  }
}
