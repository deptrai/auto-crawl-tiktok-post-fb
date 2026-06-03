import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright-core'

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

test('[P0] content template UI creates, edits, deletes, and protects final template', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-content-template-ui-'))
  const license = await startLicenseServer()
  let app: ElectronApplication | null = null

  try {
    app = await launchWithActiveLicense(join(dir, 'phase3.db'), license.url)
    const window = await app.firstWindow()

    await expect(window.getByTestId('license-view')).toBeVisible({ timeout: 10_000 })
    await window.getByRole('textbox', { name: /license key/i }).fill('LIC-TEMPLATE-OK')
    await window.getByRole('button', { name: /kích hoạt/i }).click()
    await expect(window.getByTestId('content-templates-view')).toBeVisible({ timeout: 10_000 })

    const defaultRow = window.locator('.template-row', { hasText: 'Mặc định' })
    await expect(defaultRow.getByRole('button', { name: 'Xóa' })).toBeDisabled()

    await window.getByTestId('content-template-label-input').fill('Khen nhẹ')
    await window.getByTestId('content-template-body-input').fill('Bài viết rất hay')
    await window.getByTestId('content-template-create-button').click()
    await expect(window.getByTestId('content-templates-list')).toContainText('Khen nhẹ')
    await expect(window.getByTestId('content-templates-list')).toContainText('Bài viết rất hay')

    const createdRow = window.locator('.template-row', { hasText: 'Khen nhẹ' })
    await createdRow.getByRole('button', { name: 'Sửa' }).click()
    await window.locator('.template-edit-form textarea').fill('Bài viết quá ổn')
    await window.locator('.template-edit-form').getByRole('button', { name: 'Lưu' }).click()
    await expect(window.getByTestId('content-templates-list')).toContainText('Bài viết quá ổn')

    await window
      .locator('.template-row', { hasText: 'Bài viết quá ổn' })
      .getByRole('button', { name: 'Xóa' })
      .click()
    await expect(window.getByTestId('content-templates-list')).not.toContainText('Khen nhẹ')
    await expect(defaultRow.getByRole('button', { name: 'Xóa' })).toBeDisabled()
  } finally {
    if (app) await app.close()
    await closeServer(license.server)
    rmSync(dir, { recursive: true, force: true })
  }
})
