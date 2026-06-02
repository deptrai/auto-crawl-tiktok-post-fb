import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright-core'

async function launchDesktopApp(extraEnv: Record<string, string>): Promise<ElectronApplication> {
  const launchEnv = { ...process.env }
  delete launchEnv.ELECTRON_RUN_AS_NODE

  return electron.launch({
    args: ['.'],
    env: {
      ...launchEnv,
      ...extraEnv
    }
  })
}

test('[P0] settings repository persists get/set values in encrypted local_settings table', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-settings-repo-'))
  const dbPath = join(dir, 'phase3.db')
  const app = await launchDesktopApp({
    PHASE3_DB_PATH: dbPath,
    PHASE3_SETTINGS_SMOKE_KEY: 'eula_accepted_version',
    PHASE3_SETTINGS_SMOKE_VALUE: '1'
  })

  try {
    await app.firstWindow()

    await expect
      .poll(() => app.evaluate(() => process.env['PHASE3_SETTINGS_SMOKE_RESULT']))
      .toBe('eula_accepted_version=1')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P1] settings repository overwrites existing keys without duplicating rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-settings-repo-'))
  const dbPath = join(dir, 'phase3.db')
  const app = await launchDesktopApp({
    PHASE3_DB_PATH: dbPath,
    PHASE3_SETTINGS_SMOKE_KEY: 'telemetry_enabled',
    PHASE3_SETTINGS_SMOKE_VALUE: 'false',
    PHASE3_SETTINGS_SMOKE_OVERWRITE_VALUE: 'true'
  })

  try {
    await app.firstWindow()

    await expect
      .poll(() => app.evaluate(() => process.env['PHASE3_SETTINGS_SMOKE_RESULT']))
      .toBe('telemetry_enabled=true')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
