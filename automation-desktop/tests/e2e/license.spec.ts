import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright-core'

type MockMode = 'success' | 'mismatch' | 'expired-readonly' | 'expired-locked'

function startLicenseServer(mode: MockMode): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/api/v1/automation/license/activate') {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          error: { code: 'NOT_FOUND', message: 'Không tìm thấy', retryable: false }
        })
      )
      return
    }

    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const payload = JSON.parse(body) as { key: string; hwid: string }
      if (!/^[0-9a-f]{64}$/.test(payload.hwid)) {
        response.writeHead(400, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            error: { code: 'INVALID_HWID', message: 'HWID không hợp lệ', retryable: false }
          })
        )
        return
      }

      if (mode === 'mismatch') {
        response.writeHead(409, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            error: {
              code: 'LICENSE_HWID_MISMATCH',
              message:
                'License đã được kích hoạt trên máy khác. Vui lòng liên hệ hỗ trợ để rebind.',
              retryable: false
            }
          })
        )
        return
      }

      const expiresAt = (() => {
        if (mode === 'expired-readonly') return new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
        if (mode === 'expired-locked') return new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
        return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      })()

      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          activation_id: '550e8400-e29b-41d4-a716-446655440000',
          expires_at: expiresAt.toISOString(),
          rebind_count: 0
        })
      )
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Invalid server address')
      resolve({ server, url: `http://127.0.0.1:${address.port}` })
    })
  })
}

async function launchDesktopApp(dbPath: string, baseUrl: string): Promise<ElectronApplication> {
  const launchEnv = { ...process.env }
  delete launchEnv.ELECTRON_RUN_AS_NODE

  return electron.launch({
    args: ['.'],
    env: {
      ...launchEnv,
      PHASE3_DB_PATH: dbPath,
      PHASE3_USER_DATA_PATH: dirname(dbPath),
      PHASE3_AUTOMATION_API_BASE_URL: baseUrl,
      PHASE3_HWID_SMOKE_VALUE: 'c'.repeat(64),
      PHASE3_SETTINGS_SMOKE_KEY: 'eula_accepted_version',
      PHASE3_SETTINGS_SMOKE_VALUE: '1'
    }
  })
}

test('[P0] license activation stores private activation and opens main shell', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-license-ok-'))
  const { server, url } = await startLicenseServer('success')

  try {
    const app = await launchDesktopApp(join(dir, 'phase3.db'), url)
    const window = await app.firstWindow()

    await expect(window.getByTestId('license-view')).toBeVisible()
    await window.getByRole('textbox', { name: /license key/i }).fill('LIC-OK')
    await window.getByRole('button', { name: /kích hoạt/i }).click()

    await expect(window.getByTestId('main-shell')).toBeVisible()
    await expect(window.getByText(/license active: còn/i)).toBeVisible()
    await app.close()
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P0] license activation shows HWID mismatch rebind guidance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-license-mismatch-'))
  const { server, url } = await startLicenseServer('mismatch')

  try {
    const app = await launchDesktopApp(join(dir, 'phase3.db'), url)
    const window = await app.firstWindow()

    await expect(window.getByTestId('license-view')).toBeVisible()
    await window.getByRole('textbox', { name: /license key/i }).fill('LIC-MISMATCH')
    await window.getByRole('button', { name: /kích hoạt/i }).click()

    await expect(window.getByText(/kích hoạt trên máy khác/i)).toBeVisible()
    await expect(window.getByText(/License đã.*rebind/i)).toBeVisible()
    await expect(window.getByTestId('license-view')).toBeVisible()
    await app.close()
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P0] expired license enters 7 day read-only export grace', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-license-expired-readonly-'))
  const { server, url } = await startLicenseServer('expired-readonly')

  try {
    const app = await launchDesktopApp(join(dir, 'phase3.db'), url)
    const window = await app.firstWindow()

    await expect(window.getByTestId('license-view')).toBeVisible()
    await window.getByRole('textbox', { name: /license key/i }).fill('LIC-EXPIRED')
    await window.getByRole('button', { name: /kích hoạt/i }).click()

    await expect(window.getByTestId('readonly-shell')).toBeVisible()
    await expect(window.getByRole('button', { name: /export backup/i })).toBeVisible()
    await app.close()
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P0] license after 7 day read-only grace is locked to LicenseView', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-license-expired-locked-'))
  const { server, url } = await startLicenseServer('expired-locked')

  try {
    const app = await launchDesktopApp(join(dir, 'phase3.db'), url)
    const window = await app.firstWindow()

    await expect(window.getByTestId('license-view')).toBeVisible()
    await window.getByRole('textbox', { name: /license key/i }).fill('LIC-LOCKED')
    await window.getByRole('button', { name: /kích hoạt/i }).click()

    // Locked gate must be distinguishable from main/read-only shells (F5):
    // assert the dedicated marker AND that neither shell is shown.
    await expect(window.getByTestId('license-locked')).toBeVisible()
    await expect(window.getByText(/License chưa hoạt động hoặc đã hết hạn/i)).toBeVisible()
    await expect(window.getByTestId('main-shell')).toHaveCount(0)
    await expect(window.getByTestId('readonly-shell')).toHaveCount(0)
    await app.close()
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
