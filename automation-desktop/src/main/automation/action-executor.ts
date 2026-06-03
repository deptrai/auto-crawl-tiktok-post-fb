export type ActionOutcome =
  | 'success'
  | 'checkpoint'
  | 'selector_miss'
  | 'proxy_error'
  | 'timeout'
  | 'error'

export interface LocatorLike {
  first(): LocatorLike
  count(): Promise<number>
  fill(value: string): Promise<void>
  click(): Promise<void>
  press?(key: string): Promise<void>
  textContent?(): Promise<string | null>
}

export interface CommentPageLike {
  locator(selector: string): LocatorLike
  content?: () => Promise<string>
  waitForTimeout?: (ms: number) => Promise<void>
  keyboard?: {
    type(text: string, options?: { delay?: number }): Promise<void>
    press(key: string): Promise<void>
  }
}

export interface SelfCommentSelectors {
  commentTrigger: string
  commentBox: string
  submit: string
  commentList: string
}

export const SELF_COMMENT_SELECTORS: SelfCommentSelectors = {
  commentTrigger: [
    '[data-testid="self-comment-trigger"]',
    '[aria-label="Comment"][role="button"]',
    '[aria-label="Bình luận"][role="button"]',
    '[aria-label*="Leave a comment"][role="button"]',
    '[aria-label*="Viết bình luận"][role="button"]',
    '[role="button"]:has-text("Comment")',
    '[role="button"]:has-text("Bình luận")'
  ].join(', '),
  commentBox: [
    '[data-testid="self-comment-box"]',
    '[role="textbox"][contenteditable="true"][aria-label*="Write a comment"]',
    '[role="textbox"][contenteditable="true"][aria-label*="Viết bình luận"]',
    '[role="textbox"][contenteditable="true"][aria-label*="Comment as"]',
    '[role="textbox"][contenteditable="true"][aria-label*="Bình luận với"]',
    '[role="textbox"][contenteditable="true"]'
  ].join(', '),
  submit: [
    '[data-testid="self-comment-submit"]',
    '[aria-label="Comment"][role="button"]',
    '[aria-label="Bình luận"][role="button"]',
    'button[aria-label="Comment"]',
    'button[aria-label="Bình luận"]',
    'button[type="submit"]'
  ].join(', '),
  commentList: '[data-testid="comment-list"], [aria-label*="Bình luận"], [aria-label*="Comment"]'
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
  selectors: SelfCommentSelectors
): Promise<boolean> {
  await page.waitForTimeout?.(1_500)
  const html = await page.content?.().catch(() => '')
  if (typeof html === 'string' && html.includes(content)) return true

  const list = page.locator(selectors.commentList).first()
  if (!(await exists(list))) return false
  const text = await list.textContent?.()
  return typeof text === 'string' && text.includes(content)
}

export async function executeSelfComment(input: {
  page: CommentPageLike
  content: string
  selectors?: SelfCommentSelectors
  readBack?: (page: CommentPageLike, content: string) => Promise<boolean>
}): Promise<ActionOutcome> {
  const selectors = input.selectors ?? SELF_COMMENT_SELECTORS
  try {
    let box = input.page.locator(selectors.commentBox).first()
    if (!(await exists(box))) {
      const trigger = input.page.locator(selectors.commentTrigger).first()
      if (await exists(trigger)) {
        await trigger.click()
        await input.page.waitForTimeout?.(1_000)
        box = input.page.locator(selectors.commentBox).first()
      }
    }
    if (!(await exists(box))) return 'selector_miss'
    await box.click()
    try {
      await box.fill(input.content)
    } catch {
      if (!input.page.keyboard) throw new Error('comment composer cannot be filled')
      await input.page.keyboard.type(input.content, { delay: 15 })
    }
    await input.page.waitForTimeout?.(300)

    const submit = input.page.locator(selectors.submit).first()
    if (await exists(submit)) {
      await submit.click()
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
