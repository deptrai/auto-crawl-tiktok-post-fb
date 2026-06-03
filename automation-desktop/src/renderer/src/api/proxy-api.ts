import type {
  ProxyConfigGetResponse,
  ProxyConfigSetResponse,
  ProxyRotateResponse,
  PublicProxyInfo
} from '../../../shared/ipc-schemas'

function assertOk<T extends { ok: boolean; error?: { message: string } }>(
  response: T
): asserts response is T & { ok: true } {
  if (!response.ok) throw new Error(response.error?.message ?? 'IPC request failed')
}

export async function getProxyConfig(): Promise<{ configured: boolean }> {
  const response = await window.api.ipc.call<
    'phase3:proxy:config-get',
    Record<string, never>,
    ProxyConfigGetResponse
  >('phase3:proxy:config-get', {})
  assertOk(response)
  return { configured: response.configured }
}

export async function setProxyConfig(apiKey: string): Promise<void> {
  const response = await window.api.ipc.call<
    'phase3:proxy:config-set',
    { apiKey: string },
    ProxyConfigSetResponse
  >('phase3:proxy:config-set', { apiKey })
  assertOk(response)
}

export async function rotateProxy(): Promise<PublicProxyInfo> {
  const response = await window.api.ipc.call<
    'phase3:proxy:rotate',
    Record<string, never>,
    ProxyRotateResponse
  >('phase3:proxy:rotate', {})
  assertOk(response)
  return response.proxy
}
