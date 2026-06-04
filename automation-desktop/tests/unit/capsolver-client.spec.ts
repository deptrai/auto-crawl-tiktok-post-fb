import { test, expect } from '@playwright/test'
import { CaptchaSolveError, createCapSolverClient } from '../../src/main/automation/checkpoint'

test('[P0] CapSolver sends FunCaptcha proxy task and parses token', async () => {
  const calls: Array<{ url: string; body: unknown }> = []
  const client = createCapSolverClient({
    apiKey: 'CAPSOLVER_SECRET',
    maxPolls: 1,
    sleep: async () => undefined,
    postJson: async (url, body) => {
      calls.push({ url, body })
      if (url.endsWith('/createTask')) return { errorId: 0, taskId: 'task-1' }
      return { errorId: 0, status: 'ready', solution: { token: 'CAPTCHA_TOKEN' } }
    }
  })

  await expect(
    client.solve({
      type: 'FUNCAPTCHA',
      publicKey: 'pk_test',
      websiteUrl: 'https://facebook.com/checkpoint',
      blob: 'blob-data',
      proxy: { server: 'http://127.0.0.1:8080', username: 'u', password: 'p' }
    })
  ).resolves.toBe('CAPTCHA_TOKEN')

  expect(calls[0]?.body).toMatchObject({
    task: {
      type: 'FunCaptchaTask',
      websitePublicKey: 'pk_test',
      data: 'blob-data',
      proxyAddress: '127.0.0.1',
      proxyPort: 8080,
      proxyLogin: 'u',
      proxyPassword: 'p'
    }
  })
})

test('[P0] CapSolver sends reCAPTCHA proxyless task and times out', async () => {
  const client = createCapSolverClient({
    apiKey: 'CAPSOLVER_SECRET',
    maxPolls: 1,
    sleep: async () => undefined,
    postJson: async (url) =>
      url.endsWith('/createTask')
        ? { errorId: 0, taskId: 'task-1' }
        : { errorId: 0, status: 'processing' }
  })

  await expect(
    client.solve({ type: 'RECAPTCHA_V2', siteKey: 'site-key', websiteUrl: 'https://fb.test' })
  ).rejects.toMatchObject(new CaptchaSolveError('SOLVE_TIMEOUT'))
})
