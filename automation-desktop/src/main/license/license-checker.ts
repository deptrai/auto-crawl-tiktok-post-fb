import type { LicenseService, LicenseStatus } from './license-service'

const DEFAULT_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

type TimerHandle = ReturnType<typeof setInterval>

export interface LicenseCheckerOptions {
  intervalMs?: number
  setIntervalFn?: (callback: () => void, intervalMs: number) => TimerHandle
  clearIntervalFn?: (handle: TimerHandle) => void
  /**
   * Invoked with the fresh status after each successful background check.
   * Used to push `phase3:license:changed` to the renderer so the UI gate
   * reacts to expiry/revocation in real time.
   */
  onStatus?: (status: LicenseStatus) => void
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
      const status = await service.check()
      options.onStatus?.(status)
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
