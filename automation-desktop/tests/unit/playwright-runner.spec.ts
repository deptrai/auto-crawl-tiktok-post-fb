import { test, expect } from '@playwright/test'
import type { Browser, BrowserContext, LaunchOptions, Page } from 'playwright'
import {
  createPlaywrightRunner,
  MOBILE_BROWSER_USER_AGENT,
  MOBILE_BROWSER_VIEWPORT,
  MOBILE_BROWSER_WINDOW_SIZE
} from '../../src/main/automation'
import type { Fingerprint } from '../../src/shared/types/fingerprint'

const fingerprint: Fingerprint = {
  version: 1,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1366, height: 768 },
  timezone: 'Asia/Ho_Chi_Minh',
  fonts: ['Arial'],
  webglNoise: 0.1
}

test('[P1] playwright runner launches visible mobile browser with fixed size and position', async () => {
  let userDataDir: string | undefined
  let launchOptions: Parameters<NonNullable<Parameters<typeof createPlaywrightRunner>[0]>['launchPersistentContext']>[1]
  let contextOptions: Parameters<Browser['newContext']>[0]
  const page = {
    goto: async () => undefined
  } as unknown as Page
  const context = {
    addCookies: async () => undefined,
    newPage: async () => page,
    pages: () => [page],
    close: async () => undefined
  } as unknown as BrowserContext

  const runner = createPlaywrightRunner({
    launchPersistentContext: async (dir, options) => {
      userDataDir = dir
      launchOptions = options
      contextOptions = options
      return context
    }
  })

  await runner.launchSession({
    fingerprint,
    cookies: [],
    headless: false,
    mobile: true,
    windowPosition: { x: 438, y: 0 },
    windowSize: MOBILE_BROWSER_WINDOW_SIZE
  })

  expect(userDataDir).toContain('phase3-browser-')
  expect(launchOptions?.headless).toBe(false)
  expect(launchOptions?.args).toEqual([
    '--app=about:blank',
    '--window-size=500,520',
    '--window-position=438,0'
  ])
  expect(contextOptions).toMatchObject({
    userAgent: MOBILE_BROWSER_USER_AGENT,
    viewport: MOBILE_BROWSER_VIEWPORT,
    isMobile: false,
    hasTouch: true,
    timezoneId: 'Asia/Ho_Chi_Minh'
  })
})

test('[P1] playwright runner can align mobile viewport width with dynamic window width', async () => {
  let contextOptions: Parameters<NonNullable<Parameters<typeof createPlaywrightRunner>[0]>['launchPersistentContext']>[1]
  const page = {
    goto: async () => undefined
  } as unknown as Page
  const context = {
    addCookies: async () => undefined,
    newPage: async () => page,
    pages: () => [page],
    close: async () => undefined
  } as unknown as BrowserContext
  const runner = createPlaywrightRunner({
    launchPersistentContext: async (_dir, options) => {
      contextOptions = options
      return context
    }
  })

  await runner.launchSession({
    fingerprint,
    cookies: [],
    headless: false,
    mobile: true,
    viewport: { width: 300, height: 420 },
    windowSize: { width: 300, height: 540 }
  })

  expect(contextOptions).toMatchObject({
    viewport: { width: 300, height: 420 },
    isMobile: false,
    hasTouch: true
  })
})

test('[P1] playwright runner prefers imported user agent when provided', async () => {
  let contextOptions: Parameters<NonNullable<Parameters<typeof createPlaywrightRunner>[0]>['launchPersistentContext']>[1]
  const page = {
    goto: async () => undefined
  } as unknown as Page
  const context = {
    addCookies: async () => undefined,
    newPage: async () => page,
    pages: () => [page],
    close: async () => undefined
  } as unknown as BrowserContext
  const runner = createPlaywrightRunner({
    launchPersistentContext: async (_dir, options) => {
      contextOptions = options
      return context
    }
  })
  const importedUserAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'

  await runner.launchSession({
    fingerprint,
    cookies: [],
    headless: false,
    mobile: true,
    userAgent: importedUserAgent
  })

  expect(contextOptions?.userAgent).toBe(importedUserAgent)
})

test('[P1] playwright runner keeps headless mode hidden while still using mobile context', async () => {
  let launchOptions: LaunchOptions | undefined
  const page = {
    goto: async () => undefined
  } as unknown as Page
  const context = {
    addCookies: async () => undefined,
    newPage: async () => page,
    pages: () => [],
    close: async () => undefined
  } as unknown as BrowserContext
  const browser = {
    version: () => '120.0.0.0',
    newContext: async () => context,
    close: async () => undefined
  } as unknown as Browser

  const runner = createPlaywrightRunner({
    launchBrowser: async (options) => {
      launchOptions = options
      return browser
    }
  })

  await runner.launchSession({ fingerprint, cookies: [], headless: true, mobile: true })

  expect(launchOptions?.headless).toBe(true)
  expect(launchOptions?.args).toBeUndefined()
})
