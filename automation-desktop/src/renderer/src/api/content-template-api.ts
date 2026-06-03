import type {
  ContentTemplateCreateResponse,
  ContentTemplateDeleteResponse,
  ContentTemplateListResponse,
  ContentTemplateSummary,
  ContentTemplateUpdateResponse
} from '../../../shared/ipc-schemas'

function assertOk<T extends { ok: boolean; error?: { message: string } }>(
  response: T
): asserts response is T & { ok: true } {
  if (!response.ok) throw new Error(response.error?.message ?? 'IPC request failed')
}

export async function listContentTemplates(): Promise<ContentTemplateSummary[]> {
  const response = await window.api.ipc.call<
    'phase3:content-template:list',
    Record<string, never>,
    ContentTemplateListResponse
  >('phase3:content-template:list', {})
  assertOk(response)
  return response.templates
}

export async function createContentTemplate(input: {
  label: string
  body: string
}): Promise<ContentTemplateSummary> {
  const response = await window.api.ipc.call<
    'phase3:content-template:create',
    { label: string; body: string },
    ContentTemplateCreateResponse
  >('phase3:content-template:create', input)
  assertOk(response)
  return response.template
}

export async function updateContentTemplate(input: {
  id: string
  label: string
  body: string
}): Promise<ContentTemplateSummary> {
  const response = await window.api.ipc.call<
    'phase3:content-template:update',
    { id: string; label: string; body: string },
    ContentTemplateUpdateResponse
  >('phase3:content-template:update', input)
  assertOk(response)
  return response.template
}

export async function deleteContentTemplate(id: string): Promise<void> {
  const response = await window.api.ipc.call<
    'phase3:content-template:delete',
    { id: string },
    ContentTemplateDeleteResponse
  >('phase3:content-template:delete', { id })
  assertOk(response)
}
