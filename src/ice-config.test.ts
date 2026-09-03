import { describe, expect, it } from "vitest";
import { iceServersFromEnvironment } from "./ice-config";

describe("iceServersFromEnvironment", () => {
  it("uses the default STUN server when nothing is configured", () => {
    expect(iceServersFromEnvironment({})).toEqual([
      { urls: ["stun:stun.l.google.com:19302"] }
    ]);
  });

  it("adds TURN configuration without exposing or inventing defaults", () => {
    expect(iceServersFromEnvironment({
      VITE_BRIDGE_STUN_URLS: "stun:stun.example.test:3478, stuns:stun.example.test:5349",
      VITE_BRIDGE_TURN_URLS: "turn:127.0.0.1:3478?transport=udp, turns:relay.example.test:5349?transport=tcp",
      VITE_BRIDGE_TURN_USERNAME: "bridge-test",
      VITE_BRIDGE_TURN_CREDENTIAL: "test-only-password"
    })).toEqual([
      { urls: ["stun:stun.example.test:3478", "stuns:stun.example.test:5349"] },
      {
        urls: ["turn:127.0.0.1:3478?transport=udp", "turns:relay.example.test:5349?transport=tcp"],
        username: "bridge-test",
        credential: "test-only-password"
      }
    ]);
  });

  it("prefers signaling-issued ephemeral TURN credentials over static browser credentials", () => {
    expect(iceServersFromEnvironment({
      VITE_BRIDGE_TURN_URLS: "turn:static.example.test:3478",
      VITE_BRIDGE_TURN_USERNAME: "static-user",
      VITE_BRIDGE_TURN_CREDENTIAL: "static-password"
    }, {
      urls: ["turn:ephemeral.example.test:3478?transport=udp"],
      username: "1700000900:bridge",
      credential: "temporary-password",
      expiresAt: 1_700_000_900_000
    }, 1_700_000_000_000)).toEqual([
      { urls: ["stun:stun.l.google.com:19302"] },
      {
        urls: ["turn:ephemeral.example.test:3478?transport=udp"],
        username: "1700000900:bridge",
        credential: "temporary-password"
      }
    ]);
  });

  it("rejects expired signaling-issued TURN credentials", () => {
    expect(() => iceServersFromEnvironment({}, {
      urls: ["turn:ephemeral.example.test:3478"],
      username: "1700000000:bridge",
      credential: "temporary-password",
      expiresAt: 1_700_000_000_000
    }, 1_700_000_000_000)).toThrow(/expired or invalid/);
  });

  it("rejects malformed or oversized signaling-issued TURN URLs", () => {
    expect(() => iceServersFromEnvironment({}, {
      urls: ["turn:ephemeral.example.test:999999"],
      username: "1700000900:bridge",
      credential: "temporary-password",
      expiresAt: 1_700_000_900_000
    }, 1_700_000_000_000)).toThrow(/TURN URL is invalid/);
  });

  it("fails closed on incomplete TURN credentials", () => {
    expect(() => iceServersFromEnvironment({
      VITE_BRIDGE_TURN_URLS: "turn:relay.example.test:3478",
      VITE_BRIDGE_TURN_USERNAME: "bridge"
    })).toThrow(/require both/);
  });

  it("rejects unexpected or malformed static TURN URLs", () => {
    for (const url of ["https://relay.example.test", "turn:relay.example.test:999999"]) {
      expect(() => iceServersFromEnvironment({
        VITE_BRIDGE_TURN_URLS: url,
        VITE_BRIDGE_TURN_USERNAME: "bridge",
        VITE_BRIDGE_TURN_CREDENTIAL: "credential"
      })).toThrow(/TURN URL/);
    }
  });
});
