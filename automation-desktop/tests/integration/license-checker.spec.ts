import { test, expect } from '@playwright/test'
import { createLicenseChecker } from '../../src/main/license/license-checker'
import type { LicenseService } from '../../src/main/license/license-service'

test('[P1] license checker runs check on interval and stops cleanly', async () => {
  let checks = 0
  const timers = new Set<() => void>()
  const service: LicenseService = {
    activate: async () => ({ active: true, gate: 'active' }),
    getStatus: async () => ({ active: true, gate: 'active' }),
    check: async () => {
      checks += 1
      return { active: true, gate: 'active' }
    }
  }

  const checker = createLicenseChecker(service, {
    intervalMs: 10,
    setIntervalFn: (callback) => {
      timers.add(callback)
      return callback
    },
    clearIntervalFn: (handle) => {
      timers.delete(handle as () => void)
    }
  })

  checker.start()
  expect(checks).toBe(1)
  await expect.poll(() => checks).toBe(1)
  for (const callback of timers) callback()
  await expect.poll(() => checks).toBe(2)

  checker.stop()
  expect(timers.size).toBe(0)
})

test('[P1] license checker does not run overlapping checks', async () => {
  let checks = 0
  let intervalCallback: (() => void) | undefined
  let release!: () => void
  const service: LicenseService = {
    activate: async () => ({ active: true, gate: 'active' }),
    getStatus: async () => ({ active: true, gate: 'active' }),
    check: async () => {
      checks += 1
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { active: true, gate: 'active' }
    }
  }

  const checker = createLicenseChecker(service, {
    intervalMs: 10,
    setIntervalFn: (callback) => {
      intervalCallback = callback
      return callback
    },
    clearIntervalFn: () => undefined
  })

  checker.start()
  intervalCallback?.()
  expect(checks).toBe(1)
  release()
  await expect.poll(() => checks).toBe(1)
})
