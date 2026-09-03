import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";

const TEST_ORIGIN = "https://bridge.test";
const VERIFIER = "11".repeat(32);
const TURN_SECRET = "turn-integration-secret-".padEnd(32, "x");
const TURN_URLS = [
  "turn:turn.example.test:3478?transport=udp",
  "turns:turn.example.test:5349?transport=tcp",
];

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
    server.close(error => error ? reject(error) : resolve(address.port));
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

// The signaling server can send more than one message to the same socket
// back-to-back and fully synchronously (e.g. "turn-credentials" immediately
// followed by "session-joined"/"peer-joined" once a guest joins). Over a
// loopback connection both frequently arrive in a single underlying read,
// so `ws` emits both "message" events synchronously in the same tick. A
// helper built on `socket.once("message", ...)` only captures the first of
// those and silently drops the rest, since nothing is listening by the time
// the second event fires. JsonMessageReader instead subscribes once, for
// the socket's whole lifetime, and buffers every message into a queue so
// callers can pull messages one at a time without ever missing one that
// arrived early.
class JsonMessageReader {
  private readonly queue: Record<string, unknown>[] = [];
  private readonly waiters: Array<{
    resolve: (message: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(private readonly socket: WebSocket) {
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

  async expectNoMessage(durationMs = 100): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, durationMs));
    if (this.queue.length > 0) {
      throw new Error(`Unexpected signaling message before authenticated join: ${JSON.stringify(this.queue[0])}`);
    }
  }
}

const connect = async (url: string): Promise<WebSocket> => new Promise((resolve, reject) => {
  const socket = new WebSocket(url, { headers: { Origin: TEST_ORIGIN } });
  socket.once("open", () => resolve(socket));
  socket.once("error", reject);
});

describe("signaling-issued TURN credentials", () => {
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
        SIGNAL_ALLOWED_ORIGINS: TEST_ORIGIN,
        SIGNAL_TURN_URLS: TURN_URLS.join(","),
        SIGNAL_TURN_SHARED_SECRET: TURN_SECRET,
        // The signaling config requires the TURN credential TTL to be at
        // least as long as the session TTL (relay recovery must remain
        // available for the whole session lifetime), so this test's short
        // 60s credential TTL needs an equally short session TTL.
        SESSION_TTL_MS: "60000",
        SIGNAL_TURN_CREDENTIAL_TTL_SECONDS: "60",
        SIGNAL_SHUTDOWN_GRACE_MS: "1000",
      },
      stdio: "pipe",
    });
    await waitForHealth(port);
  }, 10_000);

  afterAll(() => {
    childProcess?.kill("SIGTERM");
  });

  it("mints temporary credentials only after a verified guest joins and sends them before negotiation", async () => {
    const host = await connect(signalUrl);
    const guest = await connect(signalUrl);
    const hostMessages = new JsonMessageReader(host);
    const guestMessages = new JsonMessageReader(guest);

    try {
      host.send(JSON.stringify({ type: "create-session", verifier: VERIFIER }));
      const created = await hostMessages.next();
      expect(created.type).toBe("session-created");
      const sessionId = created.sessionId;
      expect(typeof sessionId).toBe("string");

      await hostMessages.expectNoMessage();

      guest.send(JSON.stringify({ type: "join-session", sessionId, verifier: VERIFIER }));

      const guestTurn = await guestMessages.next();
      const hostTurn = await hostMessages.next();
      expect(guestTurn.type).toBe("turn-credentials");
      expect(hostTurn.type).toBe("turn-credentials");
      expect(guestTurn).toEqual(hostTurn);
      expect(guestTurn.urls).toEqual(TURN_URLS);
      expect(typeof guestTurn.username).toBe("string");
      expect(typeof guestTurn.credential).toBe("string");
      expect(typeof guestTurn.expiresAt).toBe("number");

      const username = guestTurn.username as string;
      const expectedCredential = createHmac("sha1", TURN_SECRET)
        .update(username, "utf8")
        .digest("base64");
      expect(guestTurn.credential).toBe(expectedCredential);
      expect(Number(guestTurn.expiresAt)).toBeGreaterThan(Date.now());

      expect((await guestMessages.next()).type).toBe("session-joined");
      expect((await hostMessages.next()).type).toBe("peer-joined");
    } finally {
      host.close();
      guest.close();
    }
  });
});
