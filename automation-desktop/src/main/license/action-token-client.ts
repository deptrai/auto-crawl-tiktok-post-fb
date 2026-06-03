import {
  BackendActionTokenConsumeResponseSchema,
  BackendActionTokenResponseSchema,
  BackendHttpError,
  postJson as defaultPostJson,
  type BackendActionTokenConsumeResponse,
  type BackendActionTokenResponse
} from '../../shared/api-client/http-client'
import { generateHwid as defaultGenerateHwid } from './hwid-generator'

export interface ActionToken {
  token: string
  jti: string
  expiresAt: string
}

export interface ActionTokenRequest {
  actionType: string
}

export interface ActionTokenClient {
  requestActionToken(request: ActionTokenRequest): Promise<ActionToken>
  consumeActionToken(token: string): Promise<{ jti: string; consumedAt: string }>
}

export class ActionTokenClientError extends Error {
  code: string
  retryable: boolean

  constructor(code: string, message: string, retryable = false) {
    super(message)
    this.name = 'ActionTokenClientError'
    this.code = code
    this.retryable = retryable
  }
}

type PostJson = typeof defaultPostJson

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '')
}

function isNetworkBackendError(error: BackendHttpError): boolean {
  return error.code === 'NETWORK_ERROR' || error.code === 'NETWORK_TIMEOUT'
}

function normalizeActionTokenError(error: unknown): ActionTokenClientError {
  if (error instanceof ActionTokenClientError) return error
  if (error instanceof BackendHttpError) {
    if (isNetworkBackendError(error)) {
      return new ActionTokenClientError(
        'ACTION_TOKEN_OFFLINE',
        'Mất kết nối — không thể cấp token cho hành động.',
        true
      )
    }
    return new ActionTokenClientError(
      'ACTION_TOKEN_DENIED',
      error.message || 'Máy chủ từ chối cấp token cho hành động.',
      false
    )
  }
  return new ActionTokenClientError(
    'ACTION_TOKEN_DENIED',
    'Không thể cấp token cho hành động.',
    false
  )
}

export function createActionTokenClient(deps: {
  baseUrl: string
  getLicenseKey: () => Promise<string> | string
  generateHwid?: () => Promise<string>
  postJson?: PostJson
  timeoutMs?: number
}): ActionTokenClient {
  const requestJson = deps.postJson ?? defaultPostJson
  const getHwid = deps.generateHwid ?? defaultGenerateHwid
  const baseUrl = normalizeBaseUrl(deps.baseUrl)

  return {
    async requestActionToken(request) {
      try {
        const [key, hwid] = await Promise.all([deps.getLicenseKey(), getHwid()])
        const response: BackendActionTokenResponse = await requestJson({
          url: `${baseUrl}/api/v1/automation/action/token`,
          body: { key, hwid, action_type: request.actionType },
          schema: BackendActionTokenResponseSchema,
          timeoutMs: deps.timeoutMs
        })
        return { token: response.token, jti: response.jti, expiresAt: response.expires_at }
      } catch (error) {
        throw normalizeActionTokenError(error)
      }
    },

    async consumeActionToken(token) {
      try {
        const response: BackendActionTokenConsumeResponse = await requestJson({
          url: `${baseUrl}/api/v1/automation/action/token/consume`,
          body: { token },
          schema: BackendActionTokenConsumeResponseSchema,
          timeoutMs: deps.timeoutMs
        })
        return { jti: response.jti, consumedAt: response.consumed_at }
      } catch (error) {
        throw normalizeActionTokenError(error)
      }
    }
  }
}
