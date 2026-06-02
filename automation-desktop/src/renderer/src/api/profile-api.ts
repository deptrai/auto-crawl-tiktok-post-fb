import type {
  ImportResult,
  ProfileDeleteResponse,
  ProfileImportBulkResponse,
  ProfileListResponse,
  ProfileSummary,
  ProfileUpdateResponse
} from '../../../shared/ipc-schemas'

function assertOk<T extends { ok: boolean; error?: { message: string } }>(
  response: T
): asserts response is T & { ok: true } {
  if (!response.ok) throw new Error(response.error?.message ?? 'IPC request failed')
}

export async function importBulkProfiles(text: string): Promise<ImportResult> {
  const response = await window.api.ipc.call<
    'phase3:profile:import-bulk',
    { text: string },
    ProfileImportBulkResponse
  >('phase3:profile:import-bulk', { text })
  assertOk(response)
  return response.result
}

export async function listProfiles(): Promise<ProfileSummary[]> {
  const response = await window.api.ipc.call<
    'phase3:profile:list',
    Record<string, never>,
    ProfileListResponse
  >('phase3:profile:list', {})
  assertOk(response)
  return response.profiles
}

export async function updateProfile(id: string, displayName: string): Promise<ProfileSummary> {
  const response = await window.api.ipc.call<
    'phase3:profile:update',
    { id: string; displayName: string },
    ProfileUpdateResponse
  >('phase3:profile:update', { id, displayName })
  assertOk(response)
  return response.profile
}

export async function deleteProfile(id: string): Promise<void> {
  const response = await window.api.ipc.call<
    'phase3:profile:delete',
    { id: string },
    ProfileDeleteResponse
  >('phase3:profile:delete', { id })
  assertOk(response)
}
