import { describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter } from "./rate-limit";

describe("SlidingWindowRateLimiter", () => {
  it("allows requests up to the configured limit", () => {
    let now = 1_000;
    const limiter = new SlidingWindowRateLimiter(2, 1_000, () => now);

    expect(limiter.check("peer")).toEqual({ allowed: true, remaining: 1, retryAfterMs: 0 });
    expect(limiter.check("peer")).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });
    expect(limiter.check("peer")).toEqual({ allowed: false, remaining: 0, retryAfterMs: 1_000 });

    now += 1_001;
    expect(limiter.check("peer").allowed).toBe(true);
  });

  it("supports explicit request timestamps used by signaling admission", () => {
    const limiter = new SlidingWindowRateLimiter(1, 1_000, () => 9_999);

    expect(limiter.consume("peer", 1_000)).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });
    expect(limiter.consume("peer", 1_250)).toEqual({ allowed: false, remaining: 0, retryAfterMs: 750 });
    expect(limiter.consume("peer", 2_001).allowed).toBe(true);
  });

  it("isolates string and object keys and can release per-connection state", () => {
    const limiter = new SlidingWindowRateLimiter(1, 1_000, () => 500);
    const connection = {};

    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    expect(limiter.check("b").allowed).toBe(true);
    expect(limiter.check(connection).allowed).toBe(true);
    expect(limiter.check(connection).allowed).toBe(false);

    expect(limiter.delete(connection)).toBe(true);
    expect(limiter.check(connection).allowed).toBe(true);
  });

  it("prunes expired keys", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(1, 100, () => now);
    limiter.check("a");
    limiter.check("b");
    expect(limiter.trackedKeys).toBe(2);

    now = 101;
    limiter.prune();
    expect(limiter.trackedKeys).toBe(0);
  });
});
