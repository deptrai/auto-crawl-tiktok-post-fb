import type { Browser, BrowserContext, BrowserType, LaunchOptions, Page } from 'playwright'
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
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

export interface PlaywrightRunnerDeps {
  launchBrowser?: LaunchBrowser
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

export function createPlaywrightRunner(deps: PlaywrightRunnerDeps = {}): PlaywrightRunner {
  const launchBrowser = deps.launchBrowser ?? defaultLaunchBrowser

  return {
    async launchSession(input) {
      const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const browser = await launchBrowser({
        headless: true,
        proxy: input.proxy,
        timeout: timeoutMs
      })
      let context: BrowserContext | undefined
      try {
        context = await browser.newContext({
          userAgent: input.fingerprint.userAgent,
          viewport: input.fingerprint.viewport,
          timezoneId: input.fingerprint.timezone
        })
        await context.addCookies(input.cookies)
        const page = await context.newPage()
        await page.goto(input.url ?? DEFAULT_FB_URL, {
          timeout: timeoutMs,
          waitUntil: 'domcontentloaded'
        })
        return {
          page,
          async close() {
            await context?.close()
            await browser.close()
          }
        }
      } catch (error) {
        await context?.close().catch(() => undefined)
        await browser.close().catch(() => undefined)
        throw error
      }
    }
  }
}
