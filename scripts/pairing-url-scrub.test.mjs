import assert from "node:assert/strict";
import test from "node:test";
import {
  sanitizeConsumedPairingUrl,
  scrubConsumedPairingSecret,
} from "../src/pairing-url-scrub.mjs";

const SECRET = "42".repeat(32);

test("removes the consumed pairing key while preserving the session route", () => {
  assert.equal(
    sanitizeConsumedPairingUrl(`https://bridge.example/?session=abc123def456&portal=receive#key=${SECRET}`),
    "https://bridge.example/?session=abc123def456&portal=receive",
  );
});

test("preserves unrelated fragment parameters", () => {
  assert.equal(
    sanitizeConsumedPairingUrl(`https://bridge.example/?session=abc123def456#key=${SECRET}&mode=receive`),
    "https://bridge.example/?session=abc123def456#mode=receive",
  );
});

test("returns null when the URL does not contain pairing material", () => {
  assert.equal(
    sanitizeConsumedPairingUrl("https://bridge.example/?session=abc123def456#mode=receive"),
    null,
  );
});

test("replaces the current history entry without persisting the secret", () => {
  const calls = [];
  const fakeWindow = {
    location: {
      href: `https://bridge.example/?session=abc123def456#key=${SECRET}`,
    },
    history: {
      state: { retained: true },
      replaceState: (...args) => calls.push(args),
    },
  };

  assert.equal(scrubConsumedPairingSecret(fakeWindow), true);
  assert.deepEqual(calls, [[{ retained: true }, "", "https://bridge.example/?session=abc123def456"]]);
  assert.equal(JSON.stringify(calls).includes(SECRET), false);
});

test("does not rewrite history when no pairing key is present", () => {
  let rewrites = 0;
  const fakeWindow = {
    location: { href: "https://bridge.example/?session=abc123def456" },
    history: {
      state: null,
      replaceState: () => { rewrites += 1; },
    },
  };

  assert.equal(scrubConsumedPairingSecret(fakeWindow), false);
  assert.equal(rewrites, 0);
});
