import { test, expect } from '@playwright/test'
import { resolveOwnPostTarget } from '../../src/main/automation/own-post-target-resolver'

test('[P0] own post resolver accepts Facebook permalink.php URLs missed by old selector', async () => {
  const href = '/permalink.php?story_fbid=123&id=61584385089407'

  await expect(
    resolveOwnPostTarget({
      getAttribute: async () => href,
      evaluate: async () => []
    })
  ).resolves.toBe('https://www.facebook.com/permalink.php?story_fbid=123&id=61584385089407')
})

test('[P0] own post resolver collects lazy-loaded Facebook story anchors after scrolling', async () => {
  let calls = 0

  await expect(
    resolveOwnPostTarget(
      {
        getAttribute: async () => null,
        waitForTimeout: async () => undefined,
        evaluate: async (fn) => {
          calls += 1
          const source = fn.toString()
          if (source.includes('scrollBy')) return undefined as never
          return (
            calls > 2 ? ['https://www.facebook.com/story.php?story_fbid=999&id=61584385089407'] : []
          ) as never
        }
      },
      { settleMs: 0 }
    )
  ).resolves.toBe('https://www.facebook.com/story.php?story_fbid=999&id=61584385089407')
})

test('[P0] own post resolver ignores Facebook watch tab navigation and chooses a real post', async () => {
  await expect(
    resolveOwnPostTarget(
      {
        getAttribute: async () => 'https://www.facebook.com/watch/?ref=tab',
        waitForTimeout: async () => undefined,
        evaluate: async (fn) => {
          if (fn.toString().includes('scrollBy')) return undefined as never
          return [
            'https://www.facebook.com/watch/?ref=tab',
            'https://www.facebook.com/reel/?ref=profile',
            'https://www.facebook.com/permalink.php?story_fbid=123&id=61584385089407'
          ] as never
        }
      },
      { settleMs: 0 }
    )
  ).resolves.toBe('https://www.facebook.com/permalink.php?story_fbid=123&id=61584385089407')
})

test('[P1] own post resolver accepts concrete watch video links but rejects the watch tab', async () => {
  await expect(
    resolveOwnPostTarget({
      url: () => 'https://www.facebook.com/watch/?ref=tab',
      getAttribute: async () => null,
      evaluate: async () => ['https://www.facebook.com/watch/?v=123456789']
    })
  ).resolves.toBe('https://www.facebook.com/watch/?v=123456789')
})

test('[P1] own post resolver returns current URL when already on a post page', async () => {
  await expect(
    resolveOwnPostTarget({
      url: () => 'https://www.facebook.com/61584385089407/posts/777',
      evaluate: async () => []
    })
  ).resolves.toBe('https://www.facebook.com/61584385089407/posts/777')
})
