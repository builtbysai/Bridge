import { describe, expect, it } from "vitest";
import { loadSignalingConfig } from "./config.js";

describe("loadSignalingConfig", () => {
  it("uses reviewed defaults when variables are absent", () => {
    expect(loadSignalingConfig({})).toEqual({
      port: 8787,
      sessionTtlMs: 600_000,
      sessionCleanupIntervalMs: 30_000,
      attachTimeoutMs: 30_000,
      heartbeatIntervalMs: 30_000,
      shutdownGraceMs: 5_000,
      maxMessageBytes: 262_144,
      maxSessions: 10_000,
      maxConnections: 20_000,
      connectionMessageLimit: 120,
      createLimit: 20,
      joinLimit: 60,
      allowedOrigins: [],
      metricsBearerToken: null,
      turnUrls: [],
      turnSharedSecret: null,
      turnCredentialTtlSeconds: 900,
    });
  });

  it("accepts explicit positive integer overrides, canonical origins, metrics auth, and TURN REST configuration", () => {
    expect(
      loadSignalingConfig({
        PORT: "9000",
        SESSION_TTL_MS: "120000",
        SESSION_CLEANUP_INTERVAL_MS: "10000",
        SIGNAL_ATTACH_TIMEOUT_MS: "45000",
        SIGNAL_HEARTBEAT_INTERVAL_MS: "20000",
        SIGNAL_SHUTDOWN_GRACE_MS: "15000",
        MAX_SIGNAL_MESSAGE_BYTES: "131072",
        MAX_SIGNAL_SESSIONS: "2500",
        MAX_SIGNAL_CONNECTIONS: "5000",
        SIGNAL_MESSAGES_PER_MINUTE: "90",
        SIGNAL_CREATES_PER_10_MINUTES: "10",
        SIGNAL_JOINS_PER_10_MINUTES: "30",
        SIGNAL_ALLOWED_ORIGINS: "https://bridge.example.com, http://localhost:4173,https://bridge.example.com",
        SIGNAL_METRICS_BEARER_TOKEN: "m".repeat(32),
        SIGNAL_TURN_URLS: "turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp",
        SIGNAL_TURN_SHARED_SECRET: "s".repeat(32),
        SIGNAL_TURN_CREDENTIAL_TTL_SECONDS: "1200",
      }),
    ).toEqual({
      port: 9000,
      sessionTtlMs: 120_000,
      sessionCleanupIntervalMs: 10_000,
      attachTimeoutMs: 45_000,
      heartbeatIntervalMs: 20_000,
      shutdownGraceMs: 15_000,
      maxMessageBytes: 131_072,
      maxSessions: 2500,
      maxConnections: 5000,
      connectionMessageLimit: 90,
      createLimit: 10,
      joinLimit: 30,
      allowedOrigins: ["https://bridge.example.com", "http://localhost:4173"],
      metricsBearerToken: "m".repeat(32),
      turnUrls: ["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349?transport=tcp"],
      turnSharedSecret: "s".repeat(32),
      turnCredentialTtlSeconds: 1200,
    });
  });

  it("requires TURN credentials to remain valid for the full session lifetime", () => {
    const baseTurn = {
      SIGNAL_TURN_URLS: "turn:turn.example.com:3478",
      SIGNAL_TURN_SHARED_SECRET: "s".repeat(32),
    };

    expect(() => loadSignalingConfig({
      ...baseTurn,
      SESSION_TTL_MS: "120001",
      SIGNAL_TURN_CREDENTIAL_TTL_SECONDS: "120",
    })).toThrow("must be at least the configured SESSION_TTL_MS");

    expect(loadSignalingConfig({
      ...baseTurn,
      SESSION_TTL_MS: "120000",
      SIGNAL_TURN_CREDENTIAL_TTL_SECONDS: "120",
    }).turnCredentialTtlSeconds).toBe(120);
  });

  it("requires a non-loopback HTTPS origin allowlist in production", () => {
    expect(() => loadSignalingConfig({ NODE_ENV: "production" })).toThrow(
      "SIGNAL_ALLOWED_ORIGINS is required",
    );
    expect(() =>
      loadSignalingConfig({
        NODE_ENV: "production",
        SIGNAL_ALLOWED_ORIGINS: "http://bridge.example.com",
      }),
    ).toThrow("only HTTPS origins");

    for (const origin of [
      "https://localhost",
      "https://bridge.localhost:4443",
      "https://127.0.0.1",
      "https://127.10.20.30:8443",
      "https://[::1]",
    ]) {
      expect(() => loadSignalingConfig({
        NODE_ENV: "production",
        SIGNAL_ALLOWED_ORIGINS: origin,
      })).toThrow("must not contain loopback origins");
    }

    expect(
      loadSignalingConfig({
        NODE_ENV: "production",
        SIGNAL_ALLOWED_ORIGINS: "https://bridge.example.com",
      }).allowedOrigins,
    ).toEqual(["https://bridge.example.com"]);
  });

  it("requires TURN URLs and shared secret to be configured together", () => {
    expect(() => loadSignalingConfig({ SIGNAL_TURN_URLS: "turn:turn.example.com:3478" })).toThrow(
      "must be configured together",
    );
    expect(() => loadSignalingConfig({ SIGNAL_TURN_SHARED_SECRET: "s".repeat(32) })).toThrow(
      "must be configured together",
    );
  });

  it.each([
    "https://turn.example.com",
    "turn:user@turn.example.com:3478",
    "turn:turn.example.com:70000",
    "turn:turn.example.com:999999",
    "turn:turn.example.com:3478?debug=1",
    "turn:turn.example.com:3478#fragment",
  ])("rejects invalid SIGNAL_TURN_URLS entry %s", (value) => {
    expect(() => loadSignalingConfig({
      SIGNAL_TURN_URLS: value,
      SIGNAL_TURN_SHARED_SECRET: "s".repeat(32),
    })).toThrow("SIGNAL_TURN_URLS");
  });

  it.each([
    ["PORT", "0"],
    ["PORT", "65536"],
    ["SESSION_TTL_MS", "-1"],
    ["SESSION_TTL_MS", "86400001"],
    ["SESSION_CLEANUP_INTERVAL_MS", "300001"],
    ["SIGNAL_ATTACH_TIMEOUT_MS", "0"],
    ["SIGNAL_ATTACH_TIMEOUT_MS", "300001"],
    ["SIGNAL_HEARTBEAT_INTERVAL_MS", "0"],
    ["SIGNAL_HEARTBEAT_INTERVAL_MS", "300001"],
    ["SIGNAL_SHUTDOWN_GRACE_MS", "0"],
    ["SIGNAL_SHUTDOWN_GRACE_MS", "60001"],
    ["MAX_SIGNAL_MESSAGE_BYTES", "NaN"],
    ["MAX_SIGNAL_MESSAGE_BYTES", "1048577"],
    ["MAX_SIGNAL_SESSIONS", "1.5"],
    ["MAX_SIGNAL_SESSIONS", "100001"],
    ["MAX_SIGNAL_CONNECTIONS", "0"],
    ["MAX_SIGNAL_CONNECTIONS", "1.5"],
    ["MAX_SIGNAL_CONNECTIONS", "200001"],
    ["SIGNAL_MESSAGES_PER_MINUTE", "Infinity"],
    ["SIGNAL_MESSAGES_PER_MINUTE", "10001"],
    ["SIGNAL_CREATES_PER_10_MINUTES", "0"],
    ["SIGNAL_CREATES_PER_10_MINUTES", "1001"],
    ["SIGNAL_JOINS_PER_10_MINUTES", "abc"],
    ["SIGNAL_JOINS_PER_10_MINUTES", "5001"],
    ["SIGNAL_TURN_CREDENTIAL_TTL_SECONDS", "0"],
    ["SIGNAL_TURN_CREDENTIAL_TTL_SECONDS", "3601"],
  ])("rejects invalid %s=%s", (name, value) => {
    expect(() => loadSignalingConfig({ [name]: value })).toThrow(name);
  });

  it.each([
    "https://bridge.example.com/path",
    "https://bridge.example.com?debug=1",
    "https://bridge.example.com/#fragment",
    "https://user@example.com",
    "wss://bridge.example.com",
    "bridge.example.com",
    "https://bridge.example.com,",
  ])("rejects invalid SIGNAL_ALLOWED_ORIGINS entry %s", (value) => {
    expect(() => loadSignalingConfig({ SIGNAL_ALLOWED_ORIGINS: value })).toThrow(
      "SIGNAL_ALLOWED_ORIGINS",
    );
  });

  it.each([
    "short",
    "contains whitespace even though it is long enough",
    "x".repeat(513),
  ])("rejects invalid SIGNAL_METRICS_BEARER_TOKEN values", (value) => {
    expect(() => loadSignalingConfig({ SIGNAL_METRICS_BEARER_TOKEN: value })).toThrow(
      "SIGNAL_METRICS_BEARER_TOKEN",
    );
  });

  it.each([
    "short",
    `control\n${"x".repeat(32)}`,
    `contains space ${"x".repeat(32)}`,
    "x".repeat(513),
  ])("rejects invalid SIGNAL_TURN_SHARED_SECRET values", (value) => {
    expect(() => loadSignalingConfig({
      SIGNAL_TURN_URLS: "turn:turn.example.com:3478",
      SIGNAL_TURN_SHARED_SECRET: value,
    })).toThrow("SIGNAL_TURN_SHARED_SECRET");
  });
});