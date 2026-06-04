import { test, expect } from '@playwright/test'
import { CaptchaSolveError, createTwoCaptchaClient } from '../../src/main/automation/checkpoint'

test('[P0] 2captcha sends FunCaptcha payload with proxy and parses token', async () => {
  const calls: Array<{ url: string; body: unknown }> = []
  const client = createTwoCaptchaClient({
    apiKey: 'TWO_CAPTCHA_SECRET',
    maxPolls: 1,
    sleep: async () => undefined,
    postJson: async (url, body) => {
      calls.push({ url, body })
      if (url.endsWith('/in.php')) return { status: 1, request: 'captcha-id' }
      return { status: 1, request: 'TWO_CAPTCHA_TOKEN' }
    }
  })

  await expect(
    client.solve({
      type: 'FUNCAPTCHA',
      publicKey: 'pk_test',
      websiteUrl: 'https://facebook.com/checkpoint',
      subdomain: 'facebook-api.arkoselabs.com',
      proxy: { server: 'http://127.0.0.1:8080', username: 'u', password: 'p' }
    })
  ).resolves.toBe('TWO_CAPTCHA_TOKEN')

  expect(calls[0]?.body).toMatchObject({
    method: 'funcaptcha',
    publickey: 'pk_test',
    surl: 'https://facebook-api.arkoselabs.com',
    proxy: 'u:p@127.0.0.1:8080',
    proxytype: 'HTTP'
  })
})

test('[P0] 2captcha supports legacy OK response and timeout', async () => {
  const client = createTwoCaptchaClient({
    apiKey: 'TWO_CAPTCHA_SECRET',
    maxPolls: 1,
    sleep: async () => undefined,
    postJson: async (url) => (url.endsWith('/in.php') ? 'OK|captcha-id' : 'CAPCHA_NOT_READY')
  })

  await expect(
    client.solve({ type: 'RECAPTCHA_V2', siteKey: 'site-key', websiteUrl: 'https://fb.test' })
  ).rejects.toMatchObject(new CaptchaSolveError('SOLVE_TIMEOUT'))
})
