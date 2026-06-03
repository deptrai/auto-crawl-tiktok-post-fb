import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, chromium } from '@playwright/test'
import { executeSelfComment } from '../../src/main/automation/action-executor'

test('[P0] real Chromium self-comment smoke fills local Facebook mock and verifies read-back', async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await page.setContent(
      readFileSync(join(process.cwd(), 'tests/fixtures/fb-mock/own-post.html'), 'utf8')
    )
    const outcome = await executeSelfComment({ page, content: 'Smoke comment 4.6a' })

    await expect(page.locator('[data-testid="comment-list"]')).toContainText('Smoke comment 4.6a')
    expect(outcome).toBe('success')
  } finally {
    await browser.close()
  }
})
