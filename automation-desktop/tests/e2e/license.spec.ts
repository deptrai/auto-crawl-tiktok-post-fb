import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication } from 'playwright-core'

type MockMode = 'success' | 'mismatch'

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

      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          activation_id: '550e8400-e29b-41d4-a716-446655440000',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
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
