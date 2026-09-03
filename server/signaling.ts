import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { loadSignalingConfig } from "./config.js";
import { HeartbeatMonitor } from "./heartbeat.js";
import { SignalingMetrics, type ObservedRoute } from "./metrics.js";
import { SlidingWindowRateLimiter } from "./rate-limit.js";
import { allocateSessionId } from "./session-id.js";
import { closeQuietly, sendJsonQuietly, terminateQuietly } from "./socket-safety.js";
import { createTurnCredentialBundle } from "./turn-credentials.js";

const config = loadSignalingConfig();
const {
  port: PORT,
  sessionTtlMs: SESSION_TTL_MS,
  sessionCleanupIntervalMs: SESSION_CLEANUP_INTERVAL_MS,
  attachTimeoutMs: ATTACH_TIMEOUT_MS,
  heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
  shutdownGraceMs: SHUTDOWN_GRACE_MS,
  maxMessageBytes: MAX_MESSAGE_BYTES,
  maxSessions: MAX_SESSIONS,
  maxConnections: MAX_CONNECTIONS,
  connectionMessageLimit: CONNECTION_MESSAGE_LIMIT,
  createLimit: CREATE_LIMIT,
  joinLimit: JOIN_LIMIT,
  allowedOrigins: ALLOWED_ORIGINS,
  metricsBearerToken: METRICS_BEARER_TOKEN,
  turnUrls: TURN_URLS,
  turnSharedSecret: TURN_SHARED_SECRET,
  turnCredentialTtlSeconds: TURN_CREDENTIAL_TTL_SECONDS,
} = config;

type Role = "host" | "guest";

type Peer = {
  socket: WebSocket;
  role: Role;
};

type Session = {
  id: string;
  verifier: Buffer;
  createdAt: number;
  expiresAt: number;
  peers: Map<Role, Peer>;
};

// A session's expiresAt is renewed on legitimate signaling activity from an
// attached peer (see renewSessionExpiry) so that two actively-communicating
// peers aren't torn down purely because SESSION_TTL_MS elapsed on the wall
// clock while they were still negotiating or recovering a connection.
// Renewal is bounded, not unlimited: it can never push a session's lifetime
// past SESSION_MAX_LIFETIME_MS from creation, so an idle or abandoned
// session still expires. The cap scales with the configured SESSION_TTL_MS
// (a deployment that intentionally runs a longer or shorter base TTL gets a
// proportionally longer or shorter renewal window) but never exceeds the
// same 24h ceiling SESSION_TTL_MS itself is bounded to in config.ts.
const SESSION_MAX_LIFETIME_MULTIPLIER = 6;
const SESSION_MAX_LIFETIME_MS = Math.min(
  SESSION_TTL_MS * SESSION_MAX_LIFETIME_MULTIPLIER,
  24 * 60 * 60 * 1000,
);

const renewSessionExpiry = (session: Session): void => {
  const now = Date.now();
  const cap = session.createdAt + SESSION_MAX_LIFETIME_MS;
  session.expiresAt = Math.min(now + SESSION_TTL_MS, cap);
};

const sessions = new Map<string, Session>();
const metrics = new SignalingMetrics();
let activeConnections = 0;
let shuttingDown = false;
const connectionLimiter = new SlidingWindowRateLimiter(CONNECTION_MESSAGE_LIMIT, 60_000);
const createLimiter = new SlidingWindowRateLimiter(CREATE_LIMIT, 10 * 60_000);
const joinLimiter = new SlidingWindowRateLimiter(JOIN_LIMIT, 10 * 60_000);
const heartbeatMonitor = new HeartbeatMonitor<WebSocket>();

const parseVerifier = (value: unknown): Buffer | null => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) return null;
  return Buffer.from(value, "hex");
};

const parseSessionId = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^[0-9a-f]{12}$/i.test(value)) return null;
  return value.toLowerCase();
};

const parseObservedRoute = (value: unknown): ObservedRoute | null =>
  value === "direct" || value === "relayed" ? value : null;

const safeEqual = (a: Buffer, b: Buffer) =>
  a.length === b.length && timingSafeEqual(a, b);

const isMetricsAuthorized = (authorization: string | undefined): boolean => {
  if (!METRICS_BEARER_TOKEN) return true;
  if (!authorization?.startsWith("Bearer ")) return false;

  const supplied = authorization.slice("Bearer ".length);
  return safeEqual(Buffer.from(supplied), Buffer.from(METRICS_BEARER_TOKEN));
};

const send = (socket: WebSocket, payload: unknown) => {
  sendJsonQuietly(socket, payload);
};

const sendError = (socket: WebSocket, code: string, extra: Record<string, unknown> = {}) => {
  metrics.recordError(code);
  send(socket, { type: "error", code, ...extra });
};

const rejectRateLimited = (socket: WebSocket, retryAfterMs: number) => {
  sendError(socket, "rate-limited", { retryAfterMs });
};

const issueTurnCredentials = () => {
  if (!TURN_SHARED_SECRET || TURN_URLS.length === 0) return null;
  return createTurnCredentialBundle(
    TURN_URLS,
    TURN_SHARED_SECRET,
    TURN_CREDENTIAL_TTL_SECONDS,
  );
};

const closeSession = (sessionId: string, reason: string) => {
  const session = sessions.get(sessionId);
  if (!session) return;

  sessions.delete(sessionId);
  for (const peer of session.peers.values()) {
    metrics.removePeer(`${sessionId}:${peer.role}`);
    send(peer.socket, { type: "session-closed", reason });
    closeQuietly(peer.socket, 1000, reason);
  }
};

const cleanupExpiredState = () => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) closeSession(id, "expired");
  }

  connectionLimiter.prune(now);
  createLimiter.prune(now);
  joinLimiter.prune(now);
};

const cleanupTimer = setInterval(cleanupExpiredState, SESSION_CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === "/ready") {
    const ready = !shuttingDown;
    res.writeHead(ready ? 200 : 503, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(ready ? { ready: true } : { ready: false, reason: "shutting-down" }));
    return;
  }

  if (req.url === "/metrics") {
    if (!isMetricsAuthorized(req.headers.authorization)) {
      res.writeHead(401, {
        "content-type": "application/json",
        "cache-control": "no-store",
        "www-authenticate": "Bearer",
      });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(metrics.snapshot(sessions.size, activeConnections)));
    return;
  }

  res.writeHead(404, { "cache-control": "no-store" });
  res.end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
const heartbeatTimer = setInterval(() => {
  const terminated = heartbeatMonitor.sweep(wss.clients);
  for (let i = 0; i < terminated; i += 1) metrics.recordError("websocket-heartbeat-timeout");
}, HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref();

server.on("upgrade", (request, socket, head) => {
  if (shuttingDown) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  let pathname: string;
  try {
    pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  if (pathname !== "/signal") {
    socket.destroy();
    return;
  }

  if (ALLOWED_ORIGINS.length > 0) {
    const origin = request.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      socket.write(
        "HTTP/1.1 403 Forbidden\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n",
      );
      socket.destroy();
      return;
    }
  }

  if (activeConnections >= MAX_CONNECTIONS) {
    metrics.recordError("server-connection-capacity");
    socket.write(
      "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nCache-Control: no-store\r\nRetry-After: 1\r\nContent-Length: 0\r\n\r\n",
    );
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (websocket) => {
    wss.emit("connection", websocket, request);
  });
});

wss.on("connection", (socket, request) => {
  activeConnections += 1;
  heartbeatMonitor.track(socket);

  let attachedSessionId: string | null = null;
  let attachedRole: Role | null = null;

  const attachTimer = setTimeout(() => {
    if (attachedSessionId || attachedRole || socket.readyState !== socket.OPEN) return;
    sendError(socket, "attachment-timeout");
    closeQuietly(socket, 1008, "attachment-timeout");
  }, ATTACH_TIMEOUT_MS);
  attachTimer.unref();

  const sourceAddress = request.socket.remoteAddress ?? "unknown";

  socket.on("pong", () => {
    heartbeatMonitor.acknowledge(socket);
  });

  socket.on("error", () => {
    metrics.recordError("websocket-error");
  });

  socket.on("message", (raw) => {
    const connectionLimit = connectionLimiter.consume(socket, Date.now());
    if (!connectionLimit.allowed) {
      rejectRateLimited(socket, connectionLimit.retryAfterMs);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString()) as unknown;
    } catch {
      sendError(socket, "invalid-json");
      return;
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      sendError(socket, "invalid-message");
      return;
    }
    const message = parsed as Record<string, unknown>;

    if (message.type === "create-session") {
      if (attachedSessionId || attachedRole) {
        sendError(socket, "already-attached");
        return;
      }

      const verifier = parseVerifier(message.verifier);
      if (!verifier) {
        sendError(socket, "invalid-verifier");
        return;
      }

      const sourceLimit = createLimiter.consume(sourceAddress, Date.now());
      if (!sourceLimit.allowed) {
        rejectRateLimited(socket, sourceLimit.retryAfterMs);
        return;
      }

      if (sessions.size >= MAX_SESSIONS) {
        sendError(socket, "server-capacity");
        return;
      }

      const id = allocateSessionId(candidate => sessions.has(candidate));
      if (!id) {
        sendError(socket, "session-id-allocation-failed");
        return;
      }

      const now = Date.now();
      const session: Session = {
        id,
        verifier,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
        peers: new Map([["host", { socket, role: "host" }]]),
      };
      sessions.set(id, session);
      attachedSessionId = id;
      attachedRole = "host";
      clearTimeout(attachTimer);
      metrics.recordSessionCreated();
      send(socket, { type: "session-created", sessionId: id, expiresAt: session.expiresAt });
      return;
    }

    if (message.type === "join-session") {
      if (attachedSessionId || attachedRole) {
        sendError(socket, "already-attached");
        return;
      }

      const sessionId = parseSessionId(message.sessionId);
      const verifier = parseVerifier(message.verifier);
      if (!sessionId || !verifier) {
        sendError(socket, "invalid-join");
        return;
      }

      const sourceLimit = joinLimiter.consume(sourceAddress, Date.now());
      if (!sourceLimit.allowed) {
        rejectRateLimited(socket, sourceLimit.retryAfterMs);
        return;
      }

      const session = sessions.get(sessionId);
      if (!session || session.expiresAt <= Date.now()) {
        if (session) closeSession(sessionId, "expired");
        sendError(socket, "session-not-found");
        return;
      }

      if (!safeEqual(session.verifier, verifier)) {
        sendError(socket, "unauthorized");
        return;
      }

      if (session.peers.has("guest")) {
        sendError(socket, "session-full");
        return;
      }

      session.peers.set("guest", { socket, role: "guest" });
      attachedSessionId = sessionId;
      attachedRole = "guest";
      clearTimeout(attachTimer);
      metrics.recordSessionJoined();

      const turnCredentials = issueTurnCredentials();
      if (turnCredentials) {
        send(socket, { type: "turn-credentials", ...turnCredentials });
        send(session.peers.get("host")!.socket, { type: "turn-credentials", ...turnCredentials });
      }

      send(socket, { type: "session-joined", sessionId, expiresAt: session.expiresAt });
      send(session.peers.get("host")!.socket, { type: "peer-joined", role: "guest" });
      return;
    }

    if (message.type === "route-report") {
      if (!attachedSessionId || !attachedRole) {
        sendError(socket, "not-attached");
        return;
      }
      const route = parseObservedRoute(message.route);
      if (!route) {
        sendError(socket, "invalid-route-report");
        return;
      }
      const reportingSession = sessions.get(attachedSessionId);
      if (reportingSession) renewSessionExpiry(reportingSession);
      metrics.reportRoute(`${attachedSessionId}:${attachedRole}`, route);
      return;
    }

    if (message.type === "signal") {
      if (!attachedSessionId || !attachedRole) {
        sendError(socket, "not-attached");
        return;
      }
      const session = sessions.get(attachedSessionId);
      if (!session) {
        sendError(socket, "session-not-found");
        return;
      }
      renewSessionExpiry(session);
      const targetRole: Role = attachedRole === "host" ? "guest" : "host";
      const target = session.peers.get(targetRole);
      if (!target) {
        sendError(socket, "peer-not-ready");
        return;
      }
      send(target.socket, { type: "signal", from: attachedRole, payload: message.payload });
      return;
    }

    if (message.type === "close-session") {
      if (!attachedSessionId || attachedRole !== "host") {
        sendError(socket, "not-session-host");
        return;
      }
      closeSession(attachedSessionId, "host-closed");
      return;
    }

    sendError(socket, "unknown-message");
  });

  socket.on("close", () => {
    clearTimeout(attachTimer);
    heartbeatMonitor.forget(socket);
    activeConnections = Math.max(0, activeConnections - 1);
    connectionLimiter.delete(socket);
    if (!attachedSessionId || !attachedRole) return;
    metrics.removePeer(`${attachedSessionId}:${attachedRole}`);
    const session = sessions.get(attachedSessionId);
    if (!session) return;

    if (attachedRole === "host") {
      closeSession(attachedSessionId, "host-disconnected");
      return;
    }

    session.peers.delete(attachedRole);
    if (session.peers.size === 0) {
      sessions.delete(attachedSessionId);
    } else {
      for (const peer of session.peers.values()) send(peer.socket, { type: "peer-left", role: attachedRole });
    }
  });
});

wss.on("error", error => {
  metrics.recordError("websocket-server-error");
  console.error("Bridge signaling WebSocket server error", error);
});

server.on("error", error => {
  console.error("Bridge signaling HTTP server error", error);
});

server.listen(PORT, () => {
  console.log(`Bridge signaling listening on :${PORT}`);
});

const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(cleanupTimer);
  clearInterval(heartbeatTimer);

  let httpClosed = false;
  let websocketsClosed = false;
  let exited = false;
  let forceTimer: NodeJS.Timeout | undefined;

  const finish = () => {
    if (exited || !httpClosed || !websocketsClosed) return;
    exited = true;
    if (forceTimer) clearTimeout(forceTimer);
    process.exit(0);
  };

  server.close(() => {
    httpClosed = true;
    finish();
  });

  for (const sessionId of [...sessions.keys()]) closeSession(sessionId, "server-shutdown");
  for (const socket of wss.clients) {
    if (socket.readyState === socket.OPEN) closeQuietly(socket, 1001, "server-shutdown");
  }

  wss.close(() => {
    websocketsClosed = true;
    finish();
  });

  forceTimer = setTimeout(() => {
    if (exited) return;
    exited = true;
    for (const socket of wss.clients) terminateQuietly(socket);
    server.closeAllConnections();
    process.exit(0);
  }, SHUTDOWN_GRACE_MS);
  forceTimer.unref();
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);