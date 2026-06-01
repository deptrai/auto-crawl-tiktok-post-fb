import { join } from 'node:path'
import type { BrowserWindowConstructorOptions, Session } from 'electron'

const CSP_VALUE =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

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

export function registerCspHeaders(defaultSession: Session): void {
  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP_VALUE]
      }
    })
  })
}
