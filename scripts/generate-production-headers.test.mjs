import assert from "node:assert/strict";
import test from "node:test";
import { generateProductionHeaders } from "./generate-production-headers.mjs";

const BASELINE = `/*\n  Content-Security-Policy: default-src 'self'; connect-src 'self' wss:; object-src 'none';\n  Referrer-Policy: no-referrer\n`;

test("narrows generic wss allowance to exact production signaling origin", () => {
  const output = generateProductionHeaders({
    headersText: BASELINE,
    signalingUrl: "wss://signal.example.com/signal",
  });
  assert.match(output, /connect-src 'self' wss:\/\/signal\.example\.com;/);
  assert.doesNotMatch(output, /connect-src[^;]*(?:^|\s)wss:(?=\s|;|$)/m);
});

test("preserves explicit non-default signaling port", () => {
  const output = generateProductionHeaders({
    headersText: BASELINE,
    signalingUrl: "wss://signal.example.com:8443/signal",
  });
  assert.match(output, /wss:\/\/signal\.example\.com:8443/);
});

test("rejects insecure, loopback, or non-signal URLs", () => {
  for (const signalingUrl of [
    "ws://signal.example.com/signal",
    "wss://localhost/signal",
    "wss://127.0.0.1/signal",
    "wss://signal.example.com/other",
    "wss://signal.example.com/signal?token=x",
  ]) {
    assert.throws(() => generateProductionHeaders({ headersText: BASELINE, signalingUrl }));
  }
});

test("rejects a baseline without exactly one generic wss token", () => {
  assert.throws(() => generateProductionHeaders({
    headersText: BASELINE.replace(" wss:", ""),
    signalingUrl: "wss://signal.example.com/signal",
  }), /exactly one generic wss: token/);

  assert.throws(() => generateProductionHeaders({
    headersText: BASELINE.replace("wss:", "wss: wss:"),
    signalingUrl: "wss://signal.example.com/signal",
  }), /exactly one generic wss: token/);
});

test("rejects missing or duplicate CSP headers", () => {
  assert.throws(() => generateProductionHeaders({
    headersText: "/*\n  Referrer-Policy: no-referrer\n",
    signalingUrl: "wss://signal.example.com/signal",
  }), /exactly one Content-Security-Policy/);

  assert.throws(() => generateProductionHeaders({
    headersText: `${BASELINE}  Content-Security-Policy: connect-src 'self' wss:;\n`,
    signalingUrl: "wss://signal.example.com/signal",
  }), /exactly one Content-Security-Policy/);
});
