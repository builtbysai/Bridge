import { spawn, type ChildProcess } from "node:child_process";
import { connect as connectTcp, createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";

const GOOD_VERIFIER = "11".repeat(32);
const BAD_VERIFIER = "22".repeat(32);
const TEST_ORIGIN = "https://bridge.test";

const reservePort = async (): Promise<number> => new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      reject(new Error("Unable to reserve signaling test port"));
      return;
    }
    const { port } = address;
    server.close(error => error ? reject(error) : resolve(port));
  });
});

const waitForHealth = async (port: number): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Server process may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for signaling test server");
};

const connect = async (url: string): Promise<WebSocket> => new Promise((resolve, reject) => {
  const socket = new WebSocket(url, { headers: { Origin: TEST_ORIGIN } });
  const cleanup = () => {
    socket.off("open", onOpen);
    socket.off("error", onError);
  };
  const onOpen = () => {
    cleanup();
    resolve(socket);
  };
  const onError = (error: Error) => {
    cleanup();
    reject(error);
  };
  socket.once("open", onOpen);
  socket.once("error", onError);
});

// `WebSocket#terminate()` called while the socket is still CONNECTING (as it
// always is here: we're aborting a handshake the server rejected or that
// timed out) makes `ws` schedule an async "error" event on the socket for
// the aborted handshake. If nothing is listening by then, Node treats that
// as an unhandled "error" event and throws it, failing the whole test run.
// Attach a permanent no-op listener before terminating so that expected
// abort error is swallowed instead.
const terminateQuietly = (socket: WebSocket): void => {
  socket.on("error", () => { /* expected: terminate() aborts the in-flight handshake */ });
  socket.terminate();
};

const expectUpgradeRejected = async (url: string, origin?: string): Promise<number> => new Promise((resolve, reject) => {
  const options = origin ? { headers: { Origin: origin } } : undefined;
  const socket = new WebSocket(url, options);
  const timer = setTimeout(() => {
    cleanup();
    terminateQuietly(socket);
    reject(new Error("Timed out waiting for rejected WebSocket upgrade"));
  }, 2_000);
  const cleanup = () => {
    clearTimeout(timer);
    socket.off("unexpected-response", onUnexpectedResponse);
    socket.off("open", onOpen);
    socket.off("error", onError);
  };
  const onUnexpectedResponse = (_request: unknown, response: { statusCode?: number }) => {
    cleanup();
    terminateQuietly(socket);
    resolve(response.statusCode ?? 0);
  };
  const onOpen = () => {
    cleanup();
    socket.close();
    reject(new Error("Rejected WebSocket origin unexpectedly connected"));
  };
  const onError = (error: Error) => {
    cleanup();
    reject(error);
  };
  socket.once("unexpected-response", onUnexpectedResponse);
  socket.once("open", onOpen);
  socket.once("error", onError);
});

const sendRawUpgrade = async (port: number, hostHeader: string): Promise<string> => new Promise((resolve, reject) => {
  const socket = connectTcp({ host: "127.0.0.1", port });
  let response = "";
  const timer = setTimeout(() => {
    socket.destroy();
    reject(new Error("Timed out waiting for raw upgrade response"));
  }, 2_000);

  socket.setEncoding("utf8");
  socket.on("connect", () => {
    socket.write(
      `GET /signal HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
    );
  });
  socket.on("data", chunk => {
    response += chunk;
  });
  socket.on("end", () => {
    clearTimeout(timer);
    resolve(response);
  });
  socket.on("error", error => {
    clearTimeout(timer);
    reject(error);
  });
});

// The signaling server frequently answers two different sockets in the same
// synchronous handler (e.g. joining a session sends "session-joined" to the
// guest and "peer-joined" to the host back-to-back). Test bodies here
// naturally read those responses one after another too ("await the guest's
// message, then await the host's"), which means the host's message can
// physically arrive well before the test gets around to asking for it. A
// bare `socket.once("message", ...)` registered only at that later point
// would have missed it entirely, since nothing was listening when it
// arrived, causing sporadic timeouts or reading the *next* unrelated
// message. JsonMessageReader instead subscribes for a socket's whole
// lifetime the first time it's asked for, buffering every message into a
// queue so a later `next()` call can never lose one that arrived early.
class JsonMessageReader {
  private readonly queue: Record<string, unknown>[] = [];
  private readonly waiters: Array<{
    resolve: (message: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(socket: WebSocket) {
    socket.on("message", (data: RawData) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter.resolve(message);
      } else {
        this.queue.push(message);
      }
    });
    socket.on("error", (error: Error) => {
      const waiter = this.waiters.shift();
      waiter?.reject(error);
    });
  }

  async next(timeoutMs = 2_000): Promise<Record<string, unknown>> {
    const queued = this.queue.shift();
    if (queued) return queued;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex(waiter => waiter.resolve === resolveAndClear);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("Timed out waiting for signaling message"));
      }, timeoutMs);
      const resolveAndClear = (message: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(message);
      };
      const rejectAndClear = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      this.waiters.push({ resolve: resolveAndClear, reject: rejectAndClear });
    });
  }
}

const messageReaders = new WeakMap<WebSocket, JsonMessageReader>();

const nextJson = async (socket: WebSocket, timeoutMs = 2_000): Promise<Record<string, unknown>> => {
  let reader = messageReaders.get(socket);
  if (!reader) {
    reader = new JsonMessageReader(socket);
    messageReaders.set(socket, reader);
  }
  return reader.next(timeoutMs);
};

describe("signaling server integration", () => {
  let port = 0;
  let childProcess: ChildProcess | null = null;
  let signalUrl = "";

  beforeAll(async () => {
    port = await reservePort();
    signalUrl = `ws://127.0.0.1:${port}/signal`;
    childProcess = spawn(process.execPath, ["--import", "tsx", "server/signaling.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        // A short, shared SESSION_TTL_MS here previously raced every test in
        // this describe block against idle-session expiry: the very first
        // request a freshly spawned tsx child process handles can be slow
        // (JIT/module-transform cold start), which could burn through a
        // sub-second TTL before a session's create -> join round trip even
        // finished, flakily delivering "session-closed" (expired) instead
        // of "peer-joined". These tests don't exercise expiry, so give
        // sessions a generous lifetime here and exercise the short-TTL
        // expiry behavior in its own isolated server below instead.
        SESSION_TTL_MS: "60000",
        SESSION_CLEANUP_INTERVAL_MS: "20",
        SIGNAL_SHUTDOWN_GRACE_MS: "1000",
        SIGNAL_ALLOWED_ORIGINS: TEST_ORIGIN,
      },
      stdio: "pipe"
    });
    await waitForHealth(port);
  }, 10_000);

  afterAll(() => {
    childProcess?.kill("SIGTERM");
  });

  it("exposes separate liveness and readiness endpoints", async () => {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true });

    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({ ready: true });
  });

  it("does not trust or parse Host as the WebSocket upgrade URL base", async () => {
    const response = await sendRawUpgrade(port, "[invalid-host");
    expect(response).toContain("403 Forbidden");

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
  });

  it("rejects missing or untrusted browser origins before WebSocket admission", async () => {
    await expect(expectUpgradeRejected(signalUrl)).resolves.toBe(403);
    await expect(expectUpgradeRejected(signalUrl, "https://evil.example")).resolves.toBe(403);
    const allowed = await connect(signalUrl);
    allowed.close();
  });

  it("rejects a join with the wrong pairing verifier", async () => {
    const host = await connect(signalUrl);
    const guest = await connect(signalUrl);
    try {
      const createdPromise = nextJson(host);
      host.send(JSON.stringify({ type: "create-session", verifier: GOOD_VERIFIER }));
      const created = await createdPromise;
      expect(created.type).toBe("session-created");
      expect(created.sessionId).toMatch(/^[a-f0-9]{12}$/);

      const rejectedPromise = nextJson(guest);
      guest.send(JSON.stringify({
        type: "join-session",
        sessionId: created.sessionId,
        verifier: BAD_VERIFIER
      }));
      await expect(rejectedPromise).resolves.toMatchObject({ type: "error", code: "unauthorized" });
    } finally {
      guest.close();
      host.close();
    }
  });

  it("exposes aggregate signaling errors and direct/relay observations", async () => {
    const host = await connect(signalUrl);
    const guest = await connect(signalUrl);
    try {
      const createdPromise = nextJson(host);
      host.send(JSON.stringify({ type: "create-session", verifier: GOOD_VERIFIER }));
      const created = await createdPromise;

      const joinedPromise = nextJson(guest);
      guest.send(JSON.stringify({
        type: "join-session",
        sessionId: created.sessionId,
        verifier: GOOD_VERIFIER
      }));
      await expect(joinedPromise).resolves.toMatchObject({ type: "session-joined" });
      await expect(nextJson(host)).resolves.toMatchObject({ type: "peer-joined" });

      host.send(JSON.stringify({ type: "route-report", route: "direct" }));
      guest.send(JSON.stringify({ type: "route-report", route: "relayed" }));
      guest.send(JSON.stringify({ type: "route-report", route: "invalid" }));
      await expect(nextJson(guest)).resolves.toMatchObject({ type: "error", code: "invalid-route-report" });

      const response = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(response.ok).toBe(true);
      const metrics = await response.json() as {
        signalingErrors: Record<string, number>;
        routes: { direct: number; relayed: number; observedPeers: number; relayRatio: number | null };
      };
      expect(metrics.signalingErrors.unauthorized).toBeGreaterThanOrEqual(1);
      expect(metrics.signalingErrors["invalid-route-report"]).toBeGreaterThanOrEqual(1);
      expect(metrics.routes).toEqual({ direct: 1, relayed: 1, observedPeers: 2, relayRatio: 0.5 });
      expect(JSON.stringify(metrics)).not.toContain(String(created.sessionId));
    } finally {
      guest.close();
      host.close();
    }
  });

  it("lets the host close an attached session explicitly", async () => {
    const host = await connect(signalUrl);
    const guest = await connect(signalUrl);
    try {
      const createdPromise = nextJson(host);
      host.send(JSON.stringify({ type: "create-session", verifier: GOOD_VERIFIER }));
      const created = await createdPromise;

      const joinedPromise = nextJson(guest);
      guest.send(JSON.stringify({
        type: "join-session",
        sessionId: created.sessionId,
        verifier: GOOD_VERIFIER
      }));
      await expect(joinedPromise).resolves.toMatchObject({ type: "session-joined" });
      await expect(nextJson(host)).resolves.toMatchObject({ type: "peer-joined" });

      const hostClosed = nextJson(host);
      const guestClosed = nextJson(guest);
      host.send(JSON.stringify({ type: "close-session" }));
      await expect(hostClosed).resolves.toMatchObject({ type: "session-closed", reason: "host-closed" });
      await expect(guestClosed).resolves.toMatchObject({ type: "session-closed", reason: "host-closed" });
    } finally {
      guest.close();
      host.close();
    }
  });

});

// Idle-session expiry needs a much shorter SESSION_TTL_MS than any other
// test here should have to share, so it gets its own server instance: a
// short TTL is only safe to race against when nothing else in the same
// process is also creating sessions and depending on them staying alive.
describe("signaling server integration - idle session expiry", () => {
  let expiryPort = 0;
  let expiryChildProcess: ChildProcess | null = null;
  let expirySignalUrl = "";

  beforeAll(async () => {
    expiryPort = await reservePort();
    expirySignalUrl = `ws://127.0.0.1:${expiryPort}/signal`;
    expiryChildProcess = spawn(process.execPath, ["--import", "tsx", "server/signaling.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(expiryPort),
        SESSION_TTL_MS: "500",
        SESSION_CLEANUP_INTERVAL_MS: "20",
        SIGNAL_SHUTDOWN_GRACE_MS: "1000",
        SIGNAL_ALLOWED_ORIGINS: TEST_ORIGIN,
      },
      stdio: "pipe"
    });
    await waitForHealth(expiryPort);
  }, 10_000);

  afterAll(() => {
    expiryChildProcess?.kill("SIGTERM");
  });

  it("expires and cleans up idle sessions", async () => {
    const host = await connect(expirySignalUrl);
    try {
      const createdPromise = nextJson(host);
      host.send(JSON.stringify({ type: "create-session", verifier: GOOD_VERIFIER }));
      await expect(createdPromise).resolves.toMatchObject({ type: "session-created" });
      await expect(nextJson(host, 5_000)).resolves.toMatchObject({ type: "session-closed", reason: "expired" });
    } finally {
      host.close();
    }
  }, 10_000);
});
