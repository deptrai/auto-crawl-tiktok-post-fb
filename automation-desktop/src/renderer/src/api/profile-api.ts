import type {
  ImportResult,
  ProfileImportBulkResponse,
  ProfileListResponse,
  ProfileSummary
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
