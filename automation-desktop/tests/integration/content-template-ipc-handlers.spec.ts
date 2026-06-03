import { test, expect } from '@playwright/test'
import { registerContentTemplateHandlers } from '../../src/main/ipc/content-template-handlers'
import type {
  ContentTemplate,
  ContentTemplateRepository
} from '../../src/main/db/repositories/content-template-repo'

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

function createRepo(): ContentTemplateRepository {
  const templates = new Map<string, ContentTemplate>([
    [
      'tpl-1',
      {
        id: 'tpl-1',
        label: 'Mặc định',
        body: 'Bình luận mẫu',
        createdAt: '2026-06-03T00:00:00.000Z'
      }
    ]
  ])

  return {
    listTemplates: () => [...templates.values()],
    getRandomTemplate: () => [...templates.values()][0],
    seedDefaults: () => undefined,
    createTemplate(params) {
      const template = { id: `tpl-${templates.size + 1}`, ...params }
      templates.set(template.id, template)
      return template
    },
    updateTemplate(params) {
      const current = templates.get(params.id)
      if (!current) return undefined
      const next = { ...current, label: params.label, body: params.body }
      templates.set(params.id, next)
      return next
    },
    deleteTemplate(id) {
      return templates.delete(id) ? 1 : 0
    },
    countTemplates: () => templates.size
  }
}

test('[P0] content template IPC performs CRUD with validated responses', async () => {
  const ipc = new FakeIpcMain()
  const repo = createRepo()
  registerContentTemplateHandlers(ipc, repo, () => '2026-06-03T00:00:01.000Z')

  await expect(ipc.invoke('phase3:content-template:list', {})).resolves.toEqual({
    ok: true,
    templates: [expect.objectContaining({ id: 'tpl-1', label: 'Mặc định' })]
  })

  const created = (await ipc.invoke('phase3:content-template:create', {
    label: ' Khen ',
    body: ' Nội dung hay '
  })) as { ok: true; template: ContentTemplate }
  expect(created.ok).toBe(true)
  expect(created.template).toEqual(
    expect.objectContaining({
      label: 'Khen',
      body: 'Nội dung hay',
      createdAt: '2026-06-03T00:00:01.000Z'
    })
  )

  await expect(
    ipc.invoke('phase3:content-template:update', {
      id: created.template.id,
      label: 'Đã sửa',
      body: 'Body mới'
    })
  ).resolves.toEqual({
    ok: true,
    template: expect.objectContaining({
      id: created.template.id,
      label: 'Đã sửa',
      body: 'Body mới'
    })
  })

  await expect(
    ipc.invoke('phase3:content-template:delete', { id: created.template.id })
  ).resolves.toEqual({ ok: true })
})

test('[P1] content template IPC validates payload and blocks deleting final template', async () => {
  const ipc = new FakeIpcMain()
  registerContentTemplateHandlers(ipc, createRepo())

  const invalid = (await ipc.invoke('phase3:content-template:create', {
    label: '',
    body: ''
  })) as { ok: false; error: { code: string; retryable: boolean; message: string } }
  expect(invalid.error).toEqual(
    expect.objectContaining({
      code: 'VALIDATION_ERROR',
      message: 'Dữ liệu yêu cầu không hợp lệ',
      retryable: false
    })
  )

  const blocked = (await ipc.invoke('phase3:content-template:delete', { id: 'tpl-1' })) as {
    ok: false
    error: { code: string; retryable: boolean; message: string }
  }
  expect(blocked.error).toEqual(
    expect.objectContaining({
      code: 'CONTENT_TEMPLATE_LAST_REQUIRED',
      message: 'Cần ít nhất 1 template để chạy self-comment.',
      retryable: false
    })
  )
})
