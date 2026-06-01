import { app, BrowserWindow, shell, session } from 'electron'
import { join } from 'node:path'
import icon from '../../../resources/icon.png?asset'
import { openEncryptedDatabase } from '../db/client'
import { ElectronAutoUpdater } from './electron-auto-updater'
import { ElectronIpcBridge } from './electron-ipc-bridge'
import { ElectronSafeStorage } from './electron-safe-storage'
import { buildMainWindowOptions, registerCspHeaders } from './electron-security-baseline'

interface BootstrapDeps {
  db: ReturnType<typeof openEncryptedDatabase>
  adapters: {
    updater: ElectronAutoUpdater
    ipc: ElectronIpcBridge
    storage: ElectronSafeStorage
  }
}

type DbSmokeGlobal = typeof globalThis & {
  __PHASE3_DB_SMOKE_RESULT__?: string
}

function initializeDeps(): BootstrapDeps {
  const db = openEncryptedDatabase({
    path: join(app.getPath('userData'), 'phase3.db'),
    key: 'phase3-story-1-1-temp-key'
  })

  const adapters = {
    updater: new ElectronAutoUpdater(),
    ipc: new ElectronIpcBridge(),
    storage: new ElectronSafeStorage()
  }

  return { db, adapters }
}

function runDatabaseSmoke(db: BootstrapDeps['db']): void {
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

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    ...buildMainWindowOptions(),
    ...(process.platform === 'linux' ? { icon } : {})
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
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
  registerCspHeaders(session.defaultSession)

  const deps = initializeDeps()
  runDatabaseSmoke(deps.db)

  // Init order: db -> adapters -> services -> ipc -> window
  void deps.db
  void deps.adapters
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}
