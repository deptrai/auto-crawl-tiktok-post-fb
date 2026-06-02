import { test, expect } from '@playwright/test'
import { channelRegistry, type Phase3ChannelName } from '../../src/shared/ipc-schemas'

test('[P0] channel registry includes typed settings and shell channels', () => {
  const channels = channelRegistry.map((entry) => entry.channel)

  expect(channels).toContain('phase3:settings:get')
  expect(channels).toContain('phase3:settings:set')
  expect(channels).toContain('phase3:shell:open-external')
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

test('[P2] phase3 channel type accepts expected shape', () => {
  const ch: Phase3ChannelName = 'phase3:license:validate'

  expect(ch.startsWith('phase3:')).toBeTruthy()
})
