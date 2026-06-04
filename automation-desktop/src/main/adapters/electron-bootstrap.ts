import { app, BrowserWindow, ipcMain, screen, shell, session } from 'electron'
import { join } from 'node:path'
import icon from '../../../resources/icon.png?asset'
import { openEncryptedDatabase } from '../db/client'
import { createSettingsRepository, type SettingsRepository } from '../db/repositories/settings-repo'
import { createProfileRepository, type ProfileRepository } from '../db/repositories/profile-repo'
import { createProxyRepository, type ProxyRepository } from '../db/repositories/proxy-repo'
import {
  createAutomationJobRepository,
  type AutomationJobRepository
} from '../db/repositories/automation-job-repo'
import {
  createContentTemplateRepository,
  type ContentTemplateRepository
} from '../db/repositories/content-template-repo'
import {
  createTargetListRepository,
  type TargetListRepository
} from '../db/repositories/target-list-repo'
import {
  createJobActionRepository,
  type JobActionRepository
} from '../db/repositories/job-action-repo'
import {
  createCapSolverClient,
  createCheckpointSolver,
  createFingerprintService,
  createMessengerSeedOrchestrator,
  createPlaywrightRunner,
  createSelfCommentOrchestrator,
  createStateMachine,
  createTwoCaptchaClient,
  createTokenExtractor,
  detectLoginState,
  executeMessengerSeed,
  executeSelfComment,
  generateTotp,
  MOBILE_BROWSER_WINDOW_SIZE,
  parseCookieHeader,
  resolveOwnPostTarget,
  runMessengerSeedBatch,
  submitTwoFa,
  type CheckpointSolver,
  type MessengerSeedLoginResult,
  type MessengerSeedOrchestrator,
  type SelfCommentLoginResult,
  type SelfCommentOrchestrator
} from '../automation'
import { renderContentTemplate } from '../../shared/content-template-render'
import {
  createFetchLicenseBackendClient,
  createLicenseService,
  type LicenseService,
  type LicenseStatus
} from '../license/license-service'
import { createActionTokenClient } from '../license/action-token-client'
import { createProfileService, type ProfileService } from '../profile/profile-service'
import {
  createProxyPool,
  createProxyService,
  ProxyfbProvider,
  toPlaywrightProxy,
  type ProxyPool,
  type ProxyService
} from '../proxy'
import {
  registerLicenseHandlers,
  registerAutomationHandlers,
  registerCaptchaHandlers,
  registerContentTemplateHandlers,
  registerMessengerHandlers,
  registerProfileHandlers,
  registerProxyHandlers,
  registerSettingsHandlers,
  registerShellHandlers,
  registerTargetListHandlers
} from '../ipc'
import { createLicenseChecker, type LicenseChecker } from '../license/license-checker'
import { LICENSE_CHANGED_CHANNEL } from '../../shared/ipc-schemas'
import { ElectronAutoUpdater } from './electron-auto-updater'
import { ElectronIpcBridge } from './electron-ipc-bridge'
import { ElectronSafeStorage } from './electron-safe-storage'
import { buildMainWindowOptions, registerCspHeaders } from './electron-security-baseline'

interface BootstrapDeps {
  db: ReturnType<typeof openEncryptedDatabase>
  services: {
    settings: SettingsRepository
    license: LicenseService
    profile: ProfileService
    proxy: ProxyService
    proxyPool: ProxyPool
  }
  repos: {
    profile: ProfileRepository
    proxy: ProxyRepository
    automationJob: AutomationJobRepository
    contentTemplate: ContentTemplateRepository
    targetList: TargetListRepository
    jobAction: JobActionRepository
  }
  automation: {
    orchestrator: SelfCommentOrchestrator
    messengerOrchestrator: MessengerSeedOrchestrator
    stateMachine: ReturnType<typeof createStateMachine>
  }
  workers: {
    licenseChecker: LicenseChecker
  }
  adapters: {
    updater: ElectronAutoUpdater
    ipc: ElectronIpcBridge
    storage: ElectronSafeStorage
  }
}

type DbSmokeGlobal = typeof globalThis & {
  __PHASE3_DB_SMOKE_RESULT__?: string
  __PHASE3_PROFILE_REPO_SMOKE_RESULT__?: string
  __PHASE3_PROXY_SCHEMA_SMOKE_RESULT__?: string
  __PHASE3_EXTERNAL_OPEN_URL__?: string
}

// Mutable ref so the license checker (created before the window) can push
// status updates to whichever window is currently active.
let activeMainWindow: BrowserWindow | null = null

function publishLicenseStatus(status: LicenseStatus): void {
  if (activeMainWindow && !activeMainWindow.isDestroyed()) {
    activeMainWindow.webContents.send(LICENSE_CHANGED_CHANNEL, status)
  }
}

function profileSecretKey(profileId: string, field: 'cookie' | 'twofa'): string {
  return `profile.${profileId}.${field}`
}

const AUTOMATION_BROWSER_HEADLESS_SETTING = 'automation_browser_headless'
const CAPTCHA_SOLVER_ENABLED_SETTING = 'captcha.solver.enabled'
const CAPTCHA_CAPSOLVER_KEY = 'captcha.capsolver.api_key'
const CAPTCHA_TWO_CAPTCHA_KEY = 'captcha.2captcha.api_key'
let nextVisibleBrowserSlot = 0

interface VisibleBrowserGeometry {
  position: { x: number; y: number }
  windowSize: { width: number; height: number }
  viewport: { width: number; height: number }
}

function reserveNextVisibleBrowserGeometry(): VisibleBrowserGeometry {
  const workArea = screen.getPrimaryDisplay().workArea
  const gap = 6
  const rows = 2
  const windowHeight = Math.max(320, Math.floor((workArea.height - gap) / rows))
  const viewportHeight = Math.max(260, windowHeight - 108)
  const windowWidth = Math.max(500, Math.min(640, Math.floor(windowHeight * 0.95)))
  const windowSize = { width: windowWidth, height: windowHeight }
  const stepX = windowSize.width + gap
  const stepY = windowSize.height + gap
  const columns = Math.max(1, Math.floor((workArea.width + gap) / stepX))
  const slots = Math.max(1, columns * rows)
  const slot = nextVisibleBrowserSlot % slots
  nextVisibleBrowserSlot = (nextVisibleBrowserSlot + 1) % slots

  return {
    position: {
      x: workArea.x + (slot % columns) * stepX,
      y: workArea.y + Math.floor(slot / columns) * stepY
    },
    windowSize,
    viewport: { width: windowWidth, height: viewportHeight }
  }
}

function createSelfCommentLoginAdapter(deps: {
  storage: ElectronSafeStorage
  profileRepo: ProfileRepository
  settings: SettingsRepository
  proxyPool?: ProxyPool
  isProxyConfigured?: () => Promise<boolean>
  stateMachine?: ReturnType<typeof createStateMachine>
  checkpointSolver?: CheckpointSolver
}): (jobId: string, profileId: string) => Promise<SelfCommentLoginResult> {
  const runner = createPlaywrightRunner()
  const fingerprintService = createFingerprintService({ profileRepo: deps.profileRepo })

  async function hasCaptchaSolverKey(): Promise<boolean> {
    const [capsolverKey, twoCaptchaKey] = await Promise.all([
      deps.storage.get(CAPTCHA_CAPSOLVER_KEY),
      deps.storage.get(CAPTCHA_TWO_CAPTCHA_KEY)
    ])
    return Boolean(capsolverKey?.trim() || twoCaptchaKey?.trim())
  }

  return async (jobId, profileId) => {
    const cookieKey = profileSecretKey(profileId, 'cookie')
    const rawCookie = await deps.storage.get(cookieKey)
    if (!rawCookie?.trim()) {
      return {
        ok: false,
        code: 'LOGIN_FAILED',
        reason: deps.storage.hasEncryptedKey(cookieKey) ? 'COOKIE_DECRYPT_FAILED' : 'COOKIE_MISSING'
      }
    }

    let cookies: ReturnType<typeof parseCookieHeader>
    try {
      cookies = parseCookieHeader(rawCookie)
    } catch {
      return { ok: false, code: 'LOGIN_FAILED', reason: 'COOKIE_PARSE_FAILED' }
    }

    let fingerprint: ReturnType<typeof fingerprintService.ensureFingerprint>
    try {
      fingerprint = fingerprintService.ensureFingerprint(profileId)
    } catch {
      return { ok: false, code: 'LOGIN_FAILED', reason: 'FINGERPRINT_FAILED' }
    }

    const proxyConfigured = deps.isProxyConfigured ? await deps.isProxyConfigured() : false
    const assignedProxy =
      proxyConfigured && deps.proxyPool ? await deps.proxyPool.acquire(profileId) : undefined
    const playwrightProxy = assignedProxy ? toPlaywrightProxy(assignedProxy) : undefined
    let proxyReleased = false
    const releaseProxy = (): void => {
      if (!assignedProxy || proxyReleased) return
      proxyReleased = true
      deps.proxyPool?.release(profileId)
    }

    let sessionHandle: Awaited<ReturnType<typeof runner.launchSession>>
    try {
      const headless = deps.settings.getSetting(AUTOMATION_BROWSER_HEADLESS_SETTING) === 'true'
      const geometry = headless ? undefined : reserveNextVisibleBrowserGeometry()
      const importedUserAgent = deps.profileRepo.getMetadata(profileId, 'user_agent')?.trim()
      sessionHandle = await runner.launchSession({
        fingerprint,
        cookies,
        ...(playwrightProxy ? { proxy: playwrightProxy } : {}),
        headless,
        mobile: true,
        windowPosition: geometry?.position,
        windowSize: geometry?.windowSize ?? MOBILE_BROWSER_WINDOW_SIZE,
        viewport: geometry?.viewport,
        ...(importedUserAgent ? { userAgent: importedUserAgent } : {})
      })
    } catch {
      releaseProxy()
      return { ok: false, code: 'LOGIN_FAILED', reason: 'BROWSER_LAUNCH_FAILED' }
    }

    const session = {
      page: sessionHandle.page,
      close: async () => {
        try {
          await sessionHandle.close()
        } finally {
          releaseProxy()
        }
      }
    }

    // Ensure the browser session is always closed if anything throws after launchSession.
    try {
      await sessionHandle.page
        .waitForLoadState?.('networkidle', { timeout: 8_000 })
        .catch(() => undefined)
      await sessionHandle.page.waitForTimeout?.(1_000).catch(() => undefined)
      let state = await detectLoginState(sessionHandle.page)
      if (state === 'TWO_FA_REQUIRED') {
        const twoFa = await deps.storage.get(profileSecretKey(profileId, 'twofa'))
        if (!twoFa?.trim()) {
          releaseProxy()
          return { ok: true, state, session, reason: 'TWO_FA_REQUIRED', keepSessionOpen: true }
        }
        try {
          await submitTwoFa(sessionHandle.page, generateTotp(twoFa, Date.now()))
          state = await detectLoginState(sessionHandle.page)
        } catch {
          releaseProxy()
          return {
            ok: true,
            state: 'TWO_FA_REQUIRED',
            session,
            reason: 'TWO_FA_REQUIRED',
            keepSessionOpen: true
          }
        }
      }

      if (state === 'LOGGED_IN') return { ok: true, state, session }
      if (state === 'CHECKPOINT') {
        if (
          deps.checkpointSolver &&
          deps.stateMachine &&
          deps.settings.getSetting(CAPTCHA_SOLVER_ENABLED_SETTING) === 'true' &&
          (await hasCaptchaSolverKey())
        ) {
          deps.stateMachine.transition(jobId, 'SOLVING_CHECKPOINT')
          const solved = await deps.checkpointSolver.solveCheckpoint(sessionHandle.page, {
            profileId,
            jobId,
            ...(playwrightProxy ? { proxy: playwrightProxy } : {})
          })
          if (solved.ok) return { ok: true, state: 'LOGGED_IN', session }
        }
        releaseProxy()
        return { ok: true, state, session, reason: 'CHECKPOINT_BLOCKED', keepSessionOpen: true }
      }
      if (state === 'TWO_FA_REQUIRED') {
        releaseProxy()
        return { ok: true, state, session, reason: 'TWO_FA_REQUIRED', keepSessionOpen: true }
      }
      console.warn('[Phase3] Facebook login state failed', {
        profileId,
        url: sessionHandle.page.url(),
        title: await sessionHandle.page.title().catch(() => ''),
        loginInputs: await sessionHandle.page
          .locator('input[name="email"], input[name="pass"]')
          .count()
          .catch(() => 0),
        loggedInMarkers: await sessionHandle.page
          .locator(
            [
              '[role="navigation"]',
              '[aria-label*="Facebook"]',
              '[data-testid="logged-in"]',
              '[aria-label*="Messenger"]',
              '[aria-label*="Notifications"]',
              '[aria-label*="Thông báo"]',
              '[aria-label*="Menu"]',
              '[aria-label*="Profile"]',
              '[aria-label*="Trang cá nhân"]',
              '[aria-label*="Search Facebook"]',
              '[aria-label*="Tìm kiếm trên Facebook"]',
              'a[href*="/me/"]',
              'a[href*="profile.php"]'
            ].join(', ')
          )
          .count()
          .catch(() => 0)
      })
      return { ok: false, code: 'LOGIN_FAILED', session, reason: 'LOGIN_STATE_FAILED' }
    } catch (err) {
      await session.close().catch(() => undefined)
      throw err
    }
  }
}

function createStubSelfCommentOrchestrator(
  stateMachine: ReturnType<typeof createStateMachine>
): SelfCommentOrchestrator {
  return {
    async runSelfComment(jobId) {
      stateMachine.transition(jobId, 'ACQUIRING_PROXY')
      stateMachine.transition(jobId, 'LOGGING_IN')
      stateMachine.transition(jobId, 'WARMING_UP')
      stateMachine.transition(jobId, 'EXECUTING')
      stateMachine.transition(jobId, 'FAILED', {
        result: '{"outcome":"error","reason":"STUB_MODE_NO_COMMENT"}'
      })
      return { outcome: 'error' }
    }
  }
}

function createStubMessengerSeedOrchestrator(deps: {
  stateMachine: ReturnType<typeof createStateMachine>
  jobActions: JobActionRepository
  now: () => string
}): MessengerSeedOrchestrator {
  return {
    async runMessengerSeed(jobId, profileId, options) {
      deps.stateMachine.transition(jobId, 'ACQUIRING_PROXY')
      deps.stateMachine.transition(jobId, 'LOGGING_IN')
      deps.stateMachine.transition(jobId, 'WARMING_UP')
      deps.stateMachine.transition(jobId, 'EXECUTING')
      for (const target of options.targets) {
        deps.jobActions.recordAction({
          jobId,
          actionType: 'message',
          target: target.uid,
          actionTokenJti: null,
          executedAt: deps.now(),
          outcome: 'success'
        })
      }
      deps.stateMachine.transition(jobId, 'DONE', {
        result: JSON.stringify({
          outcome: 'success',
          sent: options.targets.length,
          total: options.targets.length
        })
      })
      return {
        profileId,
        sent: options.targets.length,
        failed: 0,
        perTarget: options.targets.map((target) => ({ uid: target.uid, outcome: 'success' }))
      }
    }
  }
}

function initializeDeps(): BootstrapDeps {
  const dbPath = process.env['PHASE3_DB_PATH'] ?? join(app.getPath('userData'), 'phase3.db')
  let db: ReturnType<typeof openEncryptedDatabase>
  try {
    db = openEncryptedDatabase({ path: dbPath, key: 'phase3-story-1-1-temp-key' })
  } catch (dbError) {
    const msg = dbError instanceof Error ? dbError.message : String(dbError)
    throw new Error(`[Phase3] Không thể mở database: ${msg}\nCó thể một phiên bản đang chạy rồi.`)
  }
  const adapters = {
    updater: new ElectronAutoUpdater(),
    ipc: new ElectronIpcBridge(),
    storage: new ElectronSafeStorage()
  }

  const settings = createSettingsRepository(db)
  const profileRepo = createProfileRepository(db)
  const proxyRepo = createProxyRepository(db)
  const automationJobRepo = createAutomationJobRepository(db)
  const contentTemplateRepo = createContentTemplateRepository(db)
  const targetListRepo = createTargetListRepository(db)
  const jobActionRepo = createJobActionRepository(db)
  const nowIso = (): string => new Date().toISOString()
  const automationApiBaseUrl =
    process.env['PHASE3_AUTOMATION_API_BASE_URL'] ?? 'http://localhost:8000'
  const smokeHwid = app.isPackaged ? undefined : process.env['PHASE3_HWID_SMOKE_VALUE']
  const proxyService = createProxyService({
    storage: adapters.storage,
    providers: {
      proxyfb: new ProxyfbProvider({ baseUrl: readProxyfbBaseUrl() })
    },
    repo: proxyRepo,
    clock: () => Date.now()
  })
  const services = {
    settings,
    license: createLicenseService({
      settings,
      storage: adapters.storage,
      backendClient: createFetchLicenseBackendClient(automationApiBaseUrl),
      generateHwid: smokeHwid ? async () => smokeHwid : undefined
    }),
    profile: createProfileService({
      repo: profileRepo,
      storage: adapters.storage,
      importDelayMs: readProfileImportDelayMs()
    }),
    proxy: proxyService,
    proxyPool: createProxyPool({ proxyService })
  }
  const repos = {
    profile: profileRepo,
    proxy: proxyRepo,
    automationJob: automationJobRepo,
    contentTemplate: contentTemplateRepo,
    targetList: targetListRepo,
    jobAction: jobActionRepo
  }
  contentTemplateRepo.seedDefaults(nowIso())
  const stateMachine = createStateMachine({ repo: automationJobRepo, now: nowIso })
  const actionTokenClient = createActionTokenClient({
    baseUrl: automationApiBaseUrl,
    getLicenseKey: async () => {
      const key = await adapters.storage.get('license.key')
      if (!key?.trim()) throw new Error('license key missing')
      return key
    },
    generateHwid: smokeHwid ? async () => smokeHwid : undefined
  })
  const checkpointSolver = createCheckpointSolver({
    isEnabled: () => settings.getSetting(CAPTCHA_SOLVER_ENABLED_SETTING) === 'true',
    getClients: async () => {
      const [capsolverKey, twoCaptchaKey] = await Promise.all([
        adapters.storage.get(CAPTCHA_CAPSOLVER_KEY),
        adapters.storage.get(CAPTCHA_TWO_CAPTCHA_KEY)
      ])
      return [
        ...(capsolverKey?.trim() ? [createCapSolverClient({ apiKey: capsolverKey })] : []),
        ...(twoCaptchaKey?.trim() ? [createTwoCaptchaClient({ apiKey: twoCaptchaKey })] : [])
      ]
    },
    nowMs: () => Date.now()
  })
  const loginAdapter = createSelfCommentLoginAdapter({
    storage: adapters.storage,
    profileRepo,
    settings,
    proxyPool: services.proxyPool,
    isProxyConfigured: async () => (await services.proxy.configGet()).configured,
    stateMachine,
    checkpointSolver
  })
  const stubAutomation = !app.isPackaged && process.env['PHASE3_AUTOMATION_STUB'] === '1'
  const orchestrator = stubAutomation
    ? createStubSelfCommentOrchestrator(stateMachine)
    : createSelfCommentOrchestrator({
        stateMachine,
        login: loginAdapter,
        extractTokens: async (page) =>
          createTokenExtractor({
            fetchHtml: async () => page.content?.() ?? '',
            onSelectorMiss: () => undefined
          }).extract(),
        resolveOwnPostTarget,
        actionTokenClient,
        contentTemplates: contentTemplateRepo,
        actionExecutor: { executeSelfComment },
        jobActions: jobActionRepo,
        now: nowIso,
        nowMs: () => Date.now(),
        rng: Math.random
      })
  const messengerOrchestrator = stubAutomation
    ? createStubMessengerSeedOrchestrator({ stateMachine, jobActions: jobActionRepo, now: nowIso })
    : createMessengerSeedOrchestrator({
        stateMachine,
        login: async (jobId, profileId): Promise<MessengerSeedLoginResult> =>
          loginAdapter(jobId, profileId),
        extractTokens: async (page) =>
          createTokenExtractor({
            fetchHtml: async () => page.content?.() ?? '',
            onSelectorMiss: () => undefined
          }).extract(),
        actionTokenClient,
        contentTemplates: contentTemplateRepo,
        actionExecutor: { executeMessengerSeed },
        jobActions: jobActionRepo,
        render: renderContentTemplate,
        navigate: async (page, target) => {
          if (!page.goto) throw new Error('Messenger page cannot navigate')
          await page.goto(target, { timeout: 30_000, waitUntil: 'domcontentloaded' })
        },
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        rng: Math.random,
        now: nowIso,
        nowMs: () => Date.now(),
        delayRangeMs: { min: 1_000, max: 3_000 }
      })
  const automation = {
    orchestrator,
    messengerOrchestrator,
    stateMachine
  }
  const workers = {
    licenseChecker: createLicenseChecker(services.license, { onStatus: publishLicenseStatus })
  }

  return { db, services, repos, automation, adapters, workers }
}

function configureUserDataPath(): void {
  if (app.isPackaged) return
  const userDataPath = process.env['PHASE3_USER_DATA_PATH']
  if (userDataPath) app.setPath('userData', userDataPath)
}

function runDatabaseSmoke(db: BootstrapDeps['db']): void {
  if (app.isPackaged) return
  const value = process.env['PHASE3_DB_SMOKE_VALUE']
  if (!value) return

  db.prepare('INSERT INTO __smoke(value) VALUES (?)').run(value)
  const row = db.prepare('SELECT value FROM __smoke ORDER BY id DESC LIMIT 1').get() as
    | { value: string }
    | undefined

  const smokeResult = row?.value
  ;(globalThis as DbSmokeGlobal).__PHASE3_DB_SMOKE_RESULT__ = smokeResult
  if (smokeResult) process.env['PHASE3_DB_SMOKE_RESULT'] = smokeResult
}

function runSettingsSmoke(settings: SettingsRepository): void {
  if (app.isPackaged) return
  const key = process.env['PHASE3_SETTINGS_SMOKE_KEY']
  const value = process.env['PHASE3_SETTINGS_SMOKE_VALUE']
  if (!key || value === undefined) return

  settings.setSetting(key, value)
  const overwriteValue = process.env['PHASE3_SETTINGS_SMOKE_OVERWRITE_VALUE']
  if (overwriteValue !== undefined) settings.setSetting(key, overwriteValue)

  process.env['PHASE3_SETTINGS_SMOKE_RESULT'] = `${key}=${settings.getSetting(key) ?? ''}`
}

function readProfileImportDelayMs(): number | undefined {
  if (app.isPackaged) return undefined
  const raw = process.env['PHASE3_PROFILE_IMPORT_DELAY_MS']
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  const parsed = Number(trimmed)
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== trimmed) return undefined
  return Math.min(parsed, 5_000)
}

function readProxyfbBaseUrl(): string | undefined {
  if (app.isPackaged) return undefined
  const raw = process.env['PHASE3_PROXYFB_BASE_URL']?.trim()
  return raw ? raw : undefined
}

function runProfileRepoSmoke(db: BootstrapDeps['db'], repo: ProfileRepository): void {
  if (app.isPackaged) return
  if (process.env['PHASE3_PROFILE_REPO_SMOKE'] !== '1') return

  let result = 'pass'
  try {
    const foreignKeys = db.pragma('foreign_keys', { simple: true })
    if (foreignKeys !== 1) throw new Error('foreign_keys disabled')

    repo.insertProfileAtomic(
      {
        id: 'profile-smoke-1',
        uid: 'uid_profile_smoke',
        displayName: 'uid_profile_smoke',
        status: 'idle',
        createdAt: '2026-06-02T00:00:00.000Z'
      },
      [
        { key: 'email', value: 'smoke@mail.com' },
        { key: 'token', value: 'token-smoke' }
      ]
    )

    const metadataCount = db
      .prepare<
        [string],
        { c: number }
      >('SELECT COUNT(*) AS c FROM profile_metadata WHERE profile_id = ?')
      .get('profile-smoke-1')?.c
    if (!repo.uidExists('uid_profile_smoke')) throw new Error('uidExists failed')
    if (repo.countProfiles() !== 1) throw new Error('count after insert failed')
    if (repo.listProfiles()[0]?.uid !== 'uid_profile_smoke') throw new Error('list failed')
    if (metadataCount !== 2) throw new Error('metadata insert failed')

    const updated = repo.updateDisplayName('profile-smoke-1', 'Smoke Edited')
    if (updated !== 1) throw new Error('updateDisplayName failed')
    const updatedProfile = repo.getProfileById('profile-smoke-1')
    if (updatedProfile?.displayName !== 'Smoke Edited') throw new Error('getProfileById failed')

    let uniqueFailed = false
    try {
      repo.insertProfileAtomic(
        {
          id: 'profile-smoke-duplicate',
          uid: 'uid_profile_smoke',
          displayName: 'uid_profile_smoke',
          status: 'idle',
          createdAt: '2026-06-02T00:00:01.000Z'
        },
        []
      )
    } catch {
      uniqueFailed = true
    }
    if (!uniqueFailed) throw new Error('unique constraint not enforced')

    repo.deleteProfile('profile-smoke-1')
    const metadataAfterDelete = db
      .prepare<
        [string],
        { c: number }
      >('SELECT COUNT(*) AS c FROM profile_metadata WHERE profile_id = ?')
      .get('profile-smoke-1')?.c
    if (repo.countProfiles() !== 0) throw new Error('delete failed')
    if (metadataAfterDelete !== 0) throw new Error('cascade delete failed')
  } catch (error) {
    result = `fail:${error instanceof Error ? error.message : String(error)}`
  }

  ;(globalThis as DbSmokeGlobal).__PHASE3_PROFILE_REPO_SMOKE_RESULT__ = result
  process.env['PHASE3_PROFILE_REPO_SMOKE_RESULT'] = result
}

function runProxySchemaSmoke(db: BootstrapDeps['db'], repo: ProxyRepository): void {
  if (app.isPackaged) return
  if (process.env['PHASE3_PROXY_SCHEMA_SMOKE'] !== '1') return

  let result = 'pass'
  try {
    const columns = db
      .prepare<[], { name: string }>('PRAGMA table_info(proxy_configs)')
      .all()
      .map((row) => row.name)
    if (columns.join(',') !== 'provider,enabled,last_rotated_at') {
      throw new Error(`unexpected columns: ${columns.join(',')}`)
    }
    repo.upsertConfig('proxyfb-smoke', {
      enabled: false,
      lastRotatedAt: '2026-06-03T00:00:00.000Z'
    })
    const disabled = repo.getConfig('proxyfb-smoke')
    if (disabled?.enabled !== false || disabled.lastRotatedAt !== '2026-06-03T00:00:00.000Z') {
      throw new Error('proxy config disabled upsert failed')
    }
    repo.upsertConfig('proxyfb-smoke', {
      enabled: true,
      lastRotatedAt: '2026-06-03T00:01:00.000Z'
    })
    const enabled = repo.getConfig('proxyfb-smoke')
    if (enabled?.enabled !== true || enabled.lastRotatedAt !== '2026-06-03T00:01:00.000Z') {
      throw new Error('proxy config enabled upsert failed')
    }
  } catch (error) {
    result = `fail:${error instanceof Error ? error.message : String(error)}`
  }

  ;(globalThis as DbSmokeGlobal).__PHASE3_PROXY_SCHEMA_SMOKE_RESULT__ = result
  process.env['PHASE3_PROXY_SCHEMA_SMOKE_RESULT'] = result
}

async function runSafeStorageSmoke(storage: ElectronSafeStorage): Promise<void> {
  if (app.isPackaged) return
  const key = process.env['PHASE3_SAFE_STORAGE_SMOKE_KEY']
  if (!key) return

  const value = process.env['PHASE3_SAFE_STORAGE_SMOKE_VALUE']
  if (value !== undefined) await storage.set(key, value)
  const result = await storage.get(key)
  process.env['PHASE3_SAFE_STORAGE_SMOKE_RESULT'] = result ?? ''
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    ...buildMainWindowOptions(),
    ...(process.platform === 'linux' ? { icon } : {})
  })

  activeMainWindow = mainWindow
  mainWindow.on('closed', () => {
    if (activeMainWindow === mainWindow) activeMainWindow = null
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    const url = details.url
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

export async function bootstrapApplication(): Promise<void> {
  app.setAppUserModelId('com.electron')
  configureUserDataPath()
  registerCspHeaders(session.defaultSession, { allowDevRenderer: !app.isPackaged })

  const deps = initializeDeps()
  runDatabaseSmoke(deps.db)
  runSettingsSmoke(deps.services.settings)
  runProfileRepoSmoke(deps.db, deps.repos.profile)
  runProxySchemaSmoke(deps.db, deps.repos.proxy)
  await runSafeStorageSmoke(deps.adapters.storage)

  // Init order: db -> adapters -> services -> ipc -> window -> background workers
  void deps.db
  void deps.adapters
  void deps.services
  registerSettingsHandlers(ipcMain, deps.services.settings)
  registerLicenseHandlers(ipcMain, deps.services.license)
  registerProfileHandlers(ipcMain, deps.services.profile)
  registerContentTemplateHandlers(ipcMain, deps.repos.contentTemplate)
  registerTargetListHandlers(ipcMain, deps.repos.targetList)
  registerAutomationHandlers(ipcMain, {
    orchestrator: deps.automation.orchestrator,
    stateMachine: deps.automation.stateMachine,
    jobRepo: deps.repos.automationJob,
    jobActions: deps.repos.jobAction
  })
  registerMessengerHandlers(ipcMain, {
    orchestrator: deps.automation.messengerOrchestrator,
    batch: runMessengerSeedBatch,
    stateMachine: deps.automation.stateMachine,
    jobRepo: deps.repos.automationJob,
    jobActions: deps.repos.jobAction,
    targetLists: deps.repos.targetList
  })
  registerCaptchaHandlers(ipcMain, {
    storage: deps.adapters.storage,
    settings: deps.services.settings
  })
  registerProxyHandlers(
    ipcMain,
    deps.services.proxy,
    deps.services.proxyPool,
    (profileId) => deps.repos.profile.getProfileById(profileId) !== undefined
  )
  registerShellHandlers(ipcMain, async (url) => {
    if (!app.isPackaged && process.env['PHASE3_EXTERNAL_OPEN_SMOKE']) {
      ;(globalThis as DbSmokeGlobal).__PHASE3_EXTERNAL_OPEN_URL__ = url
      process.env['PHASE3_EXTERNAL_OPEN_URL'] = url
      return
    }

    await shell.openExternal(url)
  })
  createWindow()

  // Start the periodic license checker only after the window exists so the
  // first push (phase3:license:changed) has a renderer target.
  deps.workers.licenseChecker.start()
  app.once('before-quit', () => deps.workers.licenseChecker.stop())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}
