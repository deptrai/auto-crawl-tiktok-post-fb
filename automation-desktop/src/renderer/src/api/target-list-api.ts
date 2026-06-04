import type {
  TargetListCreateResponse,
  TargetListDeleteResponse,
  TargetListEntriesResponse,
  TargetListFilter,
  TargetListImportResponse,
  TargetListListResponse,
  TargetListEntry,
  TargetListImportResult,
  TargetListSummary
} from '../../../shared/ipc-schemas'

function assertOk<T extends { ok: boolean; error?: { message: string } }>(
  response: T
): asserts response is T & { ok: true } {
  if (!response.ok) throw new Error(response.error?.message ?? 'IPC request failed')
}

export async function listTargetLists(): Promise<TargetListSummary[]> {
  const response = await window.api.ipc.call<
    'phase3:target-list:list',
    Record<string, never>,
    TargetListListResponse
  >('phase3:target-list:list', {})
  assertOk(response)
  return response.lists
}

export async function createTargetList(label: string): Promise<TargetListSummary> {
  const response = await window.api.ipc.call<
    'phase3:target-list:create',
    { label: string },
    TargetListCreateResponse
  >('phase3:target-list:create', { label })
  assertOk(response)
  return { ...response.list, total: 0, sent: 0, unsent: 0, error: 0 }
}

export async function deleteTargetList(id: string): Promise<void> {
  const response = await window.api.ipc.call<
    'phase3:target-list:delete',
    { id: string },
    TargetListDeleteResponse
  >('phase3:target-list:delete', { id })
  assertOk(response)
}

export async function importTargetEntries(input: {
  listId: string
  entries: Array<{ uid: string; name?: string }>
}): Promise<TargetListImportResult> {
  const response = await window.api.ipc.call<
    'phase3:target-list:import',
    { listId: string; entries: Array<{ uid: string; name?: string }> },
    TargetListImportResponse
  >('phase3:target-list:import', input)
  assertOk(response)
  return response.result
}

export async function listTargetEntries(input: {
  listId: string
  filter: TargetListFilter
}): Promise<TargetListEntry[]> {
  const response = await window.api.ipc.call<
    'phase3:target-list:entries',
    { listId: string; filter: TargetListFilter },
    TargetListEntriesResponse
  >('phase3:target-list:entries', input)
  assertOk(response)
  return response.entries
}
