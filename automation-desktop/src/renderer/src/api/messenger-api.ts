import type {
  MessengerStartResponse,
  MessengerStatusResponse,
  MessengerTargetPayload
} from '../../../shared/ipc-schemas'

function assertOk<T extends { ok: boolean; error?: { message: string } }>(
  response: T
): asserts response is T & { ok: true } {
  if (!response.ok) throw new Error(response.error?.message ?? 'IPC request failed')
}

export async function startMessengerSeeding(input: {
  profileIds: string[]
  targets: MessengerTargetPayload[]
}): Promise<{ jobIds: string[] }> {
  const response = await window.api.ipc.call<
    'phase3:messenger:start',
    { profileIds: string[]; targets: MessengerTargetPayload[] },
    MessengerStartResponse
  >('phase3:messenger:start', input)
  assertOk(response)
  return { jobIds: response.jobIds }
}

export async function getMessengerStatus(
  jobIds: string[]
): Promise<MessengerStatusResponse & { ok: true }> {
  const response = await window.api.ipc.call<
    'phase3:messenger:status',
    { jobIds: string[] },
    MessengerStatusResponse
  >('phase3:messenger:status', { jobIds })
  assertOk(response)
  return response
}
