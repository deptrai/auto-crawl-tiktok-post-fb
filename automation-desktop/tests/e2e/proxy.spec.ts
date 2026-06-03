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
      if (!address || typeof address === 'string') throw new Error('Invalid license server address')
      resolve({ server, url: `http://127.0.0.1:${address.port}` })
    })
  })
}

function startProxyfbServer(options: { failAll?: boolean } = {}): Promise<{
  server: Server
  url: string
  paths: string[]
}> {
  const paths: string[] = []
  const server = createServer((req, res) => {
    paths.push(req.url ?? '')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (options.failAll) {
      res.end(JSON.stringify({ success: 'False', proxy: '' }))
      return
    }
    if (req.url?.startsWith('/api/changeProxy.php')) {
      res.end(JSON.stringify({ success: 'True', proxy: '10.20.30.40:9090:proxy-user:proxy-pass' }))
      return
    }
    res.end(JSON.stringify({ success: 'False', proxy: '' }))
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Invalid proxy server address')
      resolve({ server, url: `http://127.0.0.1:${address.port}/api`, paths })
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
  licenseUrl: string,
  proxyfbUrl: string
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
      PHASE3_PROXYFB_BASE_URL: proxyfbUrl,
      PHASE3_HWID_SMOKE_VALUE: 'c'.repeat(64),
      PHASE3_SETTINGS_SMOKE_KEY: 'eula_accepted_version',
      PHASE3_SETTINGS_SMOKE_VALUE: '1'
    }
  })
}

test('[P0] proxy view saves api key then tests proxy without exposing credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-proxy-view-'))
  const license = await startLicenseServer()
  const proxyfb = await startProxyfbServer()
  let app: ElectronApplication | null = null

  try {
    app = await launchWithActiveLicense(join(dir, 'phase3.db'), license.url, proxyfb.url)
    const window = await app.firstWindow()

    await expect(window.getByTestId('license-view')).toBeVisible({ timeout: 10_000 })
    await window.getByRole('textbox', { name: /license key/i }).fill('LIC-PROXY-OK')
    await window.getByRole('button', { name: /kích hoạt/i }).click()
    await expect(window.getByTestId('main-shell')).toBeVisible({ timeout: 10_000 })

    await expect(window.getByTestId('proxy-view')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByText('Chưa cấu hình')).toBeVisible()
    await expect(window.getByTestId('proxy-health-status')).toContainText('Bình thường')
    await expect(window.getByTestId('proxy-test-button')).toBeDisabled()

    await window.getByTestId('proxy-api-key-input').fill('KEY-SECRET-123')
    await window.getByTestId('proxy-save-button').click()
    await expect(window.getByText('Đã cấu hình')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByTestId('proxy-api-key-input')).toHaveValue('')

    await window.getByTestId('proxy-test-button').click()
    await expect(window.getByTestId('proxy-test-result')).toContainText('10.20.30.40:9090')
    await expect(window.getByTestId('proxy-health-status')).toContainText('Bình thường')
    await expect(window.getByTestId('proxy-view')).not.toContainText('proxy-user')
    await expect(window.getByTestId('proxy-view')).not.toContainText('proxy-pass')
    await expect(window.getByTestId('proxy-view')).not.toContainText('KEY-SECRET-123')
    expect(
      proxyfb.paths.some((path) => path.includes('/api/changeProxy.php?key=KEY-SECRET-123'))
    ).toBe(true)
  } finally {
    if (app) await app.close()
    await closeServer(license.server)
    await closeServer(proxyfb.server)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P1] proxy view shows quarantine health after repeated provider failures', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-proxy-quarantine-'))
  const license = await startLicenseServer()
  const proxyfb = await startProxyfbServer({ failAll: true })
  let app: ElectronApplication | null = null

  try {
    app = await launchWithActiveLicense(join(dir, 'phase3.db'), license.url, proxyfb.url)
    const window = await app.firstWindow()

    await expect(window.getByTestId('license-view')).toBeVisible({ timeout: 10_000 })
    await window.getByRole('textbox', { name: /license key/i }).fill('LIC-PROXY-FAIL')
    await window.getByRole('button', { name: /kích hoạt/i }).click()
    await expect(window.getByTestId('main-shell')).toBeVisible({ timeout: 10_000 })

    await window.getByTestId('proxy-api-key-input').fill('KEY-SECRET-FAIL')
    await window.getByTestId('proxy-save-button').click()
    await expect(window.getByText('Đã cấu hình')).toBeVisible({ timeout: 10_000 })

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await window.getByTestId('proxy-test-button').click()
      await expect(window.getByTestId('proxy-error')).toContainText('Không thể lấy proxy proxyfb.')
    }

    await expect(window.getByTestId('proxy-health-status')).toContainText('Tạm ngừng')
    await expect(window.getByTestId('proxy-health-status')).toContainText(/còn \d+s/)
    await expect(window.getByTestId('proxy-view')).not.toContainText('KEY-SECRET-FAIL')
  } finally {
    if (app) await app.close()
    await closeServer(license.server)
    await closeServer(proxyfb.server)
    rmSync(dir, { recursive: true, force: true })
  }
})
