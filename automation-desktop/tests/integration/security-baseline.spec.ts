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
