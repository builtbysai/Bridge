import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeNpmEnvironment } from "./npm-environment.mjs";

test("preserves unrelated process environment values", () => {
  assert.deepEqual(
    sanitizeNpmEnvironment({ PATH: "/usr/bin", HOME: "/tmp/home", CI: "true" }),
    { PATH: "/usr/bin", HOME: "/tmp/home", CI: "true" },
  );
});

test("removes npm configuration overrides case-insensitively", () => {
  assert.deepEqual(
    sanitizeNpmEnvironment({
      npm_config_registry: "https://example.invalid/",
      NPM_CONFIG_USERCONFIG: "/tmp/ambient-npmrc",
      NpM_CoNfIg_Proxy: "http://proxy.invalid",
      PATH: "/usr/bin",
    }),
    { PATH: "/usr/bin" },
  );
});

test("removes common npm/node authentication token environment variables", () => {
  assert.deepEqual(
    sanitizeNpmEnvironment({
      NODE_AUTH_TOKEN: "node-secret",
      npm_token: "npm-secret",
      NPM_AUTH_TOKEN: "auth-secret",
      CI: "true",
    }),
    { CI: "true" },
  );
});
