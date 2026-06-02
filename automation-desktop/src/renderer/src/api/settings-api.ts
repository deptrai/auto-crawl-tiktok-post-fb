import type {
  SettingsGetResponse,
  SettingsSetResponse,
  ShellOpenExternalResponse
} from '../../../shared/ipc-schemas'

function assertOk<T extends { ok: boolean; error?: { message: string } }>(
  response: T
): asserts response is T & { ok: true } {
  if (!response.ok) throw new Error(response.error?.message ?? 'IPC request failed')
}

export async function getSetting(key: string): Promise<string | null> {
  const response = await window.api.ipc.call<
    'phase3:settings:get',
    { key: string },
    SettingsGetResponse
  >('phase3:settings:get', { key })
  assertOk(response)
  return response.value
}

export async function setSetting(key: string, value: string): Promise<void> {
  const response = await window.api.ipc.call<
    'phase3:settings:set',
    { key: string; value: string },
    SettingsSetResponse
  >('phase3:settings:set', { key, value })
  assertOk(response)
}

export async function openPrivacyPolicy(): Promise<void> {
  const response = await window.api.ipc.call<
    'phase3:shell:open-external',
    { url: string },
    ShellOpenExternalResponse
  >('phase3:shell:open-external', {
    url: 'https://example.com/privacy-phase3-draft'
  })
  assertOk(response)
}
