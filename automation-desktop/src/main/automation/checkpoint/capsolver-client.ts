import { CaptchaSolveError, type CaptchaParams, type CaptchaSolverClient } from './types'

type PostJson = (url: string, body: unknown) => Promise<unknown>

export interface CapSolverClientOptions {
  apiKey: string
  postJson?: PostJson
  sleep?: (ms: number) => Promise<void>
  pollIntervalMs?: number
  maxPolls?: number
}

interface CapSolverCreateResponse {
  errorId?: number
  errorCode?: string
  taskId?: string
}

interface CapSolverResultResponse {
  errorId?: number
  errorCode?: string
  status?: string
  solution?: { token?: string; gRecaptchaResponse?: string }
}

const CREATE_TASK_URL = 'https://api.capsolver.com/createTask'
const GET_TASK_RESULT_URL = 'https://api.capsolver.com/getTaskResult'

async function defaultPostJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!response.ok) throw new CaptchaSolveError('PROVIDER_ERROR')
  return response.json()
}

function proxyFields(proxy: CaptchaParams['proxy']): Record<string, unknown> {
  if (!proxy) return {}
  const url = new URL(proxy.server)
  return {
    proxyType: url.protocol.replace(':', '') || 'http',
    proxyAddress: url.hostname,
    proxyPort: Number(url.port),
    ...(proxy.username ? { proxyLogin: proxy.username } : {}),
    ...(proxy.password ? { proxyPassword: proxy.password } : {})
  }
}

function taskFor(params: CaptchaParams): Record<string, unknown> {
  if (params.type === 'FUNCAPTCHA') {
    return {
      type: params.proxy ? 'FunCaptchaTask' : 'FunCaptchaTaskProxyLess',
      websiteURL: params.websiteUrl,
      websitePublicKey: params.publicKey,
      ...(params.subdomain ? { funcaptchaApiJSSubdomain: params.subdomain } : {}),
      ...(params.blob ? { data: params.blob } : {}),
      ...proxyFields(params.proxy)
    }
  }

  return {
    type: params.proxy ? 'ReCaptchaV2Task' : 'ReCaptchaV2TaskProxyLess',
    websiteURL: params.websiteUrl,
    websiteKey: params.siteKey,
    isInvisible: params.invisible ?? false,
    ...proxyFields(params.proxy)
  }
}

function parseCreate(response: unknown): string {
  const parsed = response as CapSolverCreateResponse
  if (parsed.errorId && parsed.errorId !== 0) throw new CaptchaSolveError('PROVIDER_ERROR')
  if (!parsed.taskId) throw new CaptchaSolveError('PROVIDER_ERROR')
  return parsed.taskId
}

function parseResult(response: unknown): string | null {
  const parsed = response as CapSolverResultResponse
  if (parsed.errorId && parsed.errorId !== 0) throw new CaptchaSolveError('PROVIDER_ERROR')
  if (parsed.status === 'processing' || parsed.status === 'idle') return null
  if (parsed.status !== 'ready') throw new CaptchaSolveError('PROVIDER_ERROR')
  const token = parsed.solution?.token ?? parsed.solution?.gRecaptchaResponse
  if (!token) throw new CaptchaSolveError('PROVIDER_ERROR')
  return token
}

export function createCapSolverClient(options: CapSolverClientOptions): CaptchaSolverClient {
  const postJson = options.postJson ?? defaultPostJson
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const pollIntervalMs = options.pollIntervalMs ?? 2_000
  const maxPolls = options.maxPolls ?? 30

  return {
    name: 'capsolver',
    async solve(params) {
      if (!options.apiKey.trim()) throw new CaptchaSolveError('NO_API_KEY')
      const taskId = parseCreate(
        await postJson(CREATE_TASK_URL, { clientKey: options.apiKey, task: taskFor(params) })
      )

      for (let attempt = 0; attempt < maxPolls; attempt += 1) {
        const token = parseResult(
          await postJson(GET_TASK_RESULT_URL, { clientKey: options.apiKey, taskId })
        )
        if (token) return token
        await sleep(pollIntervalMs)
      }
      throw new CaptchaSolveError('SOLVE_TIMEOUT')
    }
  }
}
