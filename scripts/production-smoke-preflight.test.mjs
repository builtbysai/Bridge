import assert from "node:assert/strict";
import test from "node:test";
import { loadProductionSmokeConfig, runProductionSmokePreflight } from "./production-smoke-preflight.mjs";

const headers = {
  "content-security-policy": "default-src 'self'; connect-src 'self' wss://signal.example.com; object-src 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

const jsonResponse = ({ status = 200, headers: extraHeaders = {}, body = {} } = {}) => new Response(
  JSON.stringify(body),
  { status, headers: extraHeaders },
);

const successfulFetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.hostname === "app.example.com" && parsed.pathname === "/") {
    return new Response("<!doctype html>", { status: 200, headers: new Headers(headers) });
  }
  if (parsed.hostname === "app.example.com" && ["/manifest.webmanifest", "/sw.js"].includes(parsed.pathname)) {
    return new Response("ok", { status: 200, headers: { "cache-control": "no-cache" } });
  }
  if (parsed.hostname === "signal.example.com" && parsed.pathname === "/health") {
    return jsonResponse({ headers: { "content-type": "application/json", "cache-control": "no-store" }, body: { ok: true } });
  }
  if (parsed.hostname === "signal.example.com" && parsed.pathname === "/ready") {
    return jsonResponse({ headers: { "content-type": "application/json", "cache-control": "no-store" }, body: { ready: true } });
  }
  if (parsed.hostname === "signal.example.com" && parsed.pathname === "/metrics") {
    return jsonResponse({ status: 401, headers: { "cache-control": "no-store", "www-authenticate": "Bearer" }, body: { error: "unauthorized" } });
  }
  throw new Error(`Unexpected URL ${url}`);
};

test("rejects insecure or loopback production endpoints", () => {
  assert.throws(() => loadProductionSmokeConfig({ BRIDGE_FRONTEND_ORIGIN: "http://app.example.com", VITE_SIGNALING_URL: "wss://signal.example.com/signal" }));
  assert.throws(() => loadProductionSmokeConfig({ BRIDGE_FRONTEND_ORIGIN: "https://localhost", VITE_SIGNALING_URL: "wss://signal.example.com/signal" }));
  assert.throws(() => loadProductionSmokeConfig({ BRIDGE_FRONTEND_ORIGIN: "https://app.example.com", VITE_SIGNALING_URL: "ws://signal.example.com/signal" }));
  assert.throws(() => loadProductionSmokeConfig({ BRIDGE_FRONTEND_ORIGIN: "https://app.example.com", VITE_SIGNALING_URL: "wss://127.0.0.2/signal" }));
});

test("accepts the reviewed production frontend and signaling contract", async () => {
  const config = loadProductionSmokeConfig({ BRIDGE_FRONTEND_ORIGIN: "https://app.example.com", VITE_SIGNALING_URL: "wss://signal.example.com/signal" });
  const result = await runProductionSmokePreflight(config, successfulFetch);
  assert.equal(result.frontendOrigin, "https://app.example.com");
  assert.equal(result.signalingOrigin, "wss://signal.example.com");
  assert.equal(result.metricsAuthChecked, false);
});

test("rejects generic or mismatched production websocket CSP", async () => {
  const config = loadProductionSmokeConfig({ BRIDGE_FRONTEND_ORIGIN: "https://app.example.com", VITE_SIGNALING_URL: "wss://signal.example.com/signal" });
  const badFetch = async (url) => {
    if (url === "https://app.example.com/") {
      return new Response("ok", { status: 200, headers: { ...headers, "content-security-policy": "default-src 'self'; connect-src 'self' wss:" } });
    }
    return successfulFetch(url);
  };
  await assert.rejects(() => runProductionSmokePreflight(config, badFetch), /exact signaling origin/);
});

test("rejects signaling origin placed outside connect-src", async () => {
  const config = loadProductionSmokeConfig({ BRIDGE_FRONTEND_ORIGIN: "https://app.example.com", VITE_SIGNALING_URL: "wss://signal.example.com/signal" });
  const badFetch = async (url) => {
    if (url === "https://app.example.com/") {
      return new Response("ok", { status: 200, headers: { ...headers, "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' wss://signal.example.com" } });
    }
    return successfulFetch(url);
  };
  await assert.rejects(() => runProductionSmokePreflight(config, badFetch), /connect-src/);
});

test("rejects unhealthy or draining signaling runtime", async () => {
  const config = loadProductionSmokeConfig({ BRIDGE_FRONTEND_ORIGIN: "https://app.example.com", VITE_SIGNALING_URL: "wss://signal.example.com/signal" });
  const drainingFetch = async (url) => {
    if (url === "https://signal.example.com/ready") {
      return jsonResponse({ status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: { ready: false } });
    }
    return successfulFetch(url);
  };
  await assert.rejects(() => runProductionSmokePreflight(config, drainingFetch), /HTTP 503/);
});

test("can require unauthenticated metrics to fail closed", async () => {
  const config = loadProductionSmokeConfig({ BRIDGE_FRONTEND_ORIGIN: "https://app.example.com", VITE_SIGNALING_URL: "wss://signal.example.com/signal", BRIDGE_EXPECT_METRICS_AUTH: "1" });
  const result = await runProductionSmokePreflight(config, successfulFetch);
  assert.equal(result.metricsAuthChecked, true);
});
