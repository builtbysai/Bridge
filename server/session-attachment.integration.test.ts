import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";

const VERIFIER = "33".repeat(32);

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
      // Process may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for signaling test server");
};

const connect = async (url: string): Promise<WebSocket> => new Promise((resolve, reject) => {
  const socket = new WebSocket(url);
  socket.once("open", () => resolve(socket));
  socket.once("error", reject);
});

const nextJson = async (socket: WebSocket): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    cleanup();
    reject(new Error("Timed out waiting for signaling message"));
  }, 2_000);
  const cleanup = () => {
    clearTimeout(timer);
    socket.off("message", onMessage);
    socket.off("error", onError);
  };
  const onMessage = (data: RawData) => {
    cleanup();
    resolve(JSON.parse(data.toString()) as Record<string, unknown>);
  };
  const onError = (error: Error) => {
    cleanup();
    reject(error);
  };
  socket.once("message", onMessage);
  socket.once("error", onError);
});

const waitForClose = async (socket: WebSocket): Promise<void> => new Promise((resolve, reject) => {
  if (socket.readyState === socket.CLOSED) {
    resolve();
    return;
  }

  const timer = setTimeout(() => {
    cleanup();
    reject(new Error("Timed out waiting for signaling socket close"));
  }, 2_000);
  const cleanup = () => {
    clearTimeout(timer);
    socket.off("close", onClose);
    socket.off("error", onError);
  };
  const onClose = () => {
    cleanup();
    resolve();
  };
  const onError = (error: Error) => {
    cleanup();
    reject(error);
  };
  socket.once("close", onClose);
  socket.once("error", onError);
});

describe("signaling session attachment", () => {
  let port = 0;
  let signalUrl = "";
  let childProcess: ChildProcess | null = null;

  beforeAll(async () => {
    port = await reservePort();
    signalUrl = `ws://127.0.0.1:${port}/signal`;
    childProcess = spawn(process.execPath, ["--import", "tsx", "server/signaling.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        SESSION_TTL_MS: "5000",
        SESSION_CLEANUP_INTERVAL_MS: "100",
        SIGNAL_SHUTDOWN_GRACE_MS: "1000"
      },
      stdio: "pipe"
    });
    await waitForHealth(port);
  }, 10_000);

  afterAll(() => {
    childProcess?.kill("SIGTERM");
  });

  it("rejects a second create-session on an already attached socket without leaking another session", async () => {
    const host = await connect(signalUrl);
    try {
      const created = nextJson(host);
      host.send(JSON.stringify({ type: "create-session", verifier: VERIFIER }));
      await expect(created).resolves.toMatchObject({ type: "session-created" });

      const rejected = nextJson(host);
      host.send(JSON.stringify({ type: "create-session", verifier: VERIFIER }));
      await expect(rejected).resolves.toMatchObject({ type: "error", code: "already-attached" });

      const metricsResponse = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(metricsResponse.ok).toBe(true);
      const metrics = await metricsResponse.json() as { activeSessions: number; signalingErrors: Record<string, number> };
      expect(metrics.activeSessions).toBe(1);
      expect(metrics.signalingErrors["already-attached"]).toBeGreaterThanOrEqual(1);
    } finally {
      host.close();
    }
  });

  it("rejects create/join reattachment after a guest has joined", async () => {
    const host = await connect(signalUrl);
    const guest = await connect(signalUrl);
    try {
      const createdPromise = nextJson(host);
      host.send(JSON.stringify({ type: "create-session", verifier: VERIFIER }));
      const created = await createdPromise;

      const joinedPromise = nextJson(guest);
      guest.send(JSON.stringify({ type: "join-session", sessionId: created.sessionId, verifier: VERIFIER }));
      await expect(joinedPromise).resolves.toMatchObject({ type: "session-joined" });
      await expect(nextJson(host)).resolves.toMatchObject({ type: "peer-joined" });

      const hostRejected = nextJson(host);
      host.send(JSON.stringify({ type: "join-session", sessionId: created.sessionId, verifier: VERIFIER }));
      await expect(hostRejected).resolves.toMatchObject({ type: "error", code: "already-attached" });

      const guestRejected = nextJson(guest);
      guest.send(JSON.stringify({ type: "create-session", verifier: VERIFIER }));
      await expect(guestRejected).resolves.toMatchObject({ type: "error", code: "already-attached" });
    } finally {
      guest.close();
      host.close();
    }
  });

  it("closes the complete session when the host disconnects unexpectedly", async () => {
    const host = await connect(signalUrl);
    const guest = await connect(signalUrl);
    try {
      const createdPromise = nextJson(host);
      host.send(JSON.stringify({ type: "create-session", verifier: VERIFIER }));
      const created = await createdPromise;

      const joinedPromise = nextJson(guest);
      guest.send(JSON.stringify({ type: "join-session", sessionId: created.sessionId, verifier: VERIFIER }));
      await expect(joinedPromise).resolves.toMatchObject({ type: "session-joined" });
      await expect(nextJson(host)).resolves.toMatchObject({ type: "peer-joined" });

      const guestClosedMessage = nextJson(guest);
      const guestClosedSocket = waitForClose(guest);
      host.close();

      await expect(guestClosedMessage).resolves.toMatchObject({
        type: "session-closed",
        reason: "host-disconnected",
      });
      await guestClosedSocket;

      const metricsResponse = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(metricsResponse.ok).toBe(true);
      const metrics = await metricsResponse.json() as { activeSessions: number };
      expect(metrics.activeSessions).toBe(0);
    } finally {
      guest.close();
      host.close();
    }
  });
});
