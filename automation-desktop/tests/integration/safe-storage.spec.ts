import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright-core'

test.describe.configure({ mode: 'serial' })

async function launchDesktopApp(
  userDataDir: string,
  extraEnv: Record<string, string>
): Promise<ElectronApplication> {
  const launchEnv = { ...process.env }
  delete launchEnv.ELECTRON_RUN_AS_NODE

  return electron.launch({
    args: ['.'],
    env: {
      ...launchEnv,
      PHASE3_DB_PATH: join(userDataDir, 'phase3.db'),
      PHASE3_USER_DATA_PATH: userDataDir,
      ...extraEnv
    }
  })
}

test('[P0] safeStorage adapter encrypts, persists, and decrypts activation id', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-safe-storage-'))

  try {
    const app = await launchDesktopApp(dir, {
      PHASE3_SAFE_STORAGE_SMOKE_KEY: 'license.activation_id',
      PHASE3_SAFE_STORAGE_SMOKE_VALUE: 'activation-secret-123'
    })
    await app.firstWindow()

    await expect
      .poll(() => app.evaluate(() => process.env['PHASE3_SAFE_STORAGE_SMOKE_RESULT']))
      .toBe('activation-secret-123')
    await app.close()

    const secondApp = await launchDesktopApp(dir, {
      PHASE3_SAFE_STORAGE_SMOKE_KEY: 'license.activation_id'
    })
    await secondApp.firstWindow()
    await expect
      .poll(() => secondApp.evaluate(() => process.env['PHASE3_SAFE_STORAGE_SMOKE_RESULT']))
      .toBe('activation-secret-123')
    await secondApp.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P1] safeStorage adapter does not crash on corrupt store file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-safe-storage-corrupt-'))
  let app: ElectronApplication | null = null

  try {
    writeFileSync(join(dir, 'phase3-secure-storage.json'), '{not-json', 'utf8')
    app = await launchDesktopApp(dir, {
      PHASE3_SAFE_STORAGE_SMOKE_KEY: 'license.activation_id'
    })
    await app.firstWindow()

    await expect
      .poll(() => app?.evaluate(() => process.env['PHASE3_SAFE_STORAGE_SMOKE_RESULT']))
      .toBe('')
  } finally {
    await app?.close().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true })
  }
})
