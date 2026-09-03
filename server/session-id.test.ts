import { describe, expect, it } from "vitest";
import {
  allocateSessionId,
  MAX_SESSION_ID_ALLOCATION_ATTEMPTS,
} from "./session-id.js";

describe("allocateSessionId", () => {
  it("returns the first unused candidate", () => {
    expect(allocateSessionId(() => false, () => "ABCDEF123456")).toBe("abcdef123456");
  });

  it("retries collisions instead of replacing an existing session", () => {
    const candidates = ["aaaaaaaaaaaa", "bbbbbbbbbbbb"];
    const seen = new Set(["aaaaaaaaaaaa"]);

    expect(allocateSessionId(id => seen.has(id), () => candidates.shift()!)).toBe("bbbbbbbbbbbb");
  });

  it("fails closed after the bounded retry budget is exhausted", () => {
    let calls = 0;
    const result = allocateSessionId(
      () => true,
      () => {
        calls += 1;
        return "aaaaaaaaaaaa";
      },
    );

    expect(result).toBeNull();
    expect(calls).toBe(MAX_SESSION_ID_ALLOCATION_ATTEMPTS);
  });

  it("rejects malformed internal candidates", () => {
    expect(() => allocateSessionId(() => false, () => "not-an-id")).toThrow(
      /exactly 12 hexadecimal characters/,
    );
  });
});
