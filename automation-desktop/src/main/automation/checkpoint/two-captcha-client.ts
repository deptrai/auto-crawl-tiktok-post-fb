import { CaptchaSolveError, type CaptchaParams, type CaptchaSolverClient } from './types'

type PostJson = (url: string, body: unknown) => Promise<unknown>

export interface TwoCaptchaClientOptions {
  apiKey: string
  postJson?: PostJson
  sleep?: (ms: number) => Promise<void>
  initialDelayMs?: number
  pollIntervalMs?: number
  maxPolls?: number
}

const CREATE_URL = 'https://2captcha.com/in.php'
const RESULT_URL = 'https://2captcha.com/res.php'

async function defaultPostJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) throw new CaptchaSolveError('PROVIDER_ERROR')
  const text = await response.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function proxyString(proxy: CaptchaParams['proxy']): string | undefined {
  if (!proxy) return undefined
  const url = new URL(proxy.server)
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password ?? '')}@`
    : ''
  return `${auth}${url.hostname}:${url.port}`
}

function proxyType(server: string): string {
  return new URL(server).protocol.replace(':', '').toUpperCase() || 'HTTP'
}

function createPayload(apiKey: string, params: CaptchaParams): Record<string, unknown> {
  const proxy = proxyString(params.proxy)
  const base = {
    key: apiKey,
    json: 1,
    pageurl: params.websiteUrl,
    ...(proxy && params.proxy ? { proxy, proxytype: proxyType(params.proxy.server) } : {})
  }

  if (params.type === 'FUNCAPTCHA') {
    return {
      ...base,
      method: 'funcaptcha',
      publickey: params.publicKey,
      ...(params.subdomain ? { surl: `https://${params.subdomain}` } : {}),
      ...(params.blob ? { data: params.blob } : {})
    }
  }

  return {
    ...base,
    method: 'userrecaptcha',
    googlekey: params.siteKey,
    invisible: params.invisible ? 1 : 0
  }
}

function parseCreate(response: unknown): string {
  if (typeof response === 'string') {
    if (response.startsWith('OK|')) return response.slice(3)
    throw new CaptchaSolveError('PROVIDER_ERROR')
  }
  const parsed = response as { status?: number | string; request?: string }
  if (String(parsed.status) !== '1' || !parsed.request) {
    throw new CaptchaSolveError('PROVIDER_ERROR')
  }
  return parsed.request
}

function parseResult(response: unknown): string | null {
  if (typeof response === 'string') {
    if (response === 'CAPCHA_NOT_READY') return null
    if (response.startsWith('OK|')) return response.slice(3)
    throw new CaptchaSolveError('PROVIDER_ERROR')
  }
  const parsed = response as { status?: number | string; request?: string }
  if (String(parsed.status) === '0' && parsed.request === 'CAPCHA_NOT_READY') return null
  if (String(parsed.status) !== '1' || !parsed.request) {
    throw new CaptchaSolveError('PROVIDER_ERROR')
  }
  return parsed.request
}

export function createTwoCaptchaClient(options: TwoCaptchaClientOptions): CaptchaSolverClient {
  const postJson = options.postJson ?? defaultPostJson
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const initialDelayMs = options.initialDelayMs ?? 15_000
  const pollIntervalMs = options.pollIntervalMs ?? 5_000
  const maxPolls = options.maxPolls ?? 24

  return {
    name: '2captcha',
    async solve(params) {
      if (!options.apiKey.trim()) throw new CaptchaSolveError('NO_API_KEY')
      const captchaId = parseCreate(
        await postJson(CREATE_URL, createPayload(options.apiKey, params))
      )

      await sleep(initialDelayMs)
      for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        const token = parseResult(
          await postJson(RESULT_URL, {
            key: options.apiKey,
            json: 1,
            action: 'get',
            id: captchaId
          })
        )
        if (token) return token
        await sleep(pollIntervalMs)
      }
      throw new CaptchaSolveError('SOLVE_TIMEOUT')
    }
  }
}
