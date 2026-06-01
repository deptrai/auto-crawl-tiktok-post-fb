import { test, expect } from '@playwright/test'
import { channelRegistry, type Phase3ChannelName } from '../../src/shared/ipc-schemas'

test('[P1] channel registry starts as readonly empty skeleton', () => {
  // Given/When: reading initial registry in scaffold stage.
  // Then: registry must be deterministic empty array.
  expect(Array.isArray(channelRegistry)).toBeTruthy()
  expect(channelRegistry.length).toBe(0)
})

test('[P2] phase3 channel type accepts expected shape', () => {
  // Given: a channel key following phase3 naming convention.
  const ch: Phase3ChannelName = 'phase3:license:validate'

  // Then: channel keeps required prefix contract.
  expect(ch.startsWith('phase3:')).toBeTruthy()
})
