import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, test, expect } from '@playwright/test'
import { detectLoginState, submitTwoFa } from '../../src/main/automation'

async function withMockServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server: Server = createServer((req, res) => {
    const path = req.url?.split('?')[0] ?? '/logged-in'
    const fileName = path.includes('two-fa')
      ? 'two-fa.html'
      : path.includes('checkpoint')
        ? 'checkpoint.html'
        : 'logged-in.html'
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(readFileSync(join(process.cwd(), 'tests/fixtures/fb-mock', fileName), 'utf8'))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('mock server did not bind')
  try {
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test('[P1] real Chromium detects login, 2FA, and checkpoint against local Facebook mock', async () => {
  await withMockServer(async (baseUrl) => {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    try {
      await page.goto(`${baseUrl}/logged-in`, { timeout: 10_000 })
      await expect.poll(() => detectLoginState(page)).toBe('LOGGED_IN')

      await page.goto(`${baseUrl}/two-fa`, { timeout: 10_000 })
      await expect.poll(() => detectLoginState(page)).toBe('TWO_FA_REQUIRED')
      await submitTwoFa(page, '123456')
      await expect(page.locator('input[name="approvals_code"]')).toHaveValue('123456')

      await page.goto(`${baseUrl}/checkpoint`, { timeout: 10_000 })
      await expect.poll(() => detectLoginState(page)).toBe('CHECKPOINT')
    } finally {
      await browser.close()
    }
  })
})
