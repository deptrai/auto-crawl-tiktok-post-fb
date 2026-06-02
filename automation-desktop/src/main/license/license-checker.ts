import type { LicenseService } from './license-service'

const DEFAULT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

type TimerHandle = ReturnType<typeof setInterval>

export interface LicenseCheckerOptions {
  intervalMs?: number
  setIntervalFn?: (callback: () => void, intervalMs: number) => TimerHandle
  clearIntervalFn?: (handle: TimerHandle) => void
}

export interface LicenseChecker {
  start(): void
  stop(): void
}

export function createLicenseChecker(
  service: LicenseService,
  options: LicenseCheckerOptions = {}
): LicenseChecker {
  const intervalMs = options.intervalMs ?? DEFAULT_CHECK_INTERVAL_MS
  const setIntervalFn = options.setIntervalFn ?? setInterval
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval
  let timer: TimerHandle | null = null
  let checking = false

  async function runCheck(): Promise<void> {
    if (checking) return
    checking = true
    try {
      await service.check()
    } catch {
      // Offline grace is evaluated by the license service; background checks must never crash the app.
    } finally {
      checking = false
    }
  }

  return {
    start() {
      if (timer) return
      void runCheck()
      timer = setIntervalFn(() => void runCheck(), intervalMs)
    },
    stop() {
      if (!timer) return
      clearIntervalFn(timer)
      timer = null
    }
  }
}
