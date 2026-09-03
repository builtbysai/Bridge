import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TURN_URL_PATTERN = /^(turns?):(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?(?:\?transport=(udp|tcp))?$/i;

const splitCsv = value => (value ?? "").split(",").map(item => item.trim()).filter(Boolean);

const requireValue = (env, name) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for production deployment validation`);
  return value;
};

const isLoopbackHostname = hostname => {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1"
  ) {
    return true;
  }

  const ipv4 = normalized.split(".");
  return ipv4.length === 4 && ipv4.every(part => /^\d{1,3}$/.test(part)) && Number(ipv4[0]) === 127;
};

const parseExactOrigin = (raw, name) => {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${name} must use https:`);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`${name} must be an exact HTTPS origin with no credentials, path, query, or fragment`);
  }
  if (isLoopbackHostname(url.hostname)) throw new Error(`${name} must not use a loopback hostname in production`);
  return url.origin;
};

const parseSignalingUrl = raw => {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("VITE_SIGNALING_URL must be an absolute URL");
  }
  if (url.protocol !== "wss:") throw new Error("VITE_SIGNALING_URL must use wss: in production");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/signal") {
    throw new Error("VITE_SIGNALING_URL must be an exact wss://host/signal URL with no credentials, query, or fragment");
  }
  if (isLoopbackHostname(url.hostname)) throw new Error("VITE_SIGNALING_URL must not use a loopback hostname in production");
  return url;
};

const assertAllowedOrigins = (raw, frontendOrigin) => {
  const origins = splitCsv(raw);
  if (origins.length === 0) throw new Error("SIGNAL_ALLOWED_ORIGINS is required in production");
  const normalized = origins.map(origin => parseExactOrigin(origin, "SIGNAL_ALLOWED_ORIGINS entry"));
  if (!normalized.includes(frontendOrigin)) {
    throw new Error("SIGNAL_ALLOWED_ORIGINS must include BRIDGE_FRONTEND_ORIGIN exactly");
  }
};

const assertTurnUrls = (raw, name) => {
  const urls = splitCsv(raw);
  if (urls.length === 0) throw new Error(`${name} must contain at least one TURN URL`);
  for (const url of urls) {
    const match = TURN_URL_PATTERN.exec(url);
    const port = match?.[3] ? Number(match[3]) : null;
    if (!match || (port !== null && (port < 1 || port > 65_535))) {
      throw new Error(`${name} contains an invalid TURN URL: ${url}`);
    }
  }
  return urls;
};

const assertTurn = env => {
  const serverUrls = splitCsv(env.SIGNAL_TURN_URLS);
  const serverSecret = env.SIGNAL_TURN_SHARED_SECRET;
  const browserUrls = splitCsv(env.VITE_BRIDGE_TURN_URLS);
  const browserUsername = env.VITE_BRIDGE_TURN_USERNAME?.trim();
  const browserCredential = env.VITE_BRIDGE_TURN_CREDENTIAL;

  const hasServerMode = serverUrls.length > 0 || Boolean(serverSecret);
  const hasBrowserMode = browserUrls.length > 0 || Boolean(browserUsername) || Boolean(browserCredential);

  if (hasServerMode && hasBrowserMode) {
    throw new Error("Configure either server-managed SIGNAL_TURN_* credentials or browser-visible VITE_BRIDGE_TURN_* credentials, not both");
  }

  if (hasServerMode) {
    const urls = assertTurnUrls(requireValue(env, "SIGNAL_TURN_URLS"), "SIGNAL_TURN_URLS");
    const secret = requireValue(env, "SIGNAL_TURN_SHARED_SECRET");
    if (secret.length < 32 || secret.length > 512 || /\s/.test(secret)) {
      throw new Error("SIGNAL_TURN_SHARED_SECRET must be 32-512 non-whitespace characters");
    }
    if (env.SIGNAL_TURN_CREDENTIAL_TTL_SECONDS !== undefined) {
      const raw = env.SIGNAL_TURN_CREDENTIAL_TTL_SECONDS.trim();
      if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 3600) {
        throw new Error("SIGNAL_TURN_CREDENTIAL_TTL_SECONDS must be an integer between 1 and 3600");
      }
    }
    return { mode: "server-ephemeral", count: urls.length };
  }

  if (hasBrowserMode) {
    const urls = assertTurnUrls(requireValue(env, "VITE_BRIDGE_TURN_URLS"), "VITE_BRIDGE_TURN_URLS");
    requireValue(env, "VITE_BRIDGE_TURN_USERNAME");
    requireValue(env, "VITE_BRIDGE_TURN_CREDENTIAL");
    if (env.BRIDGE_TURN_CREDENTIAL_EXPOSURE !== "browser-safe") {
      throw new Error("Set BRIDGE_TURN_CREDENTIAL_EXPOSURE=browser-safe only after confirming the configured TURN credential is safe to expose to every frontend user; VITE_* values are public browser configuration");
    }
    return { mode: "browser-static", count: urls.length };
  }

  throw new Error("Production requires TURN configuration through SIGNAL_TURN_* server-managed credentials or explicitly browser-safe VITE_BRIDGE_TURN_* credentials");
};

const assertCsp = (headersText, signalingUrl) => {
  const cspLine = headersText.split(/\r?\n/).map(line => line.trim()).find(line => /^Content-Security-Policy:/i.test(line));
  if (!cspLine) throw new Error("production headers must define Content-Security-Policy");
  const wssOrigin = `wss://${signalingUrl.host}`;
  if (!cspLine.includes(wssOrigin)) {
    throw new Error(`production CSP connect-src must include the exact signaling origin ${wssOrigin}`);
  }
  if (/(?:^|[ ;])wss:(?:[ ;]|$)/i.test(cspLine)) {
    throw new Error("production CSP must not retain the generic wss: connect-src allowance");
  }
};

export const verifyProductionFrontendArtifactConfig = ({ env = process.env, headersText }) => {
  const frontendOrigin = parseExactOrigin(requireValue(env, "BRIDGE_FRONTEND_ORIGIN"), "BRIDGE_FRONTEND_ORIGIN");
  const signalingUrl = parseSignalingUrl(requireValue(env, "VITE_SIGNALING_URL"));
  assertCsp(headersText, signalingUrl);
  return {
    frontendOrigin,
    signalingOrigin: `wss://${signalingUrl.host}`,
  };
};

export const verifyProductionDeploymentConfig = ({ env = process.env, headersText }) => {
  const frontend = verifyProductionFrontendArtifactConfig({ env, headersText });
  assertAllowedOrigins(requireValue(env, "SIGNAL_ALLOWED_ORIGINS"), frontend.frontendOrigin);
  const turn = assertTurn(env);
  return {
    ...frontend,
    turnMode: turn.mode,
    turnServerCount: turn.count,
  };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const headersPath = path.resolve(process.cwd(), "public/_headers");
    const result = verifyProductionDeploymentConfig({ env: process.env, headersText: fs.readFileSync(headersPath, "utf8") });
    console.log(`Production deployment configuration is consistent (${result.turnMode}, ${result.turnServerCount} TURN endpoint(s)).`);
  } catch (error) {
    console.error(`Production deployment configuration check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
