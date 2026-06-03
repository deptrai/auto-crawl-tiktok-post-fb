import { test, expect } from '@playwright/test'
import { CircuitBreaker } from '../../src/main/proxy/circuit-breaker'

test('[P0] circuit breaker opens after threshold failures and blocks during cooldown', () => {
  let now = 1_000
  const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 }, () => now)

  expect(breaker.canRequest()).toBe(true)
  breaker.recordFailure()
  breaker.recordFailure()
  expect(breaker.getState()).toEqual({ state: 'CLOSED', failureCount: 2 })

  breaker.recordFailure()

  expect(breaker.getState()).toEqual({ state: 'OPEN', failureCount: 3, openedAt: 1_000 })
  expect(breaker.canRequest()).toBe(false)

  now += 60_000
  expect(breaker.canRequest()).toBe(true)
  expect(breaker.getState()).toEqual({ state: 'HALF_OPEN', failureCount: 3, openedAt: 1_000 })
})

test('[P0] circuit breaker half-open success closes and resets failures', () => {
  let now = 1_000
  const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 5_000 }, () => now)

  breaker.recordFailure()
  now += 5_000
  expect(breaker.canRequest()).toBe(true)

  breaker.recordSuccess()

  expect(breaker.getState()).toEqual({ state: 'CLOSED', failureCount: 0 })
  expect(breaker.canRequest()).toBe(true)
})

test('[P0] circuit breaker half-open failure reopens with a fresh cooldown', () => {
  let now = 1_000
  const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 5_000 }, () => now)

  breaker.recordFailure()
  breaker.recordFailure()
  now += 5_000
  expect(breaker.canRequest()).toBe(true)

  now += 250
  breaker.recordFailure()

  expect(breaker.getState()).toEqual({ state: 'OPEN', failureCount: 3, openedAt: 6_250 })
  expect(breaker.canRequest()).toBe(false)
})
