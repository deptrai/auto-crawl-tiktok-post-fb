import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication, Locator } from 'playwright-core'

function startLicenseServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        activation_id: '11111111-1111-4111-a111-111111111111',
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        rebind_count: 0
      })
    )
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Invalid server address')
      resolve({ server, url: `http://127.0.0.1:${address.port}` })
    })
  })
}

function closeServer(server: Server | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server || !server.listening) {
      resolve()
      return
    }
    server.close((err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function setTextareaValue(textarea: Locator, value: string): Promise<void> {
  await textarea.evaluate((node, nextValue) => {
    const textareaNode = node as HTMLTextAreaElement
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    valueSetter?.call(textareaNode, nextValue)
    textareaNode.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

async function launchWithActiveLicense(
  dbPath: string,
  licenseUrl: string
): Promise<ElectronApplication> {
  const launchEnv = { ...process.env }
  delete launchEnv.ELECTRON_RUN_AS_NODE
  return electron.launch({
    args: ['.'],
    env: {
      ...launchEnv,
      PHASE3_DB_PATH: dbPath,
      PHASE3_USER_DATA_PATH: dirname(dbPath),
      PHASE3_AUTOMATION_API_BASE_URL: licenseUrl,
      PHASE3_AUTOMATION_STUB: '1',
      PHASE3_HWID_SMOKE_VALUE: 'c'.repeat(64),
      PHASE3_SETTINGS_SMOKE_KEY: 'eula_accepted_version',
      PHASE3_SETTINGS_SMOKE_VALUE: '1'
    }
  })
}

test('[P0] profile row triggers self-comment and polls status without exposing secrets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-automation-trigger-'))
  const license = await startLicenseServer()
  let app: ElectronApplication | null = null

  try {
    app = await launchWithActiveLicense(join(dir, 'phase3.db'), license.url)
    const window = await app.firstWindow()

    await expect(window.getByTestId('license-view')).toBeVisible({ timeout: 10_000 })
    await window.getByRole('textbox', { name: /license key/i }).fill('LIC-AUTOMATION-OK')
    await window.getByRole('button', { name: /kích hoạt/i }).click()
    await expect(window.getByTestId('profiles-view')).toBeVisible({ timeout: 10_000 })

    await setTextareaValue(
      window.getByTestId('import-textarea'),
      'uid_auto_1|pass-secret|seed-secret|c_user=uid_auto_1;xs=secret|mail@example.com|mailpass'
    )
    await window.getByTestId('import-button').click()
    await expect(window.getByTestId('profile-row-uid_auto_1')).toBeVisible({ timeout: 10_000 })

    await window.getByTestId('automation-target-input').fill('https://www.facebook.com/me/posts/1')
    await window.getByTestId('profile-self-comment-uid_auto_1').click()
    await expect(window.getByTestId('profile-automation-status-uid_auto_1')).toContainText(
      'Hoàn tất',
      {
        timeout: 10_000
      }
    )
    await expect(window.getByTestId('profile-automation-status-uid_auto_1')).toContainText(
      'success'
    )
    await expect(window.getByTestId('profiles-list-section')).not.toContainText('pass-secret')
    await expect(window.getByTestId('profiles-list-section')).not.toContainText('seed-secret')
    await expect(window.getByTestId('profiles-list-section')).not.toContainText('xs=secret')
  } finally {
    if (app) await app.close()
    await closeServer(license.server)
    rmSync(dir, { recursive: true, force: true })
  }
})
