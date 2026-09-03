import { describe, expect, it } from "vitest";
import { parseSignalingEvent } from "./signaling";

describe("parseSignalingEvent TURN credentials", () => {
  it("accepts a bounded future temporary TURN credential bundle", () => {
    const expiresAt = Date.now() + 60_000;
    expect(parseSignalingEvent(JSON.stringify({
      type: "turn-credentials",
      urls: ["turn:turn.example.test:3478?transport=udp", "turns:turn.example.test:5349?transport=tcp"],
      username: "1700000900:bridge",
      credential: "temporary-password",
      expiresAt,
    }))).toEqual({
      type: "turn-credentials",
      urls: ["turn:turn.example.test:3478?transport=udp", "turns:turn.example.test:5349?transport=tcp"],
      username: "1700000900:bridge",
      credential: "temporary-password",
      expiresAt,
    });
  });

  it("rejects expired, non-TURN, empty, and oversized credential bundles", () => {
    const future = Date.now() + 60_000;
    expect(() => parseSignalingEvent(JSON.stringify({
      type: "turn-credentials",
      urls: ["https://turn.example.test"],
      username: "user",
      credential: "credential",
      expiresAt: future,
    }))).toThrow(/TURN URL/);
    expect(() => parseSignalingEvent(JSON.stringify({
      type: "turn-credentials",
      urls: [],
      username: "user",
      credential: "credential",
      expiresAt: future,
    }))).toThrow(/TURN URL list/);
    expect(() => parseSignalingEvent(JSON.stringify({
      type: "turn-credentials",
      urls: ["turn:turn.example.test:3478"],
      username: "user",
      credential: "credential",
      expiresAt: Date.now() - 1,
    }))).toThrow(/expiry/);
    expect(() => parseSignalingEvent(JSON.stringify({
      type: "turn-credentials",
      urls: Array.from({ length: 9 }, () => "turn:turn.example.test:3478"),
      username: "user",
      credential: "credential",
      expiresAt: future,
    }))).toThrow(/TURN URL list/);
  });
});
