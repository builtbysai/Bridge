const AUTH_ENV_KEYS = new Set([
  "NODE_AUTH_TOKEN",
  "NPM_TOKEN",
  "NPM_AUTH_TOKEN",
]);

export function sanitizeNpmEnvironment(source) {
  const sanitized = {};

  for (const [key, value] of Object.entries(source)) {
    if (/^npm_config_/i.test(key)) continue;
    if (AUTH_ENV_KEYS.has(key.toUpperCase())) continue;
    sanitized[key] = value;
  }

  return sanitized;
}
