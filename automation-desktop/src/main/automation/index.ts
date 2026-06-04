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
export {
  MESSENGER_SEED_SELECTORS,
  executeMessengerSeed,
  type MessengerSeedSelectors
} from './messenger-seed-executor'
export {
  createMessengerSeedOrchestrator,
  type CsharpShareLinkConfig,
  type CsharpShareLinkStopReason,
  type MessengerSeedLoginResult,
  type MessengerSeedMode,
  type MessengerSeedOrchestrator,
  type MessengerSeedOrchestratorDeps,
  type MessengerSeedResult,
  type MessengerSeedSession,
  type MessengerSeedTargetResult,
  type MessengerTarget,
  type RunMessengerSeedOptions
} from './messenger-seed-orchestrator'
export {
  parseLegacyLines,
  removeSurrogatePairs,
  splitMessageLines,
  chooseLegacyContent,
  chooseLegacyShareLink
} from './messenger-legacy-input'
export {
  buildBusinessCtaRequest,
  createBusinessCtaClient,
  isBusinessCtaSuccess,
  type BusinessCtaClient,
  type BusinessCtaRequest,
  type BusinessCtaRequestInput,
  type BusinessCtaResult,
  type BusinessCtaTokens
} from './messenger-business-cta'
export {
  CSHARP_SHARE_LINK_SELECTORS,
  executeMessengerShareLink,
  type CsharpShareLinkSelectors,
  type MessengerShareLinkResult,
  type ShareLinkPageLike
} from './messenger-share-link-executor'
export {
  runMessengerSeedBatch,
  type MessengerSeedBatchInput,
  type MessengerSeedBatchResult
} from './messenger-seed-batch'
export * from './checkpoint'
