export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

type Clock = () => number;

/**
 * Small in-memory sliding-window limiter for a single signaling instance.
 * Production deployments with multiple replicas should enforce the same
 * policy at the edge or replace this with a shared backing store.
 */
export class SlidingWindowRateLimiter {
  private readonly attempts = new Map<unknown, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: Clock = Date.now
  ) {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer");
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error("windowMs must be positive");
  }

  /**
   * Consume one attempt for a key. The optional timestamp lets protocol code
   * use one request timestamp consistently across multiple limiter decisions.
   */
  consume(key: unknown, now = this.now()): RateLimitDecision {
    const cutoff = now - this.windowMs;
    const recent = (this.attempts.get(key) ?? []).filter(timestamp => timestamp > cutoff);

    if (recent.length >= this.limit) {
      this.attempts.set(key, recent);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, recent[0] + this.windowMs - now)
      };
    }

    recent.push(now);
    this.attempts.set(key, recent);
    return {
      allowed: true,
      remaining: this.limit - recent.length,
      retryAfterMs: 0
    };
  }

  check(key: unknown): RateLimitDecision {
    return this.consume(key, this.now());
  }

  delete(key: unknown): boolean {
    return this.attempts.delete(key);
  }

  prune(now = this.now()): void {
    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.attempts) {
      const recent = timestamps.filter(timestamp => timestamp > cutoff);
      if (recent.length === 0) this.attempts.delete(key);
      else this.attempts.set(key, recent);
    }
  }

  get trackedKeys(): number {
    return this.attempts.size;
  }
}
