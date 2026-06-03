import type { Page } from 'playwright'

export type LoginState = 'LOGGED_IN' | 'TWO_FA_REQUIRED' | 'CHECKPOINT' | 'LOGIN_FAILED'

export interface PageLike {
  url?: () => string
  locator?: Page['locator']
  detectLoginState?: () => Promise<LoginState>
  submitTwoFa?: (code: string) => Promise<void>
}

async function locatorCount(page: PageLike, selector: string): Promise<number> {
  if (!page.locator) return 0
  try {
    return await page.locator(selector).count()
  } catch {
    return 0
  }
}

export async function detectLoginState(page: PageLike): Promise<LoginState> {
  if (page.detectLoginState) return page.detectLoginState()

  const currentUrl = page.url?.() ?? ''
  if (/\/checkpoint\/?/i.test(currentUrl)) return 'CHECKPOINT'

  if (
    (await locatorCount(
      page,
      '[data-testid="checkpoint"], [id*="checkpoint"], [class*="checkpoint"]'
    )) > 0
  ) {
    return 'CHECKPOINT'
  }

  if (
    (await locatorCount(page, 'input[name="approvals_code"], input[name="checkpoint_code"]')) > 0
  ) {
    return 'TWO_FA_REQUIRED'
  }

  if ((await locatorCount(page, 'input[name="email"], input[name="pass"]')) > 0) {
    return 'LOGIN_FAILED'
  }

  if (
    (await locatorCount(
      page,
      '[role="navigation"], [aria-label="Facebook"], [data-testid="logged-in"]'
    )) > 0
  ) {
    return 'LOGGED_IN'
  }

  return 'LOGIN_FAILED'
}

export async function submitTwoFa(page: PageLike, code: string): Promise<void> {
  if (page.submitTwoFa) {
    await page.submitTwoFa(code)
    return
  }
  if (!page.locator) throw new Error('Page does not support 2FA submission')

  const input = page.locator('input[name="approvals_code"], input[name="checkpoint_code"]').first()
  await input.fill(code)
  const submit = page
    .locator('button[name="submit_2fa"], button[type="submit"], input[type="submit"]')
    .first()
  if ((await submit.count()) > 0) await submit.click()
}
