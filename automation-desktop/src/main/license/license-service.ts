import type { SecureStorage } from '../../adapters/secure-storage'
import {
  BackendActivationResponseSchema,
  BackendHttpError,
  postJson,
  type BackendActivationResponse
} from '../../shared/api-client/http-client'
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

export type { BackendActivationResponse }

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

function normalizeServiceError(error: unknown): LicenseServiceError {
  if (error instanceof LicenseServiceError) return error
  if (error instanceof BackendHttpError) {
    return new LicenseServiceError(error.code, error.message, error.retryable, error.details)
  }
  return new LicenseServiceError(
    'LICENSE_ERROR',
    error instanceof Error ? error.message : 'Không thể xử lý license.',
    true,
    error
  )
}

export function createFetchLicenseBackendClient(
  baseUrl: string,
  timeoutMs = 15_000
): LicenseBackendClient {
  return {
    async activate(key, hwid) {
      return postJson({
        url: `${baseUrl.replace(/\/$/, '')}/api/v1/automation/license/activate`,
        body: { key, hwid },
        schema: BackendActivationResponseSchema,
        timeoutMs
      })
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
      try {
        const hwid = await getHwid()
        const result = await deps.backendClient.activate(key, hwid)

        await deps.storage.set(ACTIVATION_ID_KEY, result.activation_id)
        try {
          await deps.settings.setSetting(EXPIRES_AT_KEY, result.expires_at)
          await deps.settings.setSetting(REBIND_COUNT_KEY, String(result.rebind_count))
        } catch (settingsError) {
          await deps.storage.delete(ACTIVATION_ID_KEY)
          throw new LicenseServiceError(
            'LICENSE_PERSIST_FAILED',
            'Không thể lưu trạng thái license. Vui lòng thử lại.',
            true,
            settingsError
          )
        }

        return this.getStatus()
      } catch (error) {
        throw normalizeServiceError(error)
      }
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
