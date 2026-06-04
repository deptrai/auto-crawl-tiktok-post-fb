import type { ActionOutcome, LocatorLike } from './action-executor'
import { removeSurrogatePairs } from './messenger-legacy-input'

export interface ShareLinkLocatorLike extends LocatorLike {
  getAttribute?(name: string): Promise<string | null>
}

export interface ShareLinkPageLike {
  locator(selector: string): ShareLinkLocatorLike
  waitForTimeout?: (ms: number) => Promise<void>
  keyboard?: {
    type(text: string, options?: { delay?: number }): Promise<void>
    press(key: string): Promise<void>
  }
}

export interface CsharpShareLinkSelectors {
  shareButtonFallbacks: string[]
  messengerButtonFallbacks: string[]
  moreShareOptions: string
  composer: string
  sendButtonFallbacks: string[]
  sendIconFallback: string
  couldntSend: string
}

// Fragile C# parity selectors. Epic 5 selector resolver should replace this bundle later.
export const CSHARP_SHARE_LINK_SELECTORS: CsharpShareLinkSelectors = {
  shareButtonFallbacks: [
    "div[data-ad-rendering-role='share_button']",
    'xpath=//span[contains(text(), "Share") or contains(text(), "Chia sẻ")]/ancestor::div[@role="button"][1]',
    'xpath=(//div[@role="button" and (.//span[contains(text(), "Share") or contains(text(), "Chia sẻ")])])[1]'
  ],
  messengerButtonFallbacks: [
    'xpath=//span[contains(text(), "Messenger")]/ancestor::div[@role="button"][1]',
    'div[role="button"][aria-label*="Messenger"]',
    'div[role="dialog"] div[role="button"][aria-label*="Messenger"]'
  ],
  moreShareOptions:
    'div[role="button"]:has-text("More share options"), div[role="button"]:has-text("Tùy chọn chia sẻ khác")',
  composer:
    'div[contenteditable="true"][style*="font-size: 15px"], div[contenteditable="true"][role="textbox"]',
  sendButtonFallbacks: [
    'xpath=(//div[@role="button" and (.//span[contains(text(), "Send") or contains(text(), "Gửi")])])[last()]'
  ],
  sendIconFallback: 'i[data-visualcompletion="css-img"]',
  couldntSend: 'span:has-text("Couldn\'t send")'
}

export type MessengerShareLinkResult =
  | { outcome: 'success' }
  | { outcome: Exclude<ActionOutcome, 'success'>; reason: string }

async function exists(locator: ShareLinkLocatorLike): Promise<boolean> {
  try {
    return (await locator.count()) > 0
  } catch {
    return false
  }
}

async function clickFirst(
  page: ShareLinkPageLike,
  selectors: string[]
): Promise<ShareLinkLocatorLike | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first()
    if (await exists(locator)) {
      await locator.click()
      return locator
    }
  }
  return null
}

async function clickMessenger(
  page: ShareLinkPageLike,
  selectors: CsharpShareLinkSelectors,
  clickedLabels: Set<string>
): Promise<boolean> {
  const clicked = await clickFirst(page, selectors.messengerButtonFallbacks)
  if (!clicked) {
    const more = page.locator(selectors.moreShareOptions).first()
    if (await exists(more)) {
      await more.click()
      await page.waitForTimeout?.(500)
      return clickMessenger(page, selectors, clickedLabels)
    }
    return false
  }

  const label = (await clicked.getAttribute?.('aria-label'))?.trim()
  if (label) {
    if (clickedLabels.has(label)) return false
    clickedLabels.add(label)
  }
  return true
}

async function typeLines(
  page: ShareLinkPageLike,
  composer: ShareLinkLocatorLike,
  lines: string[]
): Promise<void> {
  await composer.click()
  for (let index = 0; index < lines.length; index += 1) {
    const line = removeSurrogatePairs(lines[index])
    if (page.keyboard) await page.keyboard.type(line, { delay: 15 })
    else await composer.fill(line)
    if (index < lines.length - 1) {
      if (page.keyboard) await page.keyboard.press('Shift+Enter')
      else await composer.press?.('Shift+Enter')
    }
  }
}

export async function executeMessengerShareLink(input: {
  page: ShareLinkPageLike
  contentLines: string[]
  clickedLabels: Set<string>
  selectors?: CsharpShareLinkSelectors
}): Promise<MessengerShareLinkResult> {
  const selectors = input.selectors ?? CSHARP_SHARE_LINK_SELECTORS
  try {
    if (!(await clickFirst(input.page, selectors.shareButtonFallbacks))) {
      return { outcome: 'selector_miss', reason: 'MESSENGER_CLICK_FAILED' }
    }
    if (!(await clickMessenger(input.page, selectors, input.clickedLabels))) {
      return { outcome: 'error', reason: 'MESSENGER_CLICK_FAILED' }
    }

    const composer = input.page.locator(selectors.composer).first()
    if (!(await exists(composer))) return { outcome: 'selector_miss', reason: 'SEND_FAILED' }
    await typeLines(input.page, composer, input.contentLines)

    if (!(await clickFirst(input.page, selectors.sendButtonFallbacks))) {
      const icon = input.page.locator(selectors.sendIconFallback).first()
      if (await exists(icon)) await icon.click()
      else return { outcome: 'selector_miss', reason: 'SEND_FAILED' }
    }

    await input.page.waitForTimeout?.(500)
    if (await exists(input.page.locator(selectors.couldntSend).first())) {
      return { outcome: 'error', reason: 'BLOCKED_COULDNT_SEND' }
    }
    return { outcome: 'success' }
  } catch {
    return { outcome: 'error', reason: 'SEND_FAILED' }
  }
}
