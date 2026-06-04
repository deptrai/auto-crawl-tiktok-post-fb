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
        activation_id: '22222222-2222-4222-a222-222222222222',
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
      PHASE3_HWID_SMOKE_VALUE: 'd'.repeat(64),
      PHASE3_SETTINGS_SMOKE_KEY: 'eula_accepted_version',
      PHASE3_SETTINGS_SMOKE_VALUE: '1'
    }
  })
}

test('[P0] messenger seeding UI pastes targets selects profile triggers stub batch and shows progress', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-messenger-seeding-'))
  const license = await startLicenseServer()
  let app: ElectronApplication | null = null

  try {
    app = await launchWithActiveLicense(join(dir, 'phase3.db'), license.url)
    const window = await app.firstWindow()

    await expect(window.getByTestId('license-view')).toBeVisible({ timeout: 10_000 })
    await window.getByRole('textbox', { name: /license key/i }).fill('LIC-MESSENGER-OK')
    await window.getByRole('button', { name: /kích hoạt/i }).click()
    await expect(window.getByTestId('profiles-view')).toBeVisible({ timeout: 10_000 })

    await setTextareaValue(
      window.getByTestId('import-textarea'),
      'uid_msg_1|pass-secret|seed-secret|c_user=uid_msg_1;xs=secret|mail@example.com|mailpass'
    )
    await window.getByTestId('import-button').click()
    await expect(window.getByTestId('profile-row-uid_msg_1')).toBeVisible({ timeout: 10_000 })

    await window.getByTestId('nav-messenger').click()
    await expect(window.getByTestId('messenger-seeding-view')).toBeVisible()
    await expect(window.getByTestId('messenger-template-hint')).toContainText('template ngẫu nhiên')
    await expect(window.getByTestId('messenger-placeholder-warning')).toContainText(
      'self-comment sẽ post nguyên văn'
    )

    await setTextareaValue(window.getByTestId('messenger-targets-input'), '123\n456|Bob')
    await window.getByTestId('messenger-profile-checkbox-uid_msg_1').check()
    await window.getByTestId('messenger-start-button').click()

    await expect(window.getByTestId('messenger-job-row-uid_msg_1')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByTestId('messenger-job-row-uid_msg_1')).toContainText(
      /Hoàn tất|Thất bại|Đang/
    )
    await expect(window.getByTestId('messenger-job-row-uid_msg_1')).toContainText(/\d+\/\d+/)
    await expect(window.getByTestId('messenger-seeding-view')).not.toContainText('pass-secret')
    await expect(window.getByTestId('messenger-seeding-view')).not.toContainText('xs=secret')
  } finally {
    if (app) await app.close()
    await closeServer(license.server)
    rmSync(dir, { recursive: true, force: true })
  }
})
