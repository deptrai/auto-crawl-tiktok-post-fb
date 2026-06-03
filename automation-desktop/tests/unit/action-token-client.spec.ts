import { test, expect } from '@playwright/test'
import { BackendHttpError } from '../../src/shared/api-client/http-client'
import {
  ActionTokenClientError,
  createActionTokenClient,
  type ActionTokenClient
} from '../../src/main/license/action-token-client'

const VALID_HWID = 'a'.repeat(64)

function createClient(
  postJson: Parameters<typeof createActionTokenClient>[0]['postJson']
): ActionTokenClient {
  return createActionTokenClient({
    baseUrl: 'https://license.example.test/',
    getLicenseKey: async () => 'LIC-OK',
    generateHwid: async () => VALID_HWID,
    postJson
  })
}

test('[P1] action token client returns token in memory and sends normalized request', async () => {
  let captured: unknown
  const client = createClient(async (options) => {
    captured = options
    return {
      token: 'jwt-token',
      jti: 'jti-secret',
      expires_at: '2026-06-03T10:01:00.000Z'
    }
  })

  const result = await client.requestActionToken({ actionType: 'comment' })

  expect(result).toEqual({
    token: 'jwt-token',
    jti: 'jti-secret',
    expiresAt: '2026-06-03T10:01:00.000Z'
  })
  expect(captured).toMatchObject({
    url: 'https://license.example.test/api/v1/automation/action/token',
    body: { key: 'LIC-OK', hwid: VALID_HWID, action_type: 'comment' }
  })
})

test('[P1] action token client blocks offline tier2 actions as retryable', async () => {
  const client = createClient(async () => {
    throw new BackendHttpError('NETWORK_ERROR', 'Không thể kết nối máy chủ.', true)
  })

  await expect(client.requestActionToken({ actionType: 'comment' })).rejects.toMatchObject({
    name: 'ActionTokenClientError',
    code: 'ACTION_TOKEN_OFFLINE',
    retryable: true
  })
})

test('[P1] action token client maps server deny without leaking token or jti', async () => {
  const secretToken = 'SECRET_JWT_VALUE'
  const secretJti = 'SECRET_JTI_VALUE'
  const client = createClient(async () => {
    throw new BackendHttpError('LICENSE_INVALID', 'License không hợp lệ.', false, {
      token: secretToken,
      jti: secretJti
    })
  })

  let thrown: unknown
  try {
    await client.requestActionToken({ actionType: 'comment' })
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(ActionTokenClientError)
  expect(thrown).toMatchObject({
    code: 'ACTION_TOKEN_DENIED',
    message: 'License không hợp lệ.',
    retryable: false
  })
  const serialized = JSON.stringify(thrown)
  const printable = thrown instanceof Error ? `${thrown.name}:${thrown.message}` : String(thrown)
  expect(`${serialized}:${printable}`).not.toContain(secretToken)
  expect(`${serialized}:${printable}`).not.toContain(secretJti)
})

test('[P1] action token client consumes token without persisting jti or echoing JWT', async () => {
  let captured: unknown
  const client = createClient(async (options) => {
    captured = options
    return { jti: 'jti-reference', consumed_at: '2026-06-03T10:02:00.000Z' }
  })

  await expect(client.consumeActionToken('JWT_SECRET_VALUE')).resolves.toEqual({
    jti: 'jti-reference',
    consumedAt: '2026-06-03T10:02:00.000Z'
  })
  expect(captured).toMatchObject({
    url: 'https://license.example.test/api/v1/automation/action/token/consume',
    body: { token: 'JWT_SECRET_VALUE' }
  })
})
