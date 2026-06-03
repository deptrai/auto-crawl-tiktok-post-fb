export {
  FONT_CORE,
  FONT_OPTIONAL_POOL,
  TIMEZONE_POOL,
  UA_POOL,
  VIEWPORT_POOL,
  generateFingerprint
} from './fingerprint-generator'
export { createFingerprintService, type FingerprintService } from './fingerprint-service'
export {
  FINGERPRINT_VERSION,
  FingerprintSchema,
  type Fingerprint
} from '../../shared/types/fingerprint'
export {
  TRANSITIONS,
  canTransition,
  createStateMachine,
  isTerminal,
  type AutomationStateMachine,
  type AutomationStateMachineDeps,
  type AutomationTransitionErrorCode,
  type AutomationTransitionResult,
  type CreateAutomationJobInput,
  type TransitionOptions
} from './state-machine'
export {
  AUTOMATION_JOB_STATES,
  TERMINAL_STATES,
  type AutomationJob,
  type AutomationJobState
} from '../../shared/types/automation-job'
export { generateTotp } from './totp'
export { parseCookieHeader, type PlaywrightCookie } from './cookie'
export {
  createPlaywrightRunner,
  MOBILE_BROWSER_USER_AGENT,
  MOBILE_BROWSER_VIEWPORT,
  MOBILE_BROWSER_WINDOW_SIZE,
  type LaunchBrowser,
  type LaunchSessionInput,
  type PlaywrightProxyConfig,
  type PlaywrightRunner,
  type SessionHandle
} from './playwright-runner'
export { detectLoginState, submitTwoFa, type LoginState, type PageLike } from './checkpoint-handler'
export {
  createLoginService,
  type LoginCheckpointKind,
  type LoginResult,
  type LoginService,
  type LoginServiceDeps
} from './login-service'
export {
  TokenExtractionError,
  createTokenExtractor,
  parseTokens,
  type SessionTokens,
  type TokenExtractor,
  type TokenExtractorDeps
} from './token-extractor'
export {
  SELF_COMMENT_SELECTORS,
  executeSelfComment,
  type ActionOutcome,
  type CommentPageLike,
  type LocatorLike,
  type SelfCommentSelectors
} from './action-executor'
export {
  createSelfCommentOrchestrator,
  type SelfCommentLoginResult,
  type SelfCommentOrchestrator,
  type SelfCommentOrchestratorDeps,
  type RunSelfCommentOptions,
  type SelfCommentSession
} from './self-comment-orchestrator'
export { resolveOwnPostTarget, type OwnPostTargetPageLike } from './own-post-target-resolver'
