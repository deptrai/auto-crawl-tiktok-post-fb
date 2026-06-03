import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { _electron as electron, test, expect } from '@playwright/test'
import type { ElectronApplication, Locator } from 'playwright-core'

/**
 * Minimal license server: always returns a valid active license.
 * Profiles E2E tests need the license gate to be 'active' so ProfilesView renders.
 */
async function launchWithActiveLicense(
  dbPath: string,
  extraEnv: Record<string, string> = {}
): Promise<{
  app: ElectronApplication
  window: Awaited<ReturnType<ElectronApplication['firstWindow']>>
  server: Server
}> {
  const server = createServer((_req, res) => {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    // activation_id must be a valid UUID for BackendActivationResponseSchema validation
    res.end(
      JSON.stringify({
        activation_id: '11111111-1111-4111-a111-111111111111',
        expires_at: expiresAt,
        rebind_count: 0
      })
    )
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
      PHASE3_SETTINGS_SMOKE_VALUE: '1',
      ...extraEnv
    }
  })

  // Auto-activate by clicking through license flow
  const window = await app.firstWindow()
  await expect(window.getByTestId('license-view')).toBeVisible({ timeout: 10_000 })
  await window.getByRole('textbox', { name: /license key/i }).fill('LIC-PROFILES-OK')
  await window.getByRole('button', { name: /kích hoạt/i }).click()
  await expect(window.getByTestId('main-shell')).toBeVisible({ timeout: 10_000 })

  return { app, window, server }
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

function startProxyfbServer(): Promise<{ server: Server; url: string; paths: string[] }> {
  const paths: string[] = []
  let count = 0
  const server = createServer((req, res) => {
    paths.push(req.url ?? '')
    count += 1
    const host = count === 1 ? '10.44.55.1' : '10.44.55.2'
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: 'True', proxy: `${host}:9090:proxy-user:proxy-pass` }))
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${addr.port}/api`, paths })
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

test('[P0] profiles view renders and import button is present when license is active', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-profiles-'))
  let app: ElectronApplication | null = null
  let server: Server | null = null

  try {
    const launched = await launchWithActiveLicense(join(dir, 'phase3.db'))
    app = launched.app
    server = launched.server
    const window = launched.window

    // ProfilesView should be visible inside main-shell
    await expect(window.getByTestId('profiles-view')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByTestId('import-textarea')).toBeVisible()
    await expect(window.getByTestId('import-button')).toBeVisible()
  } finally {
    if (app) await app.close()
    await closeServer(server)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P0] profiles list shows empty state when no profile exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-profiles-empty-'))
  let app: ElectronApplication | null = null
  let server: Server | null = null

  try {
    const launched = await launchWithActiveLicense(join(dir, 'phase3.db'))
    app = launched.app
    server = launched.server
    const window = launched.window

    await expect(window.getByTestId('profiles-list-section')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByTestId('profiles-list-empty')).toContainText('Chưa có profile nào.')
  } finally {
    if (app) await app.close()
    await closeServer(server)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P0] import two profiles shows summary with 2 imported and clears textarea', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-profiles-import-'))
  let app: ElectronApplication | null = null
  let server: Server | null = null

  try {
    const launched = await launchWithActiveLicense(join(dir, 'phase3.db'))
    app = launched.app
    server = launched.server
    const window = launched.window

    await expect(window.getByTestId('profiles-view')).toBeVisible({ timeout: 10_000 })
    const textarea = window.getByTestId('import-textarea')
    await expect(textarea).toBeVisible()

    // Paste 2 valid profiles
    const bulk = [
      'uid_alpha|pass1|seed1|cookieALPHA|alpha@mail.com|mailpass1',
      'uid_beta|pass2||cookieBETA|'
    ].join('\n')
    await setTextareaValue(textarea, bulk)

    await window.getByTestId('import-button').click()

    // Wait for result to appear
    await expect(window.getByTestId('import-result')).toBeVisible({ timeout: 10_000 })

    // Summary shows 2 imported
    await expect(window.getByText(/2 đã import/i)).toBeVisible()

    // Textarea should be cleared after successful import
    await expect(textarea).toHaveValue('')

    // Import result should show the 2 uids and the real-time list refreshes immediately.
    await expect(window.getByTestId('imported-profiles-list')).toBeVisible()
    await expect(window.getByTestId('profile-row-uid_alpha')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByTestId('profile-row-uid_beta')).toBeVisible()
    await expect(window.getByTestId('profile-row-uid_alpha')).toContainText('Nhàn rỗi')
    await expect(window.getByTestId('profile-row-uid_beta')).toContainText('Nhàn rỗi')
    await expect(window.getByTestId('profiles-list-section')).not.toContainText('cookieALPHA')
    await expect(window.getByTestId('profiles-list-section')).not.toContainText('pass1')
    await expect(window.getByTestId('profiles-list-section')).not.toContainText('seed1')
  } finally {
    if (app) await app.close()
    await closeServer(server)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P0] profile row can visibly acquire and release a unique proxy assignment', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-profiles-proxy-assign-'))
  const proxyfb = await startProxyfbServer()
  let app: ElectronApplication | null = null
  let server: Server | null = null

  try {
    const launched = await launchWithActiveLicense(join(dir, 'phase3.db'), {
      PHASE3_PROXYFB_BASE_URL: proxyfb.url
    })
    app = launched.app
    server = launched.server
    const window = launched.window

    const textarea = window.getByTestId('import-textarea')
    await setTextareaValue(
      textarea,
      ['uid_proxy_1|pass1|seed1|cookiePROXY1|p1@mail.com|mailpass1'].join('\n')
    )
    await window.getByTestId('import-button').click()
    await expect(window.getByTestId('profile-row-uid_proxy_1')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByTestId('profile-proxy-empty-uid_proxy_1')).toContainText('Chưa gán')

    await window.getByTestId('proxy-api-key-input').fill('KEY-PROXY-ASSIGN')
    await window.getByTestId('proxy-save-button').click()
    await expect(window.getByText('Đã cấu hình')).toBeVisible({ timeout: 10_000 })

    await window.getByTestId('profile-proxy-acquire-uid_proxy_1').click()
    await expect(window.getByTestId('profile-proxy-value-uid_proxy_1')).toContainText(
      '10.44.55.1:9090',
      { timeout: 10_000 }
    )
    await expect(window.getByTestId('profile-row-uid_proxy_1')).not.toContainText('proxy-user')
    await expect(window.getByTestId('profile-row-uid_proxy_1')).not.toContainText('proxy-pass')
    await expect(window.getByTestId('profile-row-uid_proxy_1')).not.toContainText(
      'KEY-PROXY-ASSIGN'
    )

    await window.getByTestId('profile-proxy-release-uid_proxy_1').click()
    await expect(window.getByTestId('profile-proxy-empty-uid_proxy_1')).toContainText('Chưa gán', {
      timeout: 10_000
    })

    expect(proxyfb.paths.some((path) => path.includes('/api/changeProxy.php'))).toBe(true)
  } finally {
    if (app) await app.close()
    await closeServer(server)
    await closeServer(proxyfb.server)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P1] import shows loading state and disables button while processing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-profiles-loading-'))
  let app: ElectronApplication | null = null
  let server: Server | null = null

  try {
    const launched = await launchWithActiveLicense(join(dir, 'phase3.db'), {
      PHASE3_PROFILE_IMPORT_DELAY_MS: '1500'
    })
    app = launched.app
    server = launched.server
    const window = launched.window

    await expect(window.getByTestId('profiles-view')).toBeVisible({ timeout: 10_000 })
    const textarea = window.getByTestId('import-textarea')
    const bulk = [
      'uid_loading_1|pass1|seed1|cookie_LOADING_1|mail1@example.com|mailpass1',
      'uid_loading_2|pass2|seed2|cookie_LOADING_2|mail2@example.com|mailpass2'
    ].join('\n')
    await setTextareaValue(textarea, bulk)

    await window.getByTestId('import-button').click()

    await expect(window.getByTestId('import-button')).toBeDisabled()
    await expect(window.getByTestId('import-loading')).toBeVisible()
    await expect(window.getByTestId('import-result')).toBeVisible({ timeout: 30_000 })
  } finally {
    if (app) await app.close()
    await closeServer(server)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P1] import error path keeps textarea value for retry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-profiles-error-'))
  let app: ElectronApplication | null = null
  let server: Server | null = null

  try {
    const launched = await launchWithActiveLicense(join(dir, 'phase3.db'))
    app = launched.app
    server = launched.server
    const window = launched.window

    await expect(window.getByTestId('profiles-view')).toBeVisible({ timeout: 10_000 })
    const textarea = window.getByTestId('import-textarea')
    const bulk = Array.from({ length: 5001 }, (_, i) => `uid_error_${i}|p|2fa|ck${i}`).join('\n')
    await setTextareaValue(textarea, bulk)

    await window.getByTestId('import-button').click()

    await expect(window.getByTestId('import-error')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByText(/Quá nhiều dòng/i)).toBeVisible()
    await expect(textarea).toHaveValue(bulk)
    await expect(window.getByTestId('import-result')).toHaveCount(0)
  } finally {
    if (app) await app.close()
    await closeServer(server)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P0] edit profile display name then delete profile from list', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-profiles-edit-delete-'))
  let app: ElectronApplication | null = null
  let server: Server | null = null

  try {
    const launched = await launchWithActiveLicense(join(dir, 'phase3.db'))
    app = launched.app
    server = launched.server
    const window = launched.window

    await expect(window.getByTestId('profiles-view')).toBeVisible({ timeout: 10_000 })
    const textarea = window.getByTestId('import-textarea')
    await setTextareaValue(
      textarea,
      'uid_edit_delete|pass|seed|cookie_EDIT|mail@example.com|mailpass'
    )
    await window.getByTestId('import-button').click()
    await expect(window.getByTestId('profile-row-uid_edit_delete')).toBeVisible({ timeout: 10_000 })

    await window.getByTestId('profile-edit-uid_edit_delete').click()
    await expect(window.getByTestId('profile-edit-input-uid_edit_delete')).toBeVisible()
    await window.getByTestId('profile-edit-input-uid_edit_delete').fill('Tên profile mới')
    await window.getByTestId('profile-edit-save-uid_edit_delete').click()

    await expect(window.getByTestId('profile-row-uid_edit_delete')).toContainText(
      'Tên profile mới',
      {
        timeout: 10_000
      }
    )
    await expect(window.getByTestId('profiles-list-section')).not.toContainText('cookie_EDIT')
    await expect(window.getByTestId('profiles-list-section')).not.toContainText('mailpass')

    await window.getByTestId('profile-delete-uid_edit_delete').click()
    await expect(window.getByTestId('profile-delete-confirm-uid_edit_delete')).toContainText(
      'Cookie + dữ liệu sẽ bị xóa vĩnh viễn.'
    )
    await window.getByTestId('profile-delete-confirm-submit-uid_edit_delete').click()

    await expect(window.getByTestId('profile-row-uid_edit_delete')).toHaveCount(0, {
      timeout: 10_000
    })
    await expect(window.getByTestId('profiles-list-empty')).toContainText('Chưa có profile nào.')
  } finally {
    if (app) await app.close()
    await closeServer(server)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P1] edit cancel restores original display name without saving', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-profiles-edit-cancel-'))
  let app: ElectronApplication | null = null
  let server: Server | null = null

  try {
    const launched = await launchWithActiveLicense(join(dir, 'phase3.db'))
    app = launched.app
    server = launched.server
    const window = launched.window

    // Import one profile
    const textarea = window.getByTestId('import-textarea')
    await setTextareaValue(textarea, 'uid_cancel|pass|seed|cookieCANCEL|')
    await window.getByTestId('import-button').click()
    await expect(window.getByTestId('import-result')).toBeVisible({ timeout: 10_000 })

    // Wait for row to appear in the real-time list
    await expect(window.getByTestId('profile-row-uid_cancel')).toBeVisible({ timeout: 10_000 })

    // Click Sửa → type new name → click Hủy
    await window.getByTestId('profile-edit-uid_cancel').click()
    const editInput = window.getByTestId('profile-edit-input-uid_cancel')
    await expect(editInput).toBeVisible()
    await editInput.fill('New Name Should Not Be Saved')

    await window.getByTestId('profile-edit-cancel-uid_cancel').click()

    // Edit form gone + original displayName still shown
    await expect(editInput).not.toBeVisible()
    await expect(window.getByTestId('profile-row-uid_cancel')).toBeVisible()
    await expect(window.getByTestId('profile-edit-uid_cancel')).toBeVisible()
  } finally {
    if (app) await app.close()
    await closeServer(server)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('[P1] delete cancel leaves profile intact in list', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'phase3-profiles-delete-cancel-'))
  let app: ElectronApplication | null = null
  let server: Server | null = null

  try {
    const launched = await launchWithActiveLicense(join(dir, 'phase3.db'))
    app = launched.app
    server = launched.server
    const window = launched.window

    // Import one profile
    const textarea = window.getByTestId('import-textarea')
    await setTextareaValue(textarea, 'uid_del_cancel|pass|seed|cookieDELCANCEL|')
    await window.getByTestId('import-button').click()
    await expect(window.getByTestId('import-result')).toBeVisible({ timeout: 10_000 })

    // Wait for row to appear in the real-time list
    await expect(window.getByTestId('profile-row-uid_del_cancel')).toBeVisible({ timeout: 10_000 })

    // Click Xóa → confirm panel appears → click Hủy
    await window.getByTestId('profile-delete-uid_del_cancel').click()
    await expect(window.getByTestId('profile-delete-confirm-uid_del_cancel')).toBeVisible()

    await window.getByTestId('profile-delete-cancel-uid_del_cancel').click()

    // Confirm panel gone + profile still in list
    await expect(window.getByTestId('profile-delete-confirm-uid_del_cancel')).not.toBeVisible()
    await expect(window.getByTestId('profile-row-uid_del_cancel')).toBeVisible()
  } finally {
    if (app) await app.close()
    await closeServer(server)
    rmSync(dir, { recursive: true, force: true })
  }
})
