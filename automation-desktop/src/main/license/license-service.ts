import type { SecureStorage } from '../../adapters/secure-storage'
import {
  BackendActivationResponseSchema,
  BackendLicenseCheckResponseSchema,
  BackendHttpError,
  postJson,
  type BackendActivationResponse,
  type BackendLicenseCheckResponse
} from '../../shared/api-client/http-client'
import type { SettingsRepository } from '../db/repositories/settings-repo'
import { generateHwid } from './hwid-generator'

const ACTIVATION_ID_KEY = 'license.activation_id'
const EXPIRES_AT_KEY = 'license.expires_at'
const LAST_SUCCESS_CHECK_KEY = 'license.last_success_check'
const REBIND_COUNT_KEY = 'license.rebind_count'
const REVOKED_KEY = 'license.revoked'
const OFFLINE_GRACE_MS = 24 * 60 * 60 * 1000
const EXPIRED_READONLY_GRACE_MS = 7 * 24 * 60 * 60 * 1000

export type LicenseGate = 'active' | 'offline-grace' | 'expired-readonly' | 'locked'

export interface LicenseStatus {
  active: boolean
  gate: LicenseGate
  expiresAt?: string
  daysRemaining?: number
  offlineGraceValid?: boolean
  expiredReadonlyValid?: boolean
}

export type { BackendActivationResponse, BackendLicenseCheckResponse }

export interface LicenseBackendClient {
  activate(key: string, hwid: string): Promise<BackendActivationResponse>
  check(activationId: string): Promise<BackendLicenseCheckResponse>
}

export interface LicenseService {
  activate(key: string): Promise<LicenseStatus>
  check(): Promise<LicenseStatus>
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

function isWithin(value: Date | null, now: Date, durationMs: number): boolean {
  if (!value) return false
  const elapsedMs = now.getTime() - value.getTime()
  return elapsedMs >= 0 && elapsedMs < durationMs
}

function localStatus(options: {
  activationId: string | null
  expiresAt: string | null
  lastSuccessCheck: string | null
  now: Date
  offlineFallback?: boolean
  revoked?: boolean
  /**
   * Server's authoritative `active` verdict from an online `/license/check`.
   * Only set when we have a fresh server response. When the server says
   * `false`, we never grant an active gate regardless of the client clock
   * (defends against clock manipulation — see Architecture R-D1).
   */
  serverActive?: boolean
}): LicenseStatus {
  if (!options.activationId || !options.expiresAt) return { active: false, gate: 'locked' }

  const expiry = strictDate(options.expiresAt)
  if (!expiry) return { active: false, gate: 'locked', expiresAt: options.expiresAt }

  // Revocation is an admin security action (fraud / refund / chargeback), not a
  // natural expiry — lock immediately, do NOT grant the 7-day read-only grace.
  if (options.revoked) {
    return { active: false, gate: 'locked', expiresAt: options.expiresAt, daysRemaining: 0 }
  }

  const lastSuccess = strictDate(options.lastSuccessCheck)
  const offlineGraceValid = isWithin(lastSuccess, options.now, OFFLINE_GRACE_MS)
  const serverDenied = options.serverActive === false
  const expiredReadonlyValid =
    expiry.getTime() <= options.now.getTime() &&
    options.now.getTime() - expiry.getTime() < EXPIRED_READONLY_GRACE_MS

  if (!serverDenied && expiry.getTime() > options.now.getTime() && offlineGraceValid) {
    return {
      active: true,
      gate: options.offlineFallback ? 'offline-grace' : 'active',
      expiresAt: options.expiresAt,
      daysRemaining: calculateDaysRemaining(options.expiresAt, options.now),
      offlineGraceValid
    }
  }

  if (expiredReadonlyValid) {
    return {
      active: false,
      gate: 'expired-readonly',
      expiresAt: options.expiresAt,
      daysRemaining: 0,
      offlineGraceValid,
      expiredReadonlyValid
    }
  }

  return {
    active: false,
    gate: 'locked',
    expiresAt: options.expiresAt,
    daysRemaining: 0,
    offlineGraceValid,
    expiredReadonlyValid: false
  }
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
    },
    async check(activationId) {
      return postJson({
        url: `${baseUrl.replace(/\/$/, '')}/api/v1/automation/license/check`,
        body: { activation_id: activationId },
        schema: BackendLicenseCheckResponseSchema,
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
  now?: () => Date
}): LicenseService {
  const getHwid = deps.generateHwid ?? generateHwid
  const getNow = deps.now ?? (() => new Date())

  return {
    async activate(key) {
      try {
        const hwid = await getHwid()
        const result = await deps.backendClient.activate(key, hwid)

        await deps.storage.set(ACTIVATION_ID_KEY, result.activation_id)
        try {
          await deps.settings.setSetting(EXPIRES_AT_KEY, result.expires_at)
          await deps.settings.setSetting(REBIND_COUNT_KEY, String(result.rebind_count))
          // Backend rejects revoked keys at /activate, so a successful activation
          // clears any stale revoked flag from a previous activation on this device.
          await deps.settings.setSetting(REVOKED_KEY, 'false')
          // last_success_check unlocks offline grace — set it last (gating key).
          await deps.settings.setSetting(LAST_SUCCESS_CHECK_KEY, getNow().toISOString())
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

    async check() {
      const activationId = await deps.storage.get(ACTIVATION_ID_KEY)
      if (!activationId) return { active: false, gate: 'locked' }

      try {
        const result = await deps.backendClient.check(activationId)
        await deps.settings.setSetting(EXPIRES_AT_KEY, result.expires_at)
        await deps.settings.setSetting(REBIND_COUNT_KEY, String(result.rebind_count))
        // Persist revocation so getStatus()/offline-fallback stay aware of it even
        // after a restart while offline (otherwise a revoked user could re-enter).
        await deps.settings.setSetting(REVOKED_KEY, String(result.revoked))
        await deps.settings.setSetting(LAST_SUCCESS_CHECK_KEY, getNow().toISOString())
        return localStatus({
          activationId,
          expiresAt: result.expires_at,
          lastSuccessCheck: deps.settings.getSetting(LAST_SUCCESS_CHECK_KEY),
          now: getNow(),
          revoked: result.revoked,
          serverActive: result.active
        })
      } catch (error) {
        const normalized = normalizeServiceError(error)
        if (!normalized.retryable) throw normalized
        return localStatus({
          activationId,
          expiresAt: deps.settings.getSetting(EXPIRES_AT_KEY),
          lastSuccessCheck: deps.settings.getSetting(LAST_SUCCESS_CHECK_KEY),
          now: getNow(),
          offlineFallback: true,
          revoked: deps.settings.getSetting(REVOKED_KEY) === 'true'
        })
      }
    },

    async getStatus() {
      const activationId = await deps.storage.get(ACTIVATION_ID_KEY)
      const expiresAt = deps.settings.getSetting(EXPIRES_AT_KEY)
      return localStatus({
        activationId,
        expiresAt,
        lastSuccessCheck: deps.settings.getSetting(LAST_SUCCESS_CHECK_KEY),
        now: getNow(),
        revoked: deps.settings.getSetting(REVOKED_KEY) === 'true'
      })
    }
  }
}
