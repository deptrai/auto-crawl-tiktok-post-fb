import { test, expect } from '@playwright/test'
import {
  CSHARP_SHARE_LINK_SELECTORS,
  executeMessengerShareLink,
  type ShareLinkPageLike
} from '../../src/main/automation/messenger-share-link-executor'

function pageWithVisible(
  selectors: Set<string>,
  labels: Record<string, string | null> = {}
): {
  page: ShareLinkPageLike
  clicks: string[]
  typed: string[]
  pressed: string[]
} {
  const clicks: string[] = []
  const typed: string[] = []
  const pressed: string[] = []
  const page: ShareLinkPageLike = {
    locator(selector: string) {
      return {
        first() {
          return this
        },
        async count() {
          return selectors.has(selector) ? 1 : 0
        },
        async click() {
          clicks.push(selector)
        },
        async fill(value: string) {
          typed.push(value)
        },
        async textContent() {
          return null
        },
        async getAttribute(name: string) {
          return name === 'aria-label' ? (labels[selector] ?? null) : null
        }
      }
    },
    keyboard: {
      async type(text: string) {
        typed.push(text)
      },
      async press(key: string) {
        pressed.push(key)
      }
    },
    async waitForTimeout(ms?: number) {
      void ms
    }
  }
  return { page, clicks, typed, pressed }
}

test('[P0] share-link executor follows selector fallback order and types lines with Shift+Enter', async () => {
  const visible = new Set([
    CSHARP_SHARE_LINK_SELECTORS.shareButtonFallbacks[1],
    CSHARP_SHARE_LINK_SELECTORS.messengerButtonFallbacks[2],
    CSHARP_SHARE_LINK_SELECTORS.composer,
    CSHARP_SHARE_LINK_SELECTORS.sendButtonFallbacks[0]
  ])
  const { page, clicks, typed, pressed } = pageWithVisible(visible, {
    [CSHARP_SHARE_LINK_SELECTORS.messengerButtonFallbacks[2]]: 'Messenger target A'
  })

  const result = await executeMessengerShareLink({
    page,
    contentLines: ['A😀', 'B'],
    clickedLabels: new Set()
  })

  expect(result).toEqual({ outcome: 'success' })
  expect(clicks).toEqual([
    CSHARP_SHARE_LINK_SELECTORS.shareButtonFallbacks[1],
    CSHARP_SHARE_LINK_SELECTORS.messengerButtonFallbacks[2],
    CSHARP_SHARE_LINK_SELECTORS.composer,
    CSHARP_SHARE_LINK_SELECTORS.sendButtonFallbacks[0]
  ])
  expect(typed).toEqual(['A', 'B'])
  expect(pressed).toContain('Shift+Enter')
})

test('[P0] share-link executor handles duplicate labels and could-not-send stop', async () => {
  const visible = new Set([
    CSHARP_SHARE_LINK_SELECTORS.shareButtonFallbacks[0],
    CSHARP_SHARE_LINK_SELECTORS.messengerButtonFallbacks[0],
    CSHARP_SHARE_LINK_SELECTORS.composer,
    CSHARP_SHARE_LINK_SELECTORS.sendButtonFallbacks[0],
    CSHARP_SHARE_LINK_SELECTORS.couldntSend
  ])
  const clickedLabels = new Set(['Messenger target A'])
  const dup = pageWithVisible(visible, {
    [CSHARP_SHARE_LINK_SELECTORS.messengerButtonFallbacks[0]]: 'Messenger target A'
  })

  await expect(
    executeMessengerShareLink({ page: dup.page, contentLines: ['A'], clickedLabels })
  ).resolves.toEqual({ outcome: 'error', reason: 'MESSENGER_CLICK_FAILED' })

  const blocked = pageWithVisible(visible, {
    [CSHARP_SHARE_LINK_SELECTORS.messengerButtonFallbacks[0]]: 'Messenger target B'
  })
  await expect(
    executeMessengerShareLink({ page: blocked.page, contentLines: ['A'], clickedLabels: new Set() })
  ).resolves.toEqual({ outcome: 'error', reason: 'BLOCKED_COULDNT_SEND' })
})
