import type {
  LicenseActivateResponse,
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
