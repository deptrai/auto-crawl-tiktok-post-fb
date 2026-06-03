import { test, expect } from '@playwright/test'
import {
  executeSelfComment,
  SELF_COMMENT_SELECTORS,
  type LocatorLike
} from '../../src/main/automation/action-executor'

class FakeLocator implements LocatorLike {
  filled: string[] = []
  clicked = 0

  constructor(private readonly present = true) {}

  first(): LocatorLike {
    return this
  }

  async count(): Promise<number> {
    return this.present ? 1 : 0
  }

  async fill(value: string): Promise<void> {
    this.filled.push(value)
  }

  async click(): Promise<void> {
    this.clicked += 1
  }
}

function fakePage(locators: Record<string, FakeLocator>): {
  locator: (selector: string) => LocatorLike
} {
  return {
    locator(selector) {
      return locators[selector] ?? new FakeLocator(false)
    }
  }
}

test('[P0] action executor fills, submits, and verifies read-back', async () => {
  const box = new FakeLocator()
  const submit = new FakeLocator()
  const page = fakePage({
    [SELF_COMMENT_SELECTORS.commentBox]: box,
    [SELF_COMMENT_SELECTORS.submit]: submit
  })

  const outcome = await executeSelfComment({
    page,
    content: 'Bình luận kiểm thử',
    readBack: async (_page, content) => content === 'Bình luận kiểm thử'
  })

  expect(outcome).toBe('success')
  expect(box.filled).toEqual(['Bình luận kiểm thử'])
  expect(submit.clicked).toBe(1)
})

test('[P0] action executor returns selector_miss when composer is absent', async () => {
  const submit = new FakeLocator()
  const page = fakePage({ [SELF_COMMENT_SELECTORS.submit]: submit })

  await expect(
    executeSelfComment({ page, content: 'Không chạy', readBack: async () => true })
  ).resolves.toBe('selector_miss')
  expect(submit.clicked).toBe(0)
})

test('[P0] action executor maps submit failures to error without leaking content', async () => {
  const box = new FakeLocator()
  const submit = new FakeLocator()
  submit.click = async () => {
    throw new Error('submit failed with secret-ish content')
  }
  const page = fakePage({
    [SELF_COMMENT_SELECTORS.commentBox]: box,
    [SELF_COMMENT_SELECTORS.submit]: submit
  })

  const outcome = await executeSelfComment({
    page,
    content: 'SECRET_COMMENT_CONTENT',
    readBack: async () => true
  })

  expect(outcome).toBe('error')
  expect(JSON.stringify(outcome)).not.toContain('SECRET_COMMENT_CONTENT')
})
