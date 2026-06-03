import { test, expect } from '@playwright/test'
import { RETRY_POLICY, computeBackoffMs, isRetryable } from '../../src/shared/retry'

test('[P1] computeBackoffMs applies exponential backoff and caps at max delay', () => {
  expect(computeBackoffMs(0, 1_000, 5_000)).toBe(1_000)
  expect(computeBackoffMs(1, 1_000, 5_000)).toBe(2_000)
  expect(computeBackoffMs(2, 1_000, 5_000)).toBe(4_000)
  expect(computeBackoffMs(3, 1_000, 5_000)).toBe(5_000)
})

test('[P1] isRetryable uses per-channel retryable code whitelist', () => {
  expect(RETRY_POLICY['phase3:proxy:rotate']).toMatchObject({
    maxRetries: 2,
    baseDelayMs: 1_000,
    retryableCodes: ['PROXY_UNAVAILABLE', 'PROXY_QUARANTINED']
  })
  expect(isRetryable('phase3:proxy:rotate', 'PROXY_UNAVAILABLE')).toBe(true)
  expect(isRetryable('phase3:proxy:rotate', 'PROXY_QUARANTINED')).toBe(true)
  expect(isRetryable('phase3:proxy:rotate', 'PROXY_NOT_CONFIGURED')).toBe(false)
  expect(isRetryable('phase3:profile:list', 'PROXY_UNAVAILABLE')).toBe(false)
})
