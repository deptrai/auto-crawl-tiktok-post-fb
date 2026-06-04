import { test, expect } from '@playwright/test'
import { registerTargetListHandlers } from '../../src/main/ipc/target-list-handlers'
import type {
  TargetListEntry,
  TargetListImportResult,
  TargetListRepository,
  TargetListSummary
} from '../../src/main/db/repositories/target-list-repo'

type IpcHandler = (_event: unknown, request: unknown) => Promise<unknown>

class FakeIpcMain {
  readonly handlers = new Map<string, IpcHandler>()
  handle(channel: string, handler: IpcHandler): void {
    this.handlers.set(channel, handler)
  }
  async invoke(channel: string, request: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (!handler) throw new Error(`Missing handler: ${channel}`)
    return handler({}, request)
  }
}

function createRepo(): TargetListRepository & { importCalls: number } {
  const lists = new Map<string, TargetListSummary>()
  const entries = new Map<string, TargetListEntry[]>()
  let importCalls = 0

  return {
    get importCalls() {
      return importCalls
    },
    listExists(id) {
      return lists.has(id)
    },
    listLists() {
      return [...lists.values()]
    },
    createList(params) {
      const list = {
        id: `list-${lists.size + 1}`,
        label: params.label,
        createdAt: params.createdAt,
        total: 0,
        sent: 0,
        unsent: 0,
        error: 0
      }
      lists.set(list.id, list)
      entries.set(list.id, [])
      return { id: list.id, label: list.label, createdAt: list.createdAt }
    },
    deleteList(id) {
      const deleted = lists.delete(id)
      entries.delete(id)
      return deleted ? 1 : 0
    },
    importEntries(params): TargetListImportResult {
      importCalls += 1
      const current = entries.get(params.listId) ?? []
      const seen = new Set(current.map((entry) => entry.uid))
      let created = 0
      let skippedDuplicate = 0
      for (const entry of params.entries) {
        if (seen.has(entry.uid)) {
          skippedDuplicate += 1
          continue
        }
        seen.add(entry.uid)
        created += 1
        current.push({
          listId: params.listId,
          uid: entry.uid,
          name: entry.name,
          createdAt: params.createdAt
        })
      }
      entries.set(params.listId, current)
      const summary = lists.get(params.listId)
      if (summary) {
        summary.total = current.length
        summary.unsent = current.length
      }
      return { created, skippedDuplicate, total: params.entries.length }
    },
    listEntries(params) {
      return entries.get(params.listId) ?? []
    },
    linkJobs() {
      return 0
    },
    applyJobOutcomes() {
      return 0
    }
  }
}

test('[P0] target list IPC performs create list import entries and delete', async () => {
  const ipc = new FakeIpcMain()
  const repo = createRepo()
  registerTargetListHandlers(ipc, repo, () => '2026-06-04T02:00:00.000Z')

  const created = (await ipc.invoke('phase3:target-list:create', {
    label: ' Messenger leads '
  })) as { ok: true; list: { id: string; label: string; createdAt: string } }
  expect(created).toEqual({
    ok: true,
    list: {
      id: 'list-1',
      label: 'Messenger leads',
      createdAt: '2026-06-04T02:00:00.000Z'
    }
  })

  await expect(ipc.invoke('phase3:target-list:list', {})).resolves.toEqual({
    ok: true,
    lists: [expect.objectContaining({ id: created.list.id, label: 'Messenger leads' })]
  })

  await expect(
    ipc.invoke('phase3:target-list:import', {
      listId: created.list.id,
      entries: [{ uid: '1001', name: 'An' }, { uid: '1002' }, { uid: '1001' }]
    })
  ).resolves.toEqual({ ok: true, result: { created: 2, skippedDuplicate: 1, total: 3 } })

  await expect(
    ipc.invoke('phase3:target-list:entries', { listId: created.list.id, filter: 'unsent' })
  ).resolves.toEqual({
    ok: true,
    entries: [
      expect.objectContaining({ uid: '1001', name: 'An' }),
      expect.objectContaining({ uid: '1002' })
    ]
  })

  await expect(ipc.invoke('phase3:target-list:delete', { id: created.list.id })).resolves.toEqual({
    ok: true
  })
})

test('[P0] target list IPC rejects invalid payload without writing and hides secrets', async () => {
  const ipc = new FakeIpcMain()
  const repo = createRepo()
  registerTargetListHandlers(ipc, repo)

  const invalidCreate = (await ipc.invoke('phase3:target-list:create', { label: '' })) as {
    ok: false
    error: { code: string; message: string; retryable: boolean }
  }
  expect(invalidCreate.error).toEqual(
    expect.objectContaining({
      code: 'VALIDATION_ERROR',
      message: 'Dữ liệu yêu cầu không hợp lệ',
      retryable: false
    })
  )

  const invalidImport = (await ipc.invoke('phase3:target-list:import', {
    listId: 'list-1',
    entries: [{ uid: '', cookie: 'secret-cookie' }]
  })) as { ok: false; error: { code: string } }
  expect(invalidImport.error.code).toBe('VALIDATION_ERROR')
  expect(repo.importCalls).toBe(0)
  expect(JSON.stringify(invalidImport)).not.toMatch(/secret-cookie|cookie|token|password|twofa/i)
})

test('[P1] target list IPC returns TARGET_LIST_NOT_FOUND for missing list', async () => {
  const ipc = new FakeIpcMain()
  registerTargetListHandlers(ipc, createRepo())

  await expect(
    ipc.invoke('phase3:target-list:entries', { listId: 'missing-list', filter: 'all' })
  ).resolves.toEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'TARGET_LIST_NOT_FOUND',
      message: 'Không tìm thấy danh sách target.',
      retryable: false
    })
  })

  await expect(ipc.invoke('phase3:target-list:delete', { id: 'missing-list' })).resolves.toEqual({
    ok: false,
    error: expect.objectContaining({ code: 'TARGET_LIST_NOT_FOUND' })
  })
})
