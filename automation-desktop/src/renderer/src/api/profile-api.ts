import type {
  ImportResult,
  ProfileImportBulkResponse
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
