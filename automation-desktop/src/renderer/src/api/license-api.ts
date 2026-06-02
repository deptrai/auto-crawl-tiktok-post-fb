import type {
  LicenseActivateResponse,
  LicenseCheckResponse,
  LicensePublicStatus,
  LicenseStatusResponse
} from '../../../shared/ipc-schemas'

function assertOk<T extends { ok: boolean; error?: { message: string } }>(
  response: T
): asserts response is T & { ok: true } {
  if (!response.ok) throw new Error(response.error?.message ?? 'Yêu cầu license thất bại')
}

export async function activateLicense(key: string): Promise<LicensePublicStatus> {
  const response = await window.api.ipc.call<
    'phase3:license:activate',
    { key: string },
    LicenseActivateResponse
  >('phase3:license:activate', { key })
  assertOk(response)
  return response.status
}

export async function getLicenseStatus(): Promise<LicensePublicStatus> {
  const response = await window.api.ipc.call<
    'phase3:license:status',
    Record<string, never>,
    LicenseStatusResponse
  >('phase3:license:status', {})
  assertOk(response)
  return response.status
}

export async function checkLicense(): Promise<LicensePublicStatus> {
  const response = await window.api.ipc.call<
    'phase3:license:check',
    Record<string, never>,
    LicenseCheckResponse
  >('phase3:license:check', {})
  assertOk(response)
  return response.status
}

/**
 * Subscribe to background license status pushes (phase3:license:changed).
 * Returns an unsubscribe function. No-op (returns a noop unsubscribe) if the
 * push API is unavailable (e.g. non-Electron test contexts).
 */
export function subscribeLicenseChanges(
  callback: (status: LicensePublicStatus) => void
): () => void {
  const push = window.api?.license
  if (!push) return () => undefined
  return push.onChanged(callback)
}
