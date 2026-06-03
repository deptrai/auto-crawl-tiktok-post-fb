import type { Phase3ChannelName } from './ipc-schemas'

export interface RetryPolicyEntry {
  maxRetries: number
  baseDelayMs: number
  maxDelayMs: number
  retryableCodes: string[]
}

export const RETRY_POLICY = {
  'phase3:proxy:rotate': {
    maxRetries: 2,
    baseDelayMs: 1_000,
    maxDelayMs: 5_000,
    retryableCodes: ['PROXY_UNAVAILABLE', 'PROXY_QUARANTINED']
  }
} satisfies Partial<Record<Phase3ChannelName, RetryPolicyEntry>>

export function computeBackoffMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
}

export function isRetryable(channel: Phase3ChannelName, code: string): boolean {
  return RETRY_POLICY[channel]?.retryableCodes.includes(code) ?? false
}
