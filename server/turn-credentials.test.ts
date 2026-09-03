import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTurnCredentialBundle } from "./turn-credentials.js";

describe("createTurnCredentialBundle", () => {
  it("creates coturn-compatible short-lived credentials", () => {
    const nowMs = 1_700_000_000_000;
    const secret = "s".repeat(32);
    const bundle = createTurnCredentialBundle(
      ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349?transport=tcp"],
      secret,
      900,
      nowMs,
    );

    expect(bundle.username).toBe("1700000900:bridge");
    expect(bundle.credential).toBe(
      createHmac("sha1", secret).update(bundle.username, "utf8").digest("base64"),
    );
    expect(bundle.expiresAt).toBe(1_700_000_900_000);
    expect(bundle.urls).toEqual([
      "turn:turn.example.com:3478?transport=udp",
      "turns:turn.example.com:5349?transport=tcp",
    ]);
  });

  it("does not retain a caller-owned URL array", () => {
    const urls = ["turn:turn.example.com:3478"];
    const bundle = createTurnCredentialBundle(urls, "x".repeat(32), 60, 0);
    urls[0] = "turn:changed.example.com:3478";
    expect(bundle.urls).toEqual(["turn:turn.example.com:3478"]);
  });

  it.each([
    [[], "x".repeat(32), 60, 0],
    [["turn:turn.example.com:3478"], "", 60, 0],
    [["turn:turn.example.com:3478"], "x".repeat(32), 0, 0],
    [["turn:turn.example.com:3478"], "x".repeat(32), 60, -1],
  ])("rejects invalid generation input", (urls, secret, ttlSeconds, nowMs) => {
    expect(() => createTurnCredentialBundle(urls, secret, ttlSeconds, nowMs)).toThrow();
  });
});
