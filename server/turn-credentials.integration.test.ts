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

const connect = async (url: string): Promise<WebSocket> => new Promise((resolve, reject) => {
  const socket = new WebSocket(url, { headers: { Origin: TEST_ORIGIN } });
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

const expectNoMessage = async (socket: WebSocket, durationMs = 100): Promise<void> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    cleanup();
    resolve();
  }, durationMs);
  const cleanup = () => {
    clearTimeout(timer);
    socket.off("message", onMessage);
    socket.off("error", onError);
  };
  const onMessage = (data: RawData) => {
    cleanup();
    reject(new Error(`Unexpected signaling message before authenticated join: ${data.toString()}`));
  };
  const onError = (error: Error) => {
    cleanup();
    reject(error);
  };
  socket.once("message", onMessage);
  socket.once("error", onError);
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

    try {
      host.send(JSON.stringify({ type: "create-session", verifier: VERIFIER }));
      const created = await nextJson(host);
      expect(created.type).toBe("session-created");
      const sessionId = created.sessionId;
      expect(typeof sessionId).toBe("string");

      await expectNoMessage(host);

      guest.send(JSON.stringify({ type: "join-session", sessionId, verifier: VERIFIER }));

      const guestTurn = await nextJson(guest);
      const hostTurn = await nextJson(host);
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

      expect((await nextJson(guest)).type).toBe("session-joined");
      expect((await nextJson(host)).type).toBe("peer-joined");
    } finally {
      host.close();
      guest.close();
    }
  });
});
