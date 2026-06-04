import { test, expect } from '@playwright/test'
import {
  CaptchaSetKeyResponseSchema,
  CaptchaStatusResponseSchema,
  channelRegistry,
  type Phase3ChannelName
} from '../../src/shared/ipc-schemas'

test('[P0] channel registry includes typed settings and shell channels', () => {
  const channels = channelRegistry.map((entry) => entry.channel)

  expect(channels).toContain('phase3:settings:get')
  expect(channels).toContain('phase3:settings:set')
  expect(channels).toContain('phase3:shell:open-external')
  expect(channels).toContain('phase3:captcha:set-key')
  expect(channels).toContain('phase3:captcha:status')
})

test('[P1] registered channel schemas validate request and response payloads', () => {
  const getChannel = channelRegistry.find((entry) => entry.channel === 'phase3:settings:get')
  const setChannel = channelRegistry.find((entry) => entry.channel === 'phase3:settings:set')

  expect(getChannel?.requestSchema.safeParse({ key: 'eula_accepted_version' }).success).toBe(true)
  expect(getChannel?.responseSchema.safeParse({ ok: true, value: null }).success).toBe(true)
  expect(
    setChannel?.requestSchema.safeParse({ key: 'telemetry_enabled', value: 'true' }).success
  ).toBe(true)
  expect(setChannel?.responseSchema.safeParse({ ok: true }).success).toBe(true)
})

test('[P0] captcha channel schemas validate write-only request/status contracts', () => {
  const setKeyChannel = channelRegistry.find((entry) => entry.channel === 'phase3:captcha:set-key')
  const statusChannel = channelRegistry.find((entry) => entry.channel === 'phase3:captcha:status')

  expect(
    setKeyChannel?.requestSchema.safeParse({
      provider: 'capsolver',
      apiKey: '  CAPSOLVER_SECRET_123  '
    }).success
  ).toBe(true)
  expect(
    setKeyChannel?.requestSchema.safeParse({ provider: 'unknown', apiKey: 'KEY' }).success
  ).toBe(false)
  expect(setKeyChannel?.requestSchema.safeParse({ provider: '2captcha', apiKey: '' }).success).toBe(
    false
  )
  expect(setKeyChannel?.responseSchema.safeParse({ ok: true }).success).toBe(true)
  expect(statusChannel?.requestSchema.safeParse({}).success).toBe(true)
  expect(statusChannel?.requestSchema.safeParse({ provider: 'capsolver' }).success).toBe(false)
  expect(
    statusChannel?.responseSchema.safeParse({
      ok: true,
      capsolverConfigured: true,
      twoCaptchaConfigured: false,
      enabled: false
    }).success
  ).toBe(true)
})

test('[P0] captcha response schemas reject secret echo fields', () => {
  expect(
    CaptchaSetKeyResponseSchema.safeParse({ ok: true, apiKey: 'CAPSOLVER_SECRET_123' }).success
  ).toBe(false)
  expect(
    CaptchaStatusResponseSchema.safeParse({
      ok: true,
      capsolverConfigured: true,
      twoCaptchaConfigured: true,
      enabled: true,
      key: 'TWO_CAPTCHA_SECRET_456'
    }).success
  ).toBe(false)
})

test('[P2] phase3 channel type accepts expected shape', () => {
  const ch: Phase3ChannelName = 'phase3:license:validate'

  expect(ch.startsWith('phase3:')).toBeTruthy()
})
