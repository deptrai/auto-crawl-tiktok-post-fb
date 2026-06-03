import { test, expect } from '@playwright/test'
import { ProxyServiceError } from '../../src/main/proxy'
import { ProxyfbProvider, parseProxyString } from '../../src/main/proxy/providers/proxyfb'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

function statusResponse(status: number): Response {
  return new Response(JSON.stringify({ success: 'False', proxy: '' }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

test.afterEach(() => {
  Reflect.deleteProperty(globalThis, 'fetch')
})

test('[P0] proxyfb provider returns proxy from changeProxy happy path', async () => {
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return jsonResponse({ success: 'True', proxy: '1.2.3.4:8080:user:pass' })
  }) as typeof fetch
  const provider = new ProxyfbProvider({ baseUrl: 'http://proxyfb.test/api' })

  const proxy = await provider.getProxy('KEY-123')

  expect(proxy).toEqual({ host: '1.2.3.4', port: 8080, username: 'user', password: 'pass' })
  expect(calls).toHaveLength(1)
  expect(calls[0]).toContain('/changeProxy.php?key=KEY-123')
})

test('[P0] proxyfb provider falls back to getProxy when changeProxy fails', async () => {
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    if (String(input).includes('changeProxy.php')) {
      return jsonResponse({ success: 'False', proxy: '' })
    }
    return jsonResponse({ success: 'True', proxy: '5.6.7.8:3128:fallback:secret' })
  }) as typeof fetch
  const provider = new ProxyfbProvider({ baseUrl: 'http://proxyfb.test/api' })

  const proxy = await provider.getProxy('KEY-123')

  expect(proxy).toEqual({
    host: '5.6.7.8',
    port: 3128,
    username: 'fallback',
    password: 'secret'
  })
  expect(calls.map((url) => new URL(url).pathname)).toEqual([
    '/api/changeProxy.php',
    '/api/getProxy.php'
  ])
})

test('[P1] proxyfb provider falls back when changeProxy returns HTTP error status', async () => {
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    if (String(input).includes('changeProxy.php')) return statusResponse(500)
    return jsonResponse({ success: 'True', proxy: '9.9.9.9:8081:fallback:secret' })
  }) as typeof fetch
  const provider = new ProxyfbProvider({ baseUrl: 'http://proxyfb.test/api' })

  const proxy = await provider.getProxy('KEY-123')

  expect(proxy).toEqual({
    host: '9.9.9.9',
    port: 8081,
    username: 'fallback',
    password: 'secret'
  })
  expect(calls.map((url) => new URL(url).pathname)).toEqual([
    '/api/changeProxy.php',
    '/api/getProxy.php'
  ])
})

test('[P0] proxyfb provider throws retryable unavailable when both endpoints fail', async () => {
  globalThis.fetch = (async () => jsonResponse({ success: 'False', proxy: '' })) as typeof fetch
  const provider = new ProxyfbProvider({ baseUrl: 'http://proxyfb.test/api' })

  await expect(provider.getProxy('KEY-123')).rejects.toMatchObject({
    code: 'PROXY_UNAVAILABLE',
    retryable: true
  } satisfies Partial<ProxyServiceError>)
})

test('[P1] parseProxyString parses host port username password', () => {
  expect(parseProxyString('proxy.example.com:65535:my-user:my-pass')).toEqual({
    host: 'proxy.example.com',
    port: 65535,
    username: 'my-user',
    password: 'my-pass'
  })
})

test('[P1] parseProxyString accepts password containing colon', () => {
  expect(parseProxyString('h:8080:u:pa:ss')).toEqual({
    host: 'h',
    port: 8080,
    username: 'u',
    password: 'pa:ss'
  })
})

test('[P1] parseProxyString rejects malformed proxy string and invalid port', () => {
  expect(() => parseProxyString('proxy.example.com:8080:user')).toThrow(/proxy/i)
  expect(() => parseProxyString('proxy.example.com\r\n:8080:user:pass')).toThrow(/proxy/i)
  expect(() => parseProxyString('proxy.example.com:8080abc:user:pass')).toThrow(/port/i)
  expect(() => parseProxyString('proxy.example.com:0:user:pass')).toThrow(/port/i)
  expect(() => parseProxyString('proxy.example.com:70000:user:pass')).toThrow(/port/i)
})

test('[P1] parseProxyString format and port errors are non-retryable data errors', () => {
  expect(() => parseProxyString('proxy.example.com\r\n:8080:user:pass')).toThrow(
    expect.objectContaining({ code: 'PROXY_FORMAT_INVALID', retryable: false })
  )
  expect(() => parseProxyString('proxy.example.com:65536:user:pass')).toThrow(
    expect.objectContaining({ code: 'PROXY_PORT_INVALID', retryable: false })
  )
})
