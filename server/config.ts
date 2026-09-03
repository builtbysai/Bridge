export type SignalingConfig = {
  port: number;
  sessionTtlMs: number;
  sessionCleanupIntervalMs: number;
  attachTimeoutMs: number;
  heartbeatIntervalMs: number;
  shutdownGraceMs: number;
  maxMessageBytes: number;
  maxSessions: number;
  maxConnections: number;
  connectionMessageLimit: number;
  createLimit: number;
  joinLimit: number;
  allowedOrigins: string[];
  metricsBearerToken: string | null;
  turnUrls: string[];
  turnSharedSecret: string | null;
  turnCredentialTtlSeconds: number;
};

const DEFAULTS: Omit<SignalingConfig, "allowedOrigins" | "metricsBearerToken" | "turnUrls" | "turnSharedSecret"> = {
  port: 8787,
  sessionTtlMs: 10 * 60 * 1000,
  sessionCleanupIntervalMs: 30_000,
  attachTimeoutMs: 30_000,
  heartbeatIntervalMs: 30_000,
  shutdownGraceMs: 5_000,
  maxMessageBytes: 256 * 1024,
  maxSessions: 10_000,
  maxConnections: 20_000,
  connectionMessageLimit: 120,
  createLimit: 20,
  joinLimit: 60,
  turnCredentialTtlSeconds: 15 * 60,
};

const MAXIMUMS = {
  sessionTtlMs: 24 * 60 * 60 * 1000,
  sessionCleanupIntervalMs: 5 * 60 * 1000,
  heartbeatIntervalMs: 5 * 60 * 1000,
  maxMessageBytes: 1024 * 1024,
  maxSessions: 100_000,
  maxConnections: 200_000,
  connectionMessageLimit: 10_000,
  createLimit: 1_000,
  joinLimit: 5_000,
  turnCredentialTtlSeconds: 60 * 60,
} as const;

const TURN_URL_PATTERN = /^(turns?):(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?(?:\?transport=(udp|tcp))?$/i;

type Env = Record<string, string | undefined>;

const readPositiveInteger = (
  env: Env,
  name: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number => {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be a positive integer.`);
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}.`);
  }
  return value;
};

const isLoopbackHostname = (hostname: string): boolean => {
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

const readAllowedOrigins = (env: Env): string[] => {
  const raw = env.SIGNAL_ALLOWED_ORIGINS;
  if (raw === undefined || raw.trim() === "") return [];

  const origins = new Set<string>();
  for (const entry of raw.split(",")) {
    const candidate = entry.trim();
    if (!candidate) {
      throw new Error("SIGNAL_ALLOWED_ORIGINS must be a comma-separated list of origins.");
    }

    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error(`SIGNAL_ALLOWED_ORIGINS contains an invalid origin: ${candidate}`);
    }

    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.origin === "null"
    ) {
      throw new Error(`SIGNAL_ALLOWED_ORIGINS contains an invalid origin: ${candidate}`);
    }

    origins.add(url.origin);
  }

  return [...origins];
};

const readMetricsBearerToken = (env: Env): string | null => {
  const raw = env.SIGNAL_METRICS_BEARER_TOKEN;
  if (raw === undefined || raw === "") return null;

  if (raw.length < 32 || raw.length > 512 || /\s/.test(raw)) {
    throw new Error(
      "SIGNAL_METRICS_BEARER_TOKEN must be 32-512 non-whitespace characters when configured.",
    );
  }

  return raw;
};

const readTurnUrls = (env: Env): string[] => {
  const raw = env.SIGNAL_TURN_URLS;
  if (raw === undefined || raw.trim() === "") return [];

  const urls = raw.split(",").map(value => value.trim());
  if (urls.some(value => !value)) {
    throw new Error("SIGNAL_TURN_URLS must be a comma-separated list of TURN URLs.");
  }

  for (const url of urls) {
    const match = TURN_URL_PATTERN.exec(url);
    const port = match?.[3] ? Number(match[3]) : null;
    if (!match || (port !== null && (port < 1 || port > 65_535))) {
      throw new Error(`SIGNAL_TURN_URLS contains an invalid TURN URL: ${url}`);
    }
  }

  return [...new Set(urls)];
};

const readTurnSharedSecret = (env: Env): string | null => {
  const raw = env.SIGNAL_TURN_SHARED_SECRET;
  if (raw === undefined || raw === "") return null;
  if (raw.length < 32 || raw.length > 512 || /\s/.test(raw)) {
    throw new Error("SIGNAL_TURN_SHARED_SECRET must be 32-512 non-whitespace characters when configured.");
  }
  return raw;
};

export const loadSignalingConfig = (env: Env = process.env): SignalingConfig => {
  const allowedOrigins = readAllowedOrigins(env);
  if (env.NODE_ENV === "production") {
    if (allowedOrigins.length === 0) {
      throw new Error("SIGNAL_ALLOWED_ORIGINS is required when NODE_ENV=production.");
    }
    if (allowedOrigins.some((origin) => !origin.startsWith("https://"))) {
      throw new Error("SIGNAL_ALLOWED_ORIGINS must contain only HTTPS origins when NODE_ENV=production.");
    }
    if (allowedOrigins.some((origin) => isLoopbackHostname(new URL(origin).hostname))) {
      throw new Error("SIGNAL_ALLOWED_ORIGINS must not contain loopback origins when NODE_ENV=production.");
    }
  }

  const turnUrls = readTurnUrls(env);
  const turnSharedSecret = readTurnSharedSecret(env);
  if ((turnUrls.length > 0) !== Boolean(turnSharedSecret)) {
    throw new Error("SIGNAL_TURN_URLS and SIGNAL_TURN_SHARED_SECRET must be configured together.");
  }

  const sessionTtlMs = readPositiveInteger(
    env,
    "SESSION_TTL_MS",
    DEFAULTS.sessionTtlMs,
    MAXIMUMS.sessionTtlMs,
  );
  const turnCredentialTtlSeconds = readPositiveInteger(
    env,
    "SIGNAL_TURN_CREDENTIAL_TTL_SECONDS",
    DEFAULTS.turnCredentialTtlSeconds,
    MAXIMUMS.turnCredentialTtlSeconds,
  );

  if (turnUrls.length > 0 && turnCredentialTtlSeconds * 1000 < sessionTtlMs) {
    throw new Error(
      "SIGNAL_TURN_CREDENTIAL_TTL_SECONDS must be at least the configured SESSION_TTL_MS when TURN is enabled so relay recovery remains available for the full session lifetime.",
    );
  }

  return {
    port: readPositiveInteger(env, "PORT", DEFAULTS.port, 65_535),
    sessionTtlMs,
    sessionCleanupIntervalMs: readPositiveInteger(
      env,
      "SESSION_CLEANUP_INTERVAL_MS",
      DEFAULTS.sessionCleanupIntervalMs,
      MAXIMUMS.sessionCleanupIntervalMs,
    ),
    attachTimeoutMs: readPositiveInteger(
      env,
      "SIGNAL_ATTACH_TIMEOUT_MS",
      DEFAULTS.attachTimeoutMs,
      5 * 60_000,
    ),
    heartbeatIntervalMs: readPositiveInteger(
      env,
      "SIGNAL_HEARTBEAT_INTERVAL_MS",
      DEFAULTS.heartbeatIntervalMs,
      MAXIMUMS.heartbeatIntervalMs,
    ),
    shutdownGraceMs: readPositiveInteger(
      env,
      "SIGNAL_SHUTDOWN_GRACE_MS",
      DEFAULTS.shutdownGraceMs,
      60_000,
    ),
    maxMessageBytes: readPositiveInteger(
      env,
      "MAX_SIGNAL_MESSAGE_BYTES",
      DEFAULTS.maxMessageBytes,
      MAXIMUMS.maxMessageBytes,
    ),
    maxSessions: readPositiveInteger(
      env,
      "MAX_SIGNAL_SESSIONS",
      DEFAULTS.maxSessions,
      MAXIMUMS.maxSessions,
    ),
    maxConnections: readPositiveInteger(
      env,
      "MAX_SIGNAL_CONNECTIONS",
      DEFAULTS.maxConnections,
      MAXIMUMS.maxConnections,
    ),
    connectionMessageLimit: readPositiveInteger(
      env,
      "SIGNAL_MESSAGES_PER_MINUTE",
      DEFAULTS.connectionMessageLimit,
      MAXIMUMS.connectionMessageLimit,
    ),
    createLimit: readPositiveInteger(
      env,
      "SIGNAL_CREATES_PER_10_MINUTES",
      DEFAULTS.createLimit,
      MAXIMUMS.createLimit,
    ),
    joinLimit: readPositiveInteger(
      env,
      "SIGNAL_JOINS_PER_10_MINUTES",
      DEFAULTS.joinLimit,
      MAXIMUMS.joinLimit,
    ),
    allowedOrigins,
    metricsBearerToken: readMetricsBearerToken(env),
    turnUrls,
    turnSharedSecret,
    turnCredentialTtlSeconds,
  };
};