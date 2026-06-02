import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright-core'

/**
 * Minimal license server: always returns a valid active license.
 * Profiles E2E tests need the license gate to be 'active' so ProfilesView renders.
 */
async function launchWithActiveLicense(
  dbPath: string
): Promise<{ app: ElectronApplication; window: Awaited<ReturnType<ElectronApplication['firstWindow']>> }> {
  const { createServer } = await import('node:http')
  const server = createServer((_req, res) => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    // activation_id must be a valid UUID for BackendActivationResponseSchema validation
    res.end(JSON.stringify({ activation_id: '11111111-1111-4111-a111-111111111111', expires_at: expiresAt, rebind_count: 0 }))
  })

  const url: string = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve(`http://127.0.0.1:${addr.port}`)
    })
  })

  const launchEnv = { ...process.env }
  delete launchEnv.ELECTRON_RUN_AS_NODE

  const app = await electron.launch({
    args: ['.'],
    env: {
      ...launchEnv,
      PHASE3_DB_PATH: dbPath,
      PHASE3_USER_DATA_PATH: dirname(dbPath),
      PHASE3_AUTOMATION_API_BASE_URL: url,
      PHASE3_HWID_SMOKE_VALUE: 'c'.repeat(64),
      // Skip EULA gate
      PHASE3_SETTINGS_SMOKE_KEY: 'eula_accepted_version',
      PHASE3_SETTINGS_SMOKE_VALUE: '1'
    }
  })

  // Auto-activate by clicking through license flow
  const window = await app.firstWindow()
  await expect(window.getByTestId('license-view')).toBeVisible({ timeout: 10_000 })
  await window.getByRole('textbox', { name: /license key/i }).fill('LIC-PROFILES-OK')
  await window.getByRole('button', { name: /kích hoạt/i }).click()
  await expect(window.getByTestId('main-shell')).toBeVisible({ timeout: 10_000 })

  return { app, window }
}

test('[P0] profiles view renders and import button is present when license is active', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-profiles-'))
  let app: ElectronApplication | null = null

  try {
    const launched = await launchWithActiveLicense(join(dir, 'phase3.db'))
    app = launched.app
    const window = launched.window

    // ProfilesView should be visible inside main-shell
    await expect(window.getByTestId('profiles-view')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByTestId('import-textarea')).toBeVisible()
    await expect(window.getByTestId('import-button')).toBeVisible()
  } finally {
    if (app) await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P0] import two profiles shows summary with 2 imported and clears textarea', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-profiles-import-'))
  let app: ElectronApplication | null = null

  try {
    const launched = await launchWithActiveLicense(join(dir, 'phase3.db'))
    app = launched.app
    const window = launched.window

    await expect(window.getByTestId('profiles-view')).toBeVisible({ timeout: 10_000 })
    const textarea = window.getByTestId('import-textarea')
    await expect(textarea).toBeVisible()

    // Paste 2 valid profiles
    const bulk = [
      'uid_alpha|pass1|seed1|cookieALPHA|alpha@mail.com|mailpass1',
      'uid_beta|pass2||cookieBETA|'
    ].join('\n')
    await textarea.fill(bulk)

    await window.getByTestId('import-button').click()

    // Wait for result to appear
    await expect(window.getByTestId('import-result')).toBeVisible({ timeout: 10_000 })

    // Summary shows 2 imported
    await expect(window.getByText(/2 đã import/i)).toBeVisible()

    // Textarea should be cleared after successful import
    await expect(textarea).toHaveValue('')

    // Profiles list should show the 2 uids
    await expect(window.getByTestId('imported-profiles-list')).toBeVisible()
    await expect(window.getByText('uid_alpha')).toBeVisible()
    await expect(window.getByText('uid_beta')).toBeVisible()
  } finally {
    if (app) await app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
