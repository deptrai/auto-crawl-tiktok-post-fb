import type { ActionOutcome, CommentPageLike, LocatorLike } from './action-executor'

export interface MessengerSeedSelectors {
  msgBox: string
  sendButton: string
  sentMarker: string
  checkpointMarker: string
}

// ⚠️ Fragile — Epic 5 4-tier selector resolver will replace this bundled selector set.
export const MESSENGER_SEED_SELECTORS: MessengerSeedSelectors = {
  msgBox: [
    '[data-testid="messenger-seed-box"]',
    '[aria-label="Message"][role="textbox"][contenteditable="true"]',
    '[aria-label="Tin nhắn"][role="textbox"][contenteditable="true"]',
    '[role="textbox"][contenteditable="true"][aria-label*="Aa"]',
    '[role="textbox"][contenteditable="true"]'
  ].join(', '),
  sendButton: [
    '[data-testid="messenger-seed-send"]',
    '[aria-label="Press Enter to send"][role="button"]',
    '[aria-label="Nhấn Enter để gửi"][role="button"]',
    '[aria-label="Send"][role="button"]',
    '[aria-label="Gửi"][role="button"]'
  ].join(', '),
  sentMarker: '[data-testid="messenger-thread"], [aria-label*="Messenger"], [role="main"]',
  checkpointMarker: [
    '[data-testid="checkpoint"]',
    '[aria-label*="checkpoint"]',
    '[aria-label*="xác minh"]',
    'body:has-text("checkpoint")',
    'body:has-text("temporarily blocked")',
    'body:has-text("verify your identity")',
    'body:has-text("xác minh danh tính")'
  ].join(', ')
}

async function exists(locator: LocatorLike): Promise<boolean> {
  try {
    return (await locator.count()) > 0
  } catch {
    return false
  }
}

async function defaultReadBack(
  page: CommentPageLike,
  content: string,
  selectors: MessengerSeedSelectors
): Promise<boolean> {
  await page.waitForTimeout?.(1_500)
  const thread = page.locator(selectors.sentMarker).first()
  if (!(await exists(thread))) return false
  const text = await thread.textContent?.()
  return typeof text === 'string' && text.includes(content)
}

export async function executeMessengerSeed(input: {
  page: CommentPageLike
  content: string
  selectors?: MessengerSeedSelectors
  readBack?: (page: CommentPageLike, content: string) => Promise<boolean>
}): Promise<ActionOutcome> {
  const selectors = input.selectors ?? MESSENGER_SEED_SELECTORS
  try {
    const checkpoint = input.page.locator(selectors.checkpointMarker).first()
    if (await exists(checkpoint)) return 'checkpoint'

    const box = input.page.locator(selectors.msgBox).first()
    if (!(await exists(box))) return 'selector_miss'
    await box.click()
    try {
      await box.fill(input.content)
    } catch {
      if (!input.page.keyboard) throw new Error('messenger composer cannot be filled')
      await input.page.keyboard.type(input.content, { delay: 15 })
    }
    await input.page.waitForTimeout?.(300)

    const send = input.page.locator(selectors.sendButton).first()
    if (await exists(send)) {
      await send.click()
    } else if (input.page.keyboard) {
      await input.page.keyboard.press('Enter')
    } else if (box.press) {
      await box.press('Enter')
    } else {
      return 'selector_miss'
    }

    const verified = input.readBack
      ? await input.readBack(input.page, input.content)
      : await defaultReadBack(input.page, input.content, selectors)
    return verified ? 'success' : 'selector_miss'
  } catch {
    return 'error'
  }
}
