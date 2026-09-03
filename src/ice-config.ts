export type IceConfigurationEnv = {
  VITE_BRIDGE_STUN_URLS?: string;
  VITE_BRIDGE_TURN_URLS?: string;
  VITE_BRIDGE_TURN_USERNAME?: string;
  VITE_BRIDGE_TURN_CREDENTIAL?: string;
};

export type EphemeralTurnCredentials = {
  urls: readonly string[];
  username: string;
  credential: string;
  expiresAt: number;
};

const DEFAULT_STUN_URLS = ["stun:stun.l.google.com:19302"];
const TURN_URL_PATTERN = /^(turns?):(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?(?:\?transport=(udp|tcp))?$/i;

const parseUrls = (value?: string): string[] =>
  (value ?? "")
    .split(",")
    .map(url => url.trim())
    .filter(Boolean);

const assertScheme = (urls: readonly string[], allowed: readonly string[], label: string): void => {
  for (const url of urls) {
    const normalized = url.toLowerCase();
    if (!allowed.some(prefix => normalized.startsWith(prefix))) {
      throw new Error(`${label} URL must use ${allowed.join(" or ")}: ${url}`);
    }
  }
};

const assertTurnUrls = (urls: readonly string[]): void => {
  for (const url of urls) {
    const match = TURN_URL_PATTERN.exec(url);
    const port = match?.[3] ? Number(match[3]) : null;
    if (!match || (port !== null && (port < 1 || port > 65_535))) {
      throw new Error(`TURN URL is invalid: ${url}`);
    }
  }
};

const urlsFromServer = (server: RTCIceServer): string[] =>
  typeof server.urls === "string" ? [server.urls] : Array.from(server.urls ?? []);

export const hasTurnServer = (servers: readonly RTCIceServer[]): boolean =>
  servers.some(server => urlsFromServer(server).some(url => /^turns?:/i.test(url)));

const turnServerFromEphemeralCredentials = (
  credentials: EphemeralTurnCredentials,
  nowMs = Date.now(),
): RTCIceServer => {
  const urls = Array.from(credentials.urls);
  if (urls.length === 0) throw new Error("Signaling TURN credentials require at least one TURN URL");
  assertTurnUrls(urls);
  if (!credentials.username.trim() || !credentials.credential) {
    throw new Error("Signaling TURN credentials require a username and credential");
  }
  if (!Number.isSafeInteger(credentials.expiresAt) || credentials.expiresAt <= nowMs) {
    throw new Error("Signaling TURN credentials are expired or invalid");
  }
  return { urls, username: credentials.username, credential: credentials.credential };
};

export const iceServersFromEnvironment = (
  env: IceConfigurationEnv,
  ephemeralTurn?: EphemeralTurnCredentials,
  nowMs = Date.now(),
): RTCIceServer[] => {
  const configuredStun = parseUrls(env.VITE_BRIDGE_STUN_URLS);
  const stunUrls = configuredStun.length > 0 ? configuredStun : DEFAULT_STUN_URLS;
  assertScheme(stunUrls, ["stun:", "stuns:"], "STUN");

  const servers: RTCIceServer[] = [{ urls: stunUrls }];
  if (ephemeralTurn) {
    servers.push(turnServerFromEphemeralCredentials(ephemeralTurn, nowMs));
    return servers;
  }

  const turnUrls = parseUrls(env.VITE_BRIDGE_TURN_URLS);
  if (turnUrls.length === 0) return servers;

  assertTurnUrls(turnUrls);
  const username = env.VITE_BRIDGE_TURN_USERNAME?.trim();
  const credential = env.VITE_BRIDGE_TURN_CREDENTIAL;
  if (!username || !credential) {
    throw new Error("TURN URLs require both VITE_BRIDGE_TURN_USERNAME and VITE_BRIDGE_TURN_CREDENTIAL");
  }

  servers.push({ urls: turnUrls, username, credential });
  return servers;
};

export const configuredIceServers = (ephemeralTurn?: EphemeralTurnCredentials): RTCIceServer[] =>
  iceServersFromEnvironment(import.meta.env, ephemeralTurn);
