import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright-core'
async function launchDesktopApp(
  dbPath: string,
  extraEnv: Record<string, string> = {}
): Promise<ElectronApplication> {
  const launchEnv = { ...process.env }
  delete launchEnv.ELECTRON_RUN_AS_NODE

  return electron.launch({
    args: ['.'],
    env: {
      ...launchEnv,
      PHASE3_DB_PATH: dbPath,
      PHASE3_USER_DATA_PATH: dirname(dbPath),
      ...extraEnv
    }
  })
}

test('[P0] EULA gate is re-shown when code version is bumped above accepted version', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-eula-bump-'))
  const dbPath = join(dir, 'phase3.db')

  try {
    // Seed the DB with an old accepted version using the smoke env
    const seedApp = await launchDesktopApp(dbPath, {
      PHASE3_SETTINGS_SMOKE_KEY: 'eula_accepted_version',
      PHASE3_SETTINGS_SMOKE_VALUE: '0'
    })
    await seedApp.firstWindow()
    await seedApp.close()

    // Launch without overriding EULA_VERSION — the app's EULA_VERSION (1) > stored (0)
    const app = await launchDesktopApp(dbPath)
    const window = await app.firstWindow()

    await expect(window.getByRole('heading', { name: /thỏa thuận người dùng/i })).toBeVisible()
    await expect(window.getByTestId('main-shell')).toHaveCount(0)

    await app.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P0] first-run EULA accept persists settings and restart skips gate', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-eula-e2e-'))
  const dbPath = join(dir, 'phase3.db')

  try {
    const app = await launchDesktopApp(dbPath, { PHASE3_EXTERNAL_OPEN_SMOKE: '1' })
    const window = await app.firstWindow()

    await expect(window.getByRole('heading', { name: /thỏa thuận người dùng/i })).toBeVisible()
    await expect(window.getByTestId('main-shell')).toHaveCount(0)

    const externalResponse = await window.evaluate(async () =>
      window.api.ipc.call('phase3:shell:open-external', { url: 'https://example.com/privacy' })
    )
    expect(externalResponse).toEqual({ ok: true })
    await window.getByRole('button', { name: /chính sách quyền riêng tư/i }).click()
    await expect(window.getByRole('heading', { name: /thỏa thuận người dùng/i })).toBeVisible()
    await expect(window.locator('.error-message')).toHaveCount(0)

    const acceptButton = window.getByRole('button', { name: /chấp nhận và tiếp tục/i })
    await expect(acceptButton).toBeDisabled()
    await window.getByRole('checkbox', { name: /tôi đồng ý/i }).check()
    await expect(acceptButton).toBeEnabled()
    await acceptButton.click()

    await expect(window.getByTestId('license-view')).toBeVisible()
    await expect(window.getByRole('heading', { name: /thỏa thuận người dùng/i })).toHaveCount(0)

    const persistedSettings = await window.evaluate(async () => {
      const eula = await window.api.ipc.call('phase3:settings:get', {
        key: 'eula_accepted_version'
      })
      const telemetry = await window.api.ipc.call('phase3:settings:get', {
        key: 'telemetry_enabled'
      })
      return { eula, telemetry }
    })
    expect(persistedSettings).toEqual({
      eula: { ok: true, value: '1' },
      telemetry: { ok: true, value: 'true' }
    })
    await app.close()

    const secondApp = await launchDesktopApp(dbPath)
    const secondWindow = await secondApp.firstWindow()
    await expect(secondWindow.getByTestId('license-view')).toBeVisible()
    await expect(secondWindow.getByRole('heading', { name: /thỏa thuận người dùng/i })).toHaveCount(
      0
    )
    await secondApp.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
