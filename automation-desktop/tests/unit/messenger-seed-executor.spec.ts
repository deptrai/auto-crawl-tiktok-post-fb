import { test, expect } from '@playwright/test'
import {
  executeMessengerSeed,
  MESSENGER_SEED_SELECTORS,
  type MessengerSeedSelectors
} from '../../src/main/automation/messenger-seed-executor'
import type { LocatorLike } from '../../src/main/automation/action-executor'

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
  waitForTimeout: (ms: number) => Promise<void>
  content: () => Promise<string>
} {
  return {
    locator(selector) {
      return locators[selector] ?? new FakeLocator(false)
    },
    waitForTimeout: async () => undefined,
    content: async () => '<html></html>'
  }
}

test('[P0] messenger seed executor fills composer, sends, and verifies readback', async () => {
  const box = new FakeLocator()
  const send = new FakeLocator()
  const page = fakePage({
    [MESSENGER_SEED_SELECTORS.msgBox]: box,
    [MESSENGER_SEED_SELECTORS.sendButton]: send
  })

  const outcome = await executeMessengerSeed({
    page,
    content: 'Xin chào UID 1001',
    readBack: async (_page, content) => content === 'Xin chào UID 1001'
  })

  expect(outcome).toBe('success')
  expect(box.filled).toEqual(['Xin chào UID 1001'])
  expect(send.clicked).toBe(1)
})

test('[P0] messenger seed executor returns selector_miss when composer is absent', async () => {
  const send = new FakeLocator()
  const page = fakePage({ [MESSENGER_SEED_SELECTORS.sendButton]: send })

  await expect(
    executeMessengerSeed({ page, content: 'Không gửi', readBack: async () => true })
  ).resolves.toBe('selector_miss')
  expect(send.clicked).toBe(0)
})

test('[P0] messenger seed executor returns checkpoint when checkpoint selector is present', async () => {
  const selectors: MessengerSeedSelectors = {
    ...MESSENGER_SEED_SELECTORS,
    checkpointMarker: '[data-testid="checkpoint"]'
  }
  const page = fakePage({
    [selectors.checkpointMarker]: new FakeLocator(),
    [selectors.msgBox]: new FakeLocator(),
    [selectors.sendButton]: new FakeLocator()
  })

  await expect(
    executeMessengerSeed({ page, content: 'Không gửi khi checkpoint', selectors })
  ).resolves.toBe('checkpoint')
})

test('[P0] messenger seed executor maps locator errors to error without leaking content', async () => {
  const page = {
    ...fakePage({}),
    locator() {
      throw new Error('DOM failure SECRET_MESSAGE')
    }
  }

  const outcome = await executeMessengerSeed({ page, content: 'SECRET_MESSAGE' })

  expect(outcome).toBe('error')
  expect(JSON.stringify(outcome)).not.toContain('SECRET_MESSAGE')
})
