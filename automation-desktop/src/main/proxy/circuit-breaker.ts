export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface CircuitBreakerConfig {
  failureThreshold: number
  cooldownMs: number
}

export interface CircuitBreakerState {
  state: CircuitState
  failureCount: number
  openedAt?: number
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED'
  private failureCount = 0
  private openedAt?: number

  constructor(
    private readonly cfg: CircuitBreakerConfig,
    private readonly now: () => number
  ) {}

  canRequest(): boolean {
    if (this.state !== 'OPEN') return true
    const openedAt = this.openedAt ?? 0
    if (this.now() >= openedAt + this.cfg.cooldownMs) {
      this.state = 'HALF_OPEN'
      return true
    }
    return false
  }

  recordSuccess(): void {
    this.state = 'CLOSED'
    this.failureCount = 0
    this.openedAt = undefined
  }

  recordFailure(): void {
    this.failureCount += 1
    if (this.state === 'HALF_OPEN' || this.failureCount >= this.cfg.failureThreshold) {
      this.state = 'OPEN'
      this.openedAt = this.now()
    }
  }

  getState(): CircuitBreakerState {
    return this.openedAt === undefined
      ? { state: this.state, failureCount: this.failureCount }
      : { state: this.state, failureCount: this.failureCount, openedAt: this.openedAt }
  }
}
