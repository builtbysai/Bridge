import assert from "node:assert/strict";
import test from "node:test";
import {
  verifyProductionDeploymentConfig,
  verifyProductionFrontendArtifactConfig,
} from "./verify-production-deployment-config.mjs";

const validServerEnv = () => ({
  BRIDGE_FRONTEND_ORIGIN: "https://bridge.example.com",
  VITE_SIGNALING_URL: "wss://signal.example.com/signal",
  SIGNAL_ALLOWED_ORIGINS: "https://bridge.example.com",
  SIGNAL_TURN_URLS: "turns:turn.example.com:5349?transport=tcp,turn:turn.example.com:3478?transport=udp",
  SIGNAL_TURN_SHARED_SECRET: "s".repeat(32),
  SIGNAL_TURN_CREDENTIAL_TTL_SECONDS: "900"
});

const validBrowserEnv = () => ({
  BRIDGE_FRONTEND_ORIGIN: "https://bridge.example.com",
  VITE_SIGNALING_URL: "wss://signal.example.com/signal",
  SIGNAL_ALLOWED_ORIGINS: "https://bridge.example.com",
  VITE_BRIDGE_TURN_URLS: "turns:turn.example.com:5349?transport=tcp,turn:turn.example.com:3478?transport=udp",
  VITE_BRIDGE_TURN_USERNAME: "temporary-user",
  VITE_BRIDGE_TURN_CREDENTIAL: "temporary-credential",
  BRIDGE_TURN_CREDENTIAL_EXPOSURE: "browser-safe"
});

const validHeaders = `/*\n  Content-Security-Policy: default-src 'self'; connect-src 'self' wss://signal.example.com; object-src 'none'\n`;

test("validates a production frontend artifact without requiring server TURN secrets", () => {
  const env = {
    BRIDGE_FRONTEND_ORIGIN: "https://bridge.example.com",
    VITE_SIGNALING_URL: "wss://signal.example.com/signal",
  };
  const result = verifyProductionFrontendArtifactConfig({ env, headersText: validHeaders });
  assert.deepEqual(result, {
    frontendOrigin: "https://bridge.example.com",
    signalingOrigin: "wss://signal.example.com",
  });
});

test("frontend artifact validation still rejects broad WebSocket CSP", () => {
  const env = {
    BRIDGE_FRONTEND_ORIGIN: "https://bridge.example.com",
    VITE_SIGNALING_URL: "wss://signal.example.com/signal",
  };
  const headers = `/*\n  Content-Security-Policy: default-src 'self'; connect-src 'self' wss: wss://signal.example.com; object-src 'none'\n`;
  assert.throws(() => verifyProductionFrontendArtifactConfig({ env, headersText: headers }), /must not retain the generic wss:/);
});

test("accepts server-managed ephemeral TURN credentials", () => {
  const result = verifyProductionDeploymentConfig({ env: validServerEnv(), headersText: validHeaders });
  assert.equal(result.frontendOrigin, "https://bridge.example.com");
  assert.equal(result.signalingOrigin, "wss://signal.example.com");
  assert.equal(result.turnMode, "server-ephemeral");
  assert.equal(result.turnServerCount, 2);
});

test("retains explicitly acknowledged browser-safe TURN fallback", () => {
  const result = verifyProductionDeploymentConfig({ env: validBrowserEnv(), headersText: validHeaders });
  assert.equal(result.turnMode, "browser-static");
  assert.equal(result.turnServerCount, 2);
});

test("rejects a frontend origin missing from signaling admission", () => {
  const env = validServerEnv();
  env.SIGNAL_ALLOWED_ORIGINS = "https://other.example.com";
  assert.throws(() => verifyProductionDeploymentConfig({ env, headersText: validHeaders }), /must include BRIDGE_FRONTEND_ORIGIN/);
});

test("rejects insecure or loopback production endpoints", () => {
  const env = validServerEnv();
  env.VITE_SIGNALING_URL = "ws://localhost:8787/signal";
  assert.throws(() => verifyProductionDeploymentConfig({ env, headersText: validHeaders }), /must use wss:/);
});

test("rejects every runtime-recognized loopback family before deployment", () => {
  const cases = [
    { field: "BRIDGE_FRONTEND_ORIGIN", value: "https://preview.localhost" },
    { field: "BRIDGE_FRONTEND_ORIGIN", value: "https://127.2.3.4" },
    { field: "VITE_SIGNALING_URL", value: "wss://dev.localhost/signal" },
    { field: "VITE_SIGNALING_URL", value: "wss://127.99.1.2/signal" },
    { field: "VITE_SIGNALING_URL", value: "wss://[::1]/signal" },
    { field: "VITE_SIGNALING_URL", value: "wss://[0:0:0:0:0:0:0:1]/signal" },
  ];

  for (const { field, value } of cases) {
    const env = validServerEnv();
    env[field] = value;
    assert.throws(
      () => verifyProductionDeploymentConfig({ env, headersText: validHeaders }),
      /must not use a loopback hostname in production/,
      `${field} should reject ${value}`,
    );
  }

  const env = validServerEnv();
  env.SIGNAL_ALLOWED_ORIGINS = "https://bridge.example.com,https://127.42.0.7";
  assert.throws(
    () => verifyProductionDeploymentConfig({ env, headersText: validHeaders }),
    /SIGNAL_ALLOWED_ORIGINS entry must not use a loopback hostname in production/,
  );
});

test("requires explicit acknowledgement that Vite TURN credentials are browser-visible", () => {
  const env = validBrowserEnv();
  delete env.BRIDGE_TURN_CREDENTIAL_EXPOSURE;
  assert.throws(() => verifyProductionDeploymentConfig({ env, headersText: validHeaders }), /safe to expose to every frontend user/);
});

test("rejects ambiguous server-managed and browser-visible TURN configuration", () => {
  const env = { ...validServerEnv(), ...validBrowserEnv() };
  assert.throws(() => verifyProductionDeploymentConfig({ env, headersText: validHeaders }), /not both/);
});

test("rejects malformed server-side TURN credential settings", () => {
  const shortSecret = validServerEnv();
  shortSecret.SIGNAL_TURN_SHARED_SECRET = "short";
  assert.throws(() => verifyProductionDeploymentConfig({ env: shortSecret, headersText: validHeaders }), /SIGNAL_TURN_SHARED_SECRET/);

  const whitespaceSecret = validServerEnv();
  whitespaceSecret.SIGNAL_TURN_SHARED_SECRET = `contains space ${"x".repeat(32)}`;
  assert.throws(() => verifyProductionDeploymentConfig({ env: whitespaceSecret, headersText: validHeaders }), /SIGNAL_TURN_SHARED_SECRET/);

  const excessiveTtl = validServerEnv();
  excessiveTtl.SIGNAL_TURN_CREDENTIAL_TTL_SECONDS = "3601";
  assert.throws(() => verifyProductionDeploymentConfig({ env: excessiveTtl, headersText: validHeaders }), /SIGNAL_TURN_CREDENTIAL_TTL_SECONDS/);

  const oversizedPort = validServerEnv();
  oversizedPort.SIGNAL_TURN_URLS = "turn:turn.example.com:999999";
  assert.throws(() => verifyProductionDeploymentConfig({ env: oversizedPort, headersText: validHeaders }), /invalid TURN URL/);
});

test("rejects missing TURN configuration", () => {
  const env = validServerEnv();
  delete env.SIGNAL_TURN_URLS;
  delete env.SIGNAL_TURN_SHARED_SECRET;
  delete env.SIGNAL_TURN_CREDENTIAL_TTL_SECONDS;
  assert.throws(() => verifyProductionDeploymentConfig({ env, headersText: validHeaders }), /Production requires TURN configuration/);
});

test("rejects a generic production WebSocket CSP allowance", () => {
  const headers = `/*\n  Content-Security-Policy: default-src 'self'; connect-src 'self' wss: wss://signal.example.com; object-src 'none'\n`;
  assert.throws(() => verifyProductionDeploymentConfig({ env: validServerEnv(), headersText: headers }), /must not retain the generic wss:/);
});

test("requires the exact signaling origin in CSP", () => {
  const headers = `/*\n  Content-Security-Policy: default-src 'self'; connect-src 'self' wss://other.example.com; object-src 'none'\n`;
  assert.throws(() => verifyProductionDeploymentConfig({ env: validServerEnv(), headersText: headers }), /must include the exact signaling origin/);
});
