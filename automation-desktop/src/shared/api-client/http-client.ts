import { z } from 'zod'

export const BackendActivationResponseSchema = z.object({
  activation_id: z.string().uuid(),
  expires_at: z.string().datetime({ offset: true }),
  rebind_count: z.number().int().min(0)
})

export type BackendActivationResponse = z.infer<typeof BackendActivationResponseSchema>

export const BackendLicenseCheckResponseSchema = z.object({
  active: z.boolean(),
  expires_at: z.string().datetime({ offset: true }),
  revoked: z.boolean(),
  rebind_count: z.number().int().min(0)
})

export type BackendLicenseCheckResponse = z.infer<typeof BackendLicenseCheckResponseSchema>

export const BackendActionTokenResponseSchema = z.object({
  token: z.string().min(1),
  jti: z.string().min(1),
  expires_at: z.string().datetime({ offset: true })
})

export type BackendActionTokenResponse = z.infer<typeof BackendActionTokenResponseSchema>

export class BackendHttpError extends Error {
  code: string
  retryable: boolean
  details?: unknown

  constructor(code: string, message: string, retryable = false, details?: unknown) {
    super(message)
    this.name = 'BackendHttpError'
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}

async function parseBackendError(response: Response): Promise<BackendHttpError> {
  try {
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; retryable?: boolean; details?: unknown }
      detail?: string
    }
    const code = payload.error?.code ?? `HTTP_${response.status}`
    const message = payload.error?.message ?? payload.detail ?? 'Không thể kích hoạt license.'
    return new BackendHttpError(
      code,
      message,
      payload.error?.retryable ?? response.status >= 500,
      payload
    )
  } catch (error) {
    return new BackendHttpError(
      `HTTP_${response.status}`,
      'Không thể đọc phản hồi kích hoạt license.',
      response.status >= 500,
      error
    )
  }
}

export async function postJson<T>(options: {
  url: string
  body: unknown
  schema: z.ZodType<T>
  timeoutMs?: number
}): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)

  let response: Response
  try {
    response = await fetch(options.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.body),
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new BackendHttpError(
        'NETWORK_TIMEOUT',
        'Máy chủ kích hoạt license phản hồi quá chậm. Vui lòng thử lại.',
        true,
        error
      )
    }
    throw new BackendHttpError(
      'NETWORK_ERROR',
      'Không thể kết nối máy chủ kích hoạt license. Vui lòng kiểm tra mạng rồi thử lại.',
      true,
      error
    )
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) throw await parseBackendError(response)

  try {
    return options.schema.parse(await response.json())
  } catch (error) {
    throw new BackendHttpError(
      'BACKEND_RESPONSE_INVALID',
      'Phản hồi kích hoạt license không hợp lệ. Vui lòng thử lại.',
      true,
      error
    )
  }
}
