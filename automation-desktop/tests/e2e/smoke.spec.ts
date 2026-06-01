import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright-core'

async function launchDesktopApp(
  extraEnv: Record<string, string> = {}
): Promise<ElectronApplication> {
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

test('[P0] launches desktop app successfully', async () => {
  // Given: desktop runtime can be launched with a clean Electron env.
  // When: launching the packaged entrypoint in test mode.
  const app = await launchDesktopApp()

  // Then: the first window appears and app can close cleanly.
  const window = await app.firstWindow()
  await expect(window).toHaveTitle(/electron/i)
  await app.close()
})

test('[P1] writes and reads SQLCipher database in Electron runtime', async () => {
  // Given: the app initializes its SQLCipher database in the Electron main process.
  const expectedValue = `db-smoke-${Date.now()}`
  const app = await launchDesktopApp({ PHASE3_DB_SMOKE_VALUE: expectedValue })
  await app.firstWindow()

  // When: reading the bootstrap smoke result from the Electron main process.
  const actualValue = await app.evaluate(() => {
    return process.env['PHASE3_DB_SMOKE_RESULT']
  })

  // Then: encrypted DB supports a real write/read round trip.
  expect(actualValue).toBe(expectedValue)
  await app.close()
})
