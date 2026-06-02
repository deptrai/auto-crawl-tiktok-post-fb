import type { SecureStorage } from '../../adapters/secure-storage'
import type { SettingsRepository } from '../db/repositories/settings-repo'
import { generateHwid } from './hwid-generator'

const ACTIVATION_ID_KEY = 'license.activation_id'
const EXPIRES_AT_KEY = 'license.expires_at'
const REBIND_COUNT_KEY = 'license.rebind_count'

export interface LicenseStatus {
  active: boolean
  expiresAt?: string
  daysRemaining?: number
}

export interface BackendActivationResponse {
  activation_id: string
  expires_at: string
  rebind_count: number
}

export interface LicenseBackendClient {
  activate(key: string, hwid: string): Promise<BackendActivationResponse>
}

export interface LicenseService {
  activate(key: string): Promise<LicenseStatus>
  getStatus(): Promise<LicenseStatus>
}

export class LicenseServiceError extends Error {
  code: string
  retryable: boolean
  details?: unknown

  constructor(code: string, message: string, retryable = false, details?: unknown) {
    super(message)
    this.name = 'LicenseServiceError'
    this.code = code
    this.retryable = retryable
    this.details = details
  }
}

function strictDate(value: string | null): Date | null {
  if (!value) return null
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  return new Date(time)
}

export function calculateDaysRemaining(expiresAt: string, now = new Date()): number {
  const expiry = strictDate(expiresAt)
  if (!expiry) return 0
  const ms = expiry.getTime() - now.getTime()
  if (ms <= 0) return 0
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

async function parseBackendError(response: Response): Promise<LicenseServiceError> {
  try {
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; retryable?: boolean; details?: unknown }
      detail?: string
    }
    const code = payload.error?.code ?? `HTTP_${response.status}`
    const message = payload.error?.message ?? payload.detail ?? 'Không thể kích hoạt license.'
    return new LicenseServiceError(
      code,
      message,
      payload.error?.retryable ?? response.status >= 500,
      payload
    )
  } catch (error) {
    return new LicenseServiceError(
      `HTTP_${response.status}`,
      'Không thể đọc phản hồi kích hoạt license.',
      response.status >= 500,
      error
    )
  }
}

export function createFetchLicenseBackendClient(baseUrl: string): LicenseBackendClient {
  return {
    async activate(key, hwid) {
      let response: Response
      try {
        response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/automation/license/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, hwid })
        })
      } catch (error) {
        throw new LicenseServiceError(
          'NETWORK_ERROR',
          'Không thể kết nối máy chủ kích hoạt license. Vui lòng kiểm tra mạng rồi thử lại.',
          true,
          error
        )
      }

      if (!response.ok) throw await parseBackendError(response)
      return (await response.json()) as BackendActivationResponse
    }
  }
}

export function createLicenseService(deps: {
  settings: SettingsRepository
  storage: SecureStorage
  backendClient: LicenseBackendClient
  generateHwid?: () => Promise<string>
}): LicenseService {
  const getHwid = deps.generateHwid ?? generateHwid

  return {
    async activate(key) {
      const hwid = await getHwid()
      const result = await deps.backendClient.activate(key, hwid)

      await deps.settings.setSetting(EXPIRES_AT_KEY, result.expires_at)
      await deps.settings.setSetting(REBIND_COUNT_KEY, String(result.rebind_count))
      await deps.storage.set(ACTIVATION_ID_KEY, result.activation_id)

      return this.getStatus()
    },

    async getStatus() {
      const activationId = await deps.storage.get(ACTIVATION_ID_KEY)
      const expiresAt = deps.settings.getSetting(EXPIRES_AT_KEY)
      if (!activationId || !expiresAt) return { active: false }

      const daysRemaining = calculateDaysRemaining(expiresAt)
      if (daysRemaining <= 0) return { active: false, expiresAt, daysRemaining: 0 }

      return { active: true, expiresAt, daysRemaining }
    }
  }
}
