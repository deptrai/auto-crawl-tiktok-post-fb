import { test, expect } from '@playwright/test'
import type { HeadersReceivedResponse, OnHeadersReceivedListenerDetails, Session } from 'electron'
import { buildMainWindowOptions, registerCspHeaders } from '../../src/main/boot/security-baseline'

type HeadersHandler = (
  details: OnHeadersReceivedListenerDetails,
  callback: (response: HeadersReceivedResponse) => void
) => void

test('[P0] security baseline enforces hardened BrowserWindow webPreferences', () => {
  // Given: BrowserWindow options built from security baseline.
  const options = buildMainWindowOptions()

  // Then: mandatory hardening flags are enforced.
  expect(options.webPreferences?.sandbox).toBe(true)
  expect(options.webPreferences?.contextIsolation).toBe(true)
  expect(options.webPreferences?.nodeIntegration).toBe(false)
})

test('[P0] registerCspHeaders injects CSP header', () => {
  // Given: a mock session with webRequest hook.
  let handler: HeadersHandler | null = null

  const mockSession = {
    webRequest: {
      onHeadersReceived(cb: HeadersHandler) {
        handler = cb
      }
    }
  } as Pick<Session, 'webRequest'>

  registerCspHeaders(mockSession as Session)
  expect(handler).toBeTruthy()

  // When: response headers are intercepted.
  const inputHeaders: Record<string, string[]> = { 'X-Test': ['1'] }
  const details: OnHeadersReceivedListenerDetails = {
    id: 1,
    url: 'https://example.test/',
    method: 'GET',
    resourceType: 'mainFrame',
    referrer: '',
    timestamp: Date.now(),
    statusLine: 'HTTP/1.1 200 OK',
    statusCode: 200,
    responseHeaders: inputHeaders
  }
  let output: HeadersReceivedResponse | null = null
  handler?.(details, (result) => {
    output = result
  })

  // Then: CSP header is injected without dropping existing headers.
  expect(output?.responseHeaders?.['Content-Security-Policy']).toBeTruthy()
  expect(output?.responseHeaders?.['X-Test']).toEqual(['1'])
})

function captureCsp(options?: { allowDevRenderer?: boolean }): string {
  let handler: HeadersHandler | null = null
  const mockSession = {
    webRequest: {
      onHeadersReceived(cb: HeadersHandler) {
        handler = cb
      }
    }
  } as Pick<Session, 'webRequest'>

  registerCspHeaders(mockSession as Session, options)

  const details: OnHeadersReceivedListenerDetails = {
    id: 1,
    url: 'https://example.test/',
    method: 'GET',
    resourceType: 'mainFrame',
    referrer: '',
    timestamp: Date.now(),
    statusLine: 'HTTP/1.1 200 OK',
    statusCode: 200,
    responseHeaders: {}
  }
  let csp = ''
  handler?.(details, (result) => {
    csp = (result.responseHeaders?.['Content-Security-Policy']?.[0] as string) ?? ''
  })
  return csp
}

test('[P0] production CSP keeps script-src/connect-src strict (no unsafe-inline, no localhost)', () => {
  // Default call (allowDevRenderer omitted) mirrors packaged/production behavior.
  const prodCsp = captureCsp()
  const scriptSrc = prodCsp.split(';').find((d) => d.trim().startsWith('script-src')) ?? ''
  const connectSrc = prodCsp.split(';').find((d) => d.trim().startsWith('connect-src')) ?? ''

  expect(scriptSrc).not.toContain('unsafe-inline')
  expect(connectSrc).not.toContain('localhost')
  expect(connectSrc).not.toContain('127.0.0.1')
})

test('[P0] dev CSP relaxes for HMR only when allowDevRenderer is true', () => {
  const devCsp = captureCsp({ allowDevRenderer: true })
  const scriptSrc = devCsp.split(';').find((d) => d.trim().startsWith('script-src')) ?? ''
  const connectSrc = devCsp.split(';').find((d) => d.trim().startsWith('connect-src')) ?? ''

  expect(scriptSrc).toContain('unsafe-inline')
  expect(connectSrc).toContain('localhost')
})
