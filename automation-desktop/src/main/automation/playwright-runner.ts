import type { Browser, BrowserContext, BrowserType, LaunchOptions, Page } from 'playwright'
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Fingerprint } from '../../shared/types/fingerprint'
import type { PlaywrightCookie } from './cookie'

const DEFAULT_FB_URL = 'https://www.facebook.com/'
const DEFAULT_TIMEOUT_MS = 30_000
let stealthApplied = false

export interface PlaywrightProxyConfig {
  server: string
  username?: string
  password?: string
}

export interface LaunchSessionInput {
  proxy?: PlaywrightProxyConfig
  fingerprint: Fingerprint
  cookies: PlaywrightCookie[]
  headless?: boolean
  mobile?: boolean
  windowPosition?: { x: number; y: number }
  windowSize?: { width: number; height: number }
  viewport?: { width: number; height: number }
  userAgent?: string
  url?: string
  timeoutMs?: number
}

export interface SessionHandle {
  page: Page
  close(): Promise<void>
}

export interface PlaywrightRunner {
  launchSession(input: LaunchSessionInput): Promise<SessionHandle>
}

export type LaunchBrowser = (options: LaunchOptions) => Promise<Browser>
export type LaunchPersistentContext = (
  userDataDir: string,
  options: Parameters<BrowserType['launchPersistentContext']>[1]
) => Promise<BrowserContext>

export interface PlaywrightRunnerDeps {
  launchBrowser?: LaunchBrowser
  launchPersistentContext?: LaunchPersistentContext
}

export const MOBILE_BROWSER_VIEWPORT = { width: 390, height: 844 } as const
export const MOBILE_BROWSER_WINDOW_SIZE = { width: 500, height: 520 } as const
export const MOBILE_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

function reconcileUserAgentWithBrowser(userAgent: string, browser: Browser): string {
  const realMajor = browser.version().match(/^(\d+)\./)?.[1]
  return realMajor ? userAgent.replace(/Chrome\/\d+/, `Chrome/${realMajor}`) : userAgent
}

function applyStealth(): void {
  if (stealthApplied) return
  chromium.use(StealthPlugin())
  stealthApplied = true
}

async function defaultLaunchBrowser(options: LaunchOptions): Promise<Browser> {
  applyStealth()
  return (chromium as unknown as BrowserType).launch(options)
}

async function defaultLaunchPersistentContext(
  userDataDir: string,
  options: Parameters<BrowserType['launchPersistentContext']>[1]
): Promise<BrowserContext> {
  applyStealth()
  return (chromium as unknown as BrowserType).launchPersistentContext(userDataDir, options)
}

async function fitHeadedWindowToMobileViewport(
  page: Page,
  windowPosition: { x: number; y: number } | undefined,
  windowSize: { width: number; height: number } | undefined
): Promise<void> {
  if (!windowPosition || !windowSize) return

  try {
    const cdp = await page.context().newCDPSession(page)
    const { windowId } = await cdp.send('Browser.getWindowForTarget')
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        left: windowPosition.x,
        top: windowPosition.y,
        width: windowSize.width,
        height: windowSize.height
      }
    })
  } catch {
    /* Chromium may reject bounds in some headless/test runtimes; launch args still apply. */
  }
}

export function createPlaywrightRunner(deps: PlaywrightRunnerDeps = {}): PlaywrightRunner {
  const launchBrowser = deps.launchBrowser ?? defaultLaunchBrowser
  const launchPersistentContext = deps.launchPersistentContext ?? defaultLaunchPersistentContext

  return {
    async launchSession(input) {
      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const windowSize = input.windowSize ?? MOBILE_BROWSER_WINDOW_SIZE
      const launchArgs = input.headless
        ? undefined
        : [
            '--app=about:blank',
            '--disable-notifications',
            '--disable-infobars',
            '--disable-features=DesktopPWAsRunOnOsLogin,WebAppEnableLinkCapturing,IPH_DemoMode',
            `--window-size=${windowSize.width},${windowSize.height}`,
            ...(input.windowPosition
              ? [`--window-position=${input.windowPosition.x},${input.windowPosition.y}`]
              : [])
          ]
      const useMobile = input.mobile ?? true
      const userDataDir = input.headless ? undefined : mkdtempSync(join(tmpdir(), 'phase3-browser-'))
      let browser: Browser | undefined
      let context: BrowserContext | undefined
      try {
        if (input.headless) {
          browser = await launchBrowser({
            headless: true,
            proxy: input.proxy,
            timeout: timeoutMs
          })
        }
        const baseUserAgent = input.userAgent?.trim() || input.fingerprint.userAgent
        const userAgent = browser ? reconcileUserAgentWithBrowser(baseUserAgent, browser) : baseUserAgent
        const contextOptions = {
          userAgent,
          viewport: useMobile
            ? (input.viewport ?? MOBILE_BROWSER_VIEWPORT)
            : input.fingerprint.viewport,
          permissions: [],
          isMobile: false,
          hasTouch: false,
          timezoneId: input.fingerprint.timezone
        }

        context = input.headless
          ? await browser!.newContext(contextOptions)
          : await launchPersistentContext(userDataDir!, {
              ...contextOptions,
              headless: false,
              args: launchArgs,
              proxy: input.proxy,
              timeout: timeoutMs
            })
        await context.addCookies(input.cookies)
        const page = context.pages()[0] ?? (await context.newPage())
        page.on('dialog', (dialog) => {
          void dialog.dismiss().catch(() => undefined)
        })
        if (!input.headless) {
          await fitHeadedWindowToMobileViewport(page, input.windowPosition, windowSize)
        }
        await page.goto(input.url ?? DEFAULT_FB_URL, {
          timeout: timeoutMs,
          waitUntil: 'domcontentloaded'
        })
        return {
          page,
          async close() {
            try {
              await context?.close()
            } finally {
              await browser?.close()
              if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
            }
          }
        }
      } catch (error) {
        await context?.close().catch(() => undefined)
        await browser?.close().catch(() => undefined)
        if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
        throw error
      }
    }
  }
}
