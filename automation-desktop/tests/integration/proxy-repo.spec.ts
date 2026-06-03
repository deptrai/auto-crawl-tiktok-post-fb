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

test('[P1] proxy repository upserts and reads proxy_configs in real SQLCipher DB', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-proxy-repo-'))
  const app = await launchDesktopApp({
    PHASE3_DB_PATH: join(dir, 'phase3.db'),
    PHASE3_USER_DATA_PATH: dir,
    PHASE3_PROXY_SCHEMA_SMOKE: '1'
  })

  try {
    await app.firstWindow()

    await expect
      .poll(() => app.evaluate(() => process.env['PHASE3_PROXY_SCHEMA_SMOKE_RESULT']))
      .toBe('pass')
  } finally {
    await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
