const LOOPBACK_HOSTS = new Set(["localhost", "[::1]", "::1"]);

const isLoopbackHostname = (hostname) => {
  const normalized = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(normalized) || normalized.endsWith(".localhost")) return true;
  const match = normalized.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return Boolean(match && match.slice(1).every(part => Number(part) <= 255));
};

const parseFrontendOrigin = (raw) => {
  if (!raw) throw new Error("BRIDGE_FRONTEND_ORIGIN is required");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("BRIDGE_FRONTEND_ORIGIN must be an exact HTTPS origin");
  }
  if (isLoopbackHostname(url.hostname)) throw new Error("BRIDGE_FRONTEND_ORIGIN must not use a loopback hostname");
  return url.origin;
};

const parseSignalingUrl = (raw) => {
  if (!raw) throw new Error("VITE_SIGNALING_URL is required");
  const url = new URL(raw);
  if (url.protocol !== "wss:" || url.username || url.password || url.pathname !== "/signal" || url.search || url.hash) {
    throw new Error("VITE_SIGNALING_URL must be an absolute wss:// URL with exact /signal path");
  }
  if (isLoopbackHostname(url.hostname)) throw new Error("VITE_SIGNALING_URL must not use a loopback hostname");
  return url;
};

export const loadProductionSmokeConfig = (env = process.env) => {
  const frontendOrigin = parseFrontendOrigin(env.BRIDGE_FRONTEND_ORIGIN);
  const signalingUrl = parseSignalingUrl(env.VITE_SIGNALING_URL);
  const signalingHttpOrigin = new URL(signalingUrl.href);
  signalingHttpOrigin.protocol = "https:";
  signalingHttpOrigin.pathname = "/";

  return {
    frontendOrigin,
    signalingUrl,
    signalingHttpOrigin: signalingHttpOrigin.origin,
    expectMetricsAuth: env.BRIDGE_EXPECT_METRICS_AUTH === "1",
  };
};

const expectOk = (response, label) => {
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
};

const requireHeader = (response, name, predicate, expectation) => {
  const value = response.headers.get(name);
  if (!value || !predicate(value)) throw new Error(`${name} ${expectation}; received ${value ?? "<missing>"}`);
  return value;
};

const expectSameOrigin = (response, expectedOrigin, label) => {
  if (!response.url) return;
  const actualOrigin = new URL(response.url).origin;
  if (actualOrigin !== expectedOrigin) {
    throw new Error(`${label} redirected to unexpected origin ${actualOrigin}`);
  }
};

const expectJson = async (response, expected, label) => {
  const type = response.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new Error(`${label} must return application/json`);
  }
  const body = await response.json();
  for (const [key, value] of Object.entries(expected)) {
    if (body?.[key] !== value) throw new Error(`${label} JSON must contain ${key}=${String(value)}`);
  }
};

export const runProductionSmokePreflight = async (config, fetchFn = fetch) => {
  const frontend = await fetchFn(`${config.frontendOrigin}/`, { redirect: "follow" });
  expectOk(frontend, "frontend");
  expectSameOrigin(frontend, config.frontendOrigin, "frontend");

  const csp = requireHeader(
    frontend,
    "content-security-policy",
    value => value.trim().length > 0,
    "must be present",
  );
  const directives = new Map(csp.split(";").map(part => {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    return [tokens[0]?.toLowerCase(), tokens.slice(1)];
  }).filter(([name]) => Boolean(name)));
  const connectSources = directives.get("connect-src") ?? [];
  if (!connectSources.includes(config.signalingUrl.origin) || connectSources.includes("wss:")) {
    throw new Error(`content-security-policy connect-src must contain exact signaling origin ${config.signalingUrl.origin} and must not retain generic wss:`);
  }
  const defaultSources = directives.get("default-src") ?? [];
  if (!defaultSources.includes("'self'")) throw new Error("content-security-policy must retain default-src 'self'");
  requireHeader(frontend, "x-content-type-options", value => value.toLowerCase() === "nosniff", "must be nosniff");
  requireHeader(frontend, "x-frame-options", value => value.toUpperCase() === "DENY", "must be DENY");
  requireHeader(frontend, "referrer-policy", value => value.toLowerCase() === "no-referrer", "must be no-referrer");
  requireHeader(frontend, "cross-origin-opener-policy", value => value.toLowerCase() === "same-origin", "must be same-origin");
  requireHeader(frontend, "cross-origin-resource-policy", value => value.toLowerCase() === "same-origin", "must be same-origin");
  requireHeader(frontend, "permissions-policy", value => value.trim().length > 0, "must be present");

  for (const path of ["/manifest.webmanifest", "/sw.js"]) {
    const response = await fetchFn(`${config.frontendOrigin}${path}`, { redirect: "follow" });
    expectOk(response, path);
    expectSameOrigin(response, config.frontendOrigin, path);
    requireHeader(response, "cache-control", value => /(?:^|,)\s*no-cache(?:\s*(?:,|$))|max-age=0/i.test(value), "must force revalidation");
  }

  for (const [path, expected] of [["/health", { ok: true }], ["/ready", { ready: true }]]) {
    const response = await fetchFn(`${config.signalingHttpOrigin}${path}`, { redirect: "error" });
    expectOk(response, `signaling ${path}`);
    requireHeader(response, "cache-control", value => value.toLowerCase().includes("no-store"), "must include no-store");
    await expectJson(response, expected, `signaling ${path}`);
  }

  if (config.expectMetricsAuth) {
    const response = await fetchFn(`${config.signalingHttpOrigin}/metrics`, { redirect: "error" });
    if (response.status !== 401) throw new Error(`unauthenticated signaling /metrics must return HTTP 401; received ${response.status}`);
    requireHeader(response, "cache-control", value => value.toLowerCase().includes("no-store"), "must include no-store");
    requireHeader(response, "www-authenticate", value => value.toLowerCase().startsWith("bearer"), "must advertise Bearer authentication");
  }

  return {
    frontendOrigin: config.frontendOrigin,
    signalingOrigin: config.signalingUrl.origin,
    metricsAuthChecked: config.expectMetricsAuth,
  };
};

const isMain = process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url;
if (isMain) {
  try {
    const config = loadProductionSmokeConfig();
    const result = await runProductionSmokePreflight(config);
    console.log(`Bridge production smoke preflight passed for ${result.frontendOrigin} and ${result.signalingOrigin}${result.metricsAuthChecked ? " (metrics auth checked)" : ""}.`);
  } catch (error) {
    console.error(`Bridge production smoke preflight failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
