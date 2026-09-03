import test from "node:test";
import assert from "node:assert/strict";
import { verifyProductionEnvTemplate } from "./verify-production-env-template.mjs";

const valid = `
NODE_ENV=production
BRIDGE_FRONTEND_ORIGIN=https://<frontend-host>
VITE_SIGNALING_URL=wss://<signaling-host>/signal
SIGNAL_ALLOWED_ORIGINS=https://<frontend-host>
SIGNAL_TURN_URLS=turns:<turn-host>:5349?transport=tcp,turn:<turn-host>:3478?transport=udp
SIGNAL_TURN_SHARED_SECRET=<store-in-server-secret-manager>
SIGNAL_TURN_CREDENTIAL_TTL_SECONDS=900
# SIGNAL_METRICS_BEARER_TOKEN=<store-in-server-secret-manager>
`;

test("accepts the reviewed placeholder-only production template contract", () => {
  assert.equal(verifyProductionEnvTemplate(valid), true);
});

test("rejects browser-visible TURN credential mode in the production template", () => {
  assert.throws(
    () => verifyProductionEnvTemplate(`${valid}\nVITE_BRIDGE_TURN_CREDENTIAL=public-password\n`),
    /browser-visible TURN credentials/,
  );
});

test("rejects a committed durable TURN secret", () => {
  assert.throws(
    () => verifyProductionEnvTemplate(valid.replace("<store-in-server-secret-manager>", "this-is-a-real-looking-secret-value-123456")),
    /must remain a placeholder/,
  );
});

test("rejects missing required production wiring", () => {
  assert.throws(
    () => verifyProductionEnvTemplate(valid.replace("VITE_SIGNALING_URL=wss://<signaling-host>/signal\n", "")),
    /missing required line/,
  );
});
