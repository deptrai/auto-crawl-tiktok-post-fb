import { join } from 'node:path'
import type { BrowserWindowConstructorOptions, Session } from 'electron'

const CSP_VALUE =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

const DEV_CSP_VALUE =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

export function buildMainWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  }
}

export function registerCspHeaders(
  defaultSession: Session,
  options: { allowDevRenderer?: boolean } = {}
): void {
  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [options.allowDevRenderer ? DEV_CSP_VALUE : CSP_VALUE]
      }
    })
  })
}
