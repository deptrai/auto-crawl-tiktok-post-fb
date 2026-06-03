import { app, BrowserWindow, ipcMain, shell, session } from 'electron'
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
  createJobActionRepository,
  type JobActionRepository
} from '../db/repositories/job-action-repo'
import {
  createFingerprintService,
  createPlaywrightRunner,
  createSelfCommentOrchestrator,
  createStateMachine,
  createTokenExtractor,
  detectLoginState,
  executeSelfComment,
  generateTotp,
  parseCookieHeader,
  submitTwoFa,
  type SelfCommentLoginResult,
  type SelfCommentOrchestrator
} from '../automation'
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
  type ProxyPool,
  type ProxyService
} from '../proxy'
import {
  registerLicenseHandlers,
  registerAutomationHandlers,
  registerContentTemplateHandlers,
  registerProfileHandlers,
  registerProxyHandlers,
  registerSettingsHandlers,
  registerShellHandlers
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
    jobAction: JobActionRepository
  }
  automation: {
    orchestrator: SelfCommentOrchestrator
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

function createSelfCommentLoginAdapter(deps: {
  storage: ElectronSafeStorage
  profileRepo: ProfileRepository
}): (jobId: string, profileId: string) => Promise<SelfCommentLoginResult> {
  const runner = createPlaywrightRunner()
  const fingerprintService = createFingerprintService({ profileRepo: deps.profileRepo })

  return async (_jobId, profileId) => {
    const rawCookie = await deps.storage.get(profileSecretKey(profileId, 'cookie'))
    if (!rawCookie?.trim()) return { ok: false, code: 'LOGIN_FAILED' }

    const sessionHandle = await runner.launchSession({
      fingerprint: fingerprintService.ensureFingerprint(profileId),
      cookies: parseCookieHeader(rawCookie)
    })

    const session = {
      page: sessionHandle.page,
      close: () => sessionHandle.close()
    }

    // Ensure the browser session is always closed if anything throws after launchSession.
    try {
      let state = await detectLoginState(sessionHandle.page)
      if (state === 'TWO_FA_REQUIRED') {
        const twoFa = await deps.storage.get(profileSecretKey(profileId, 'twofa'))
        if (!twoFa?.trim()) return { ok: true, state, session }
        try {
          await submitTwoFa(sessionHandle.page, generateTotp(twoFa, Date.now()))
          state = await detectLoginState(sessionHandle.page)
        } catch {
          return { ok: true, state: 'TWO_FA_REQUIRED', session }
        }
      }

      if (state === 'LOGGED_IN') return { ok: true, state, session }
      if (state === 'CHECKPOINT' || state === 'TWO_FA_REQUIRED') return { ok: true, state, session }
      return { ok: false, code: 'LOGIN_FAILED', session }
    } catch (err) {
      await sessionHandle.close().catch(() => undefined)
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
      stateMachine.transition(jobId, 'DONE', { result: '{"outcome":"success"}' })
      return { outcome: 'success' }
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
  const orchestrator =
    !app.isPackaged && process.env['PHASE3_AUTOMATION_STUB'] === '1'
      ? createStubSelfCommentOrchestrator(stateMachine)
      : createSelfCommentOrchestrator({
          stateMachine,
          login: createSelfCommentLoginAdapter({ storage: adapters.storage, profileRepo }),
          extractTokens: async (page) =>
            createTokenExtractor({
              fetchHtml: async () => page.content?.() ?? '',
              onSelectorMiss: () => undefined
            }).extract(),
          // ⚠️ Fragile bundled selector — Epic 5 will replace with 4-tier own-post finder.
          resolveOwnPostTarget: async (page) => {
            try {
              const href = await page.getAttribute?.(
                'a[href*="/posts/"], a[href*="/permalink/"], a[href*="/video/"], a[href*="story_fbid"]',
                'href'
              )
              if (!href) return null
              return href.startsWith('http') ? href : `https://www.facebook.com${href}`
            } catch {
              return null
            }
          },
          actionTokenClient,
          contentTemplates: contentTemplateRepo,
          actionExecutor: { executeSelfComment },
          jobActions: jobActionRepo,
          now: nowIso,
          nowMs: () => Date.now(),
          rng: Math.random
        })
  const automation = {
    orchestrator,
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
  registerAutomationHandlers(ipcMain, {
    orchestrator: deps.automation.orchestrator,
    stateMachine: deps.automation.stateMachine,
    jobRepo: deps.repos.automationJob,
    jobActions: deps.repos.jobAction
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
