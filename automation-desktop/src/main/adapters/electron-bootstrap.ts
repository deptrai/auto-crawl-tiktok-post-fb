import { app, BrowserWindow, ipcMain, shell, session } from 'electron'
import { join } from 'node:path'
import icon from '../../../resources/icon.png?asset'
import { openEncryptedDatabase } from '../db/client'
import { createSettingsRepository, type SettingsRepository } from '../db/repositories/settings-repo'
import { createProfileRepository, type ProfileRepository } from '../db/repositories/profile-repo'
import {
  createFetchLicenseBackendClient,
  createLicenseService,
  type LicenseService,
  type LicenseStatus
} from '../license/license-service'
import { createProfileService, type ProfileService } from '../profile/profile-service'
import {
  registerLicenseHandlers,
  registerProfileHandlers,
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
  }
  repos: {
    profile: ProfileRepository
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
  const smokeHwid = app.isPackaged ? undefined : process.env['PHASE3_HWID_SMOKE_VALUE']
  const services = {
    settings,
    license: createLicenseService({
      settings,
      storage: adapters.storage,
      backendClient: createFetchLicenseBackendClient(
        process.env['PHASE3_AUTOMATION_API_BASE_URL'] ?? 'http://localhost:8000'
      ),
      generateHwid: smokeHwid ? async () => smokeHwid : undefined
    }),
    profile: createProfileService({
      repo: profileRepo,
      storage: adapters.storage,
      importDelayMs: readProfileImportDelayMs()
    })
  }
  const repos = {
    profile: profileRepo
  }
  const workers = {
    licenseChecker: createLicenseChecker(services.license, { onStatus: publishLicenseStatus })
  }

  return { db, services, repos, adapters, workers }
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
  registerCspHeaders(session.defaultSession)

  const deps = initializeDeps()
  runDatabaseSmoke(deps.db)
  runSettingsSmoke(deps.services.settings)
  runProfileRepoSmoke(deps.db, deps.repos.profile)
  await runSafeStorageSmoke(deps.adapters.storage)

  // Init order: db -> adapters -> services -> ipc -> window -> background workers
  void deps.db
  void deps.adapters
  void deps.services
  registerSettingsHandlers(ipcMain, deps.services.settings)
  registerLicenseHandlers(ipcMain, deps.services.license)
  registerProfileHandlers(ipcMain, deps.services.profile)
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
