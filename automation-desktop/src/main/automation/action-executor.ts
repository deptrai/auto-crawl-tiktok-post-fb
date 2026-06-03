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
  textContent?(): Promise<string | null>
}

export interface CommentPageLike {
  locator(selector: string): LocatorLike
}

export interface SelfCommentSelectors {
  commentBox: string
  submit: string
  commentList: string
}

export const SELF_COMMENT_SELECTORS: SelfCommentSelectors = {
  commentBox: '[data-testid="self-comment-box"], [role="textbox"][contenteditable="true"]',
  submit: '[data-testid="self-comment-submit"], button[type="submit"]',
  commentList: '[data-testid="comment-list"], [aria-label="Bình luận"]'
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
    const box = input.page.locator(selectors.commentBox).first()
    if (!(await exists(box))) return 'selector_miss'
    await box.fill(input.content)

    const submit = input.page.locator(selectors.submit).first()
    if (!(await exists(submit))) return 'selector_miss'
    await submit.click()

    const verified = input.readBack
      ? await input.readBack(input.page, input.content)
      : await defaultReadBack(input.page, input.content, selectors)
    return verified ? 'success' : 'selector_miss'
  } catch {
    return 'error'
  }
}
