import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";

const TEST_ORIGIN = "https://bridge.test";
const TEST_VERIFIER = "ab".repeat(32);
const ATTACH_TIMEOUT_MS = 120;

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
  socket.once("open", () => resolve(socket));
  socket.once("error", reject);
});

const nextJson = async (socket: WebSocket): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Timed out waiting for signaling message")), 2_000);
  socket.once("message", (data: RawData) => {
    clearTimeout(timer);
    resolve(JSON.parse(data.toString()) as Record<string, unknown>);
  });
  socket.once("error", error => {
    clearTimeout(timer);
    reject(error);
  });
});

const waitForClose = async (socket: WebSocket): Promise<{ code: number; reason: string }> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for signaling close")), 2_000);
    socket.once("close", (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    socket.once("error", error => {
      clearTimeout(timer);
      reject(error);
    });
  });

describe("signaling attachment timeout", () => {
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
        SIGNAL_ATTACH_TIMEOUT_MS: String(ATTACH_TIMEOUT_MS),
      },
      stdio: "pipe",
    });
    await waitForHealth(port);
  }, 10_000);

  afterAll(() => {
    childProcess?.kill("SIGTERM");
  });

  it("closes a socket that never creates or joins a session", async () => {
    const socket = await connect(signalUrl);
    const error = nextJson(socket);
    const closed = waitForClose(socket);

    await expect(error).resolves.toMatchObject({ type: "error", code: "attachment-timeout" });
    await expect(closed).resolves.toEqual({ code: 1008, reason: "attachment-timeout" });
  });

  it("does not let invalid traffic extend the absolute attachment deadline", async () => {
    const socket = await connect(signalUrl);
    try {
      const invalid = nextJson(socket);
      socket.send("null");
      await expect(invalid).resolves.toMatchObject({ type: "error", code: "invalid-message" });

      const timeout = nextJson(socket);
      const closed = waitForClose(socket);
      await expect(timeout).resolves.toMatchObject({ type: "error", code: "attachment-timeout" });
      await expect(closed).resolves.toEqual({ code: 1008, reason: "attachment-timeout" });
    } finally {
      if (socket.readyState === WebSocket.OPEN) socket.close();
    }
  });

  it("clears the deadline after a successful session attachment", async () => {
    const socket = await connect(signalUrl);
    try {
      const created = nextJson(socket);
      socket.send(JSON.stringify({ type: "create-session", verifier: TEST_VERIFIER }));
      await expect(created).resolves.toMatchObject({ type: "session-created" });

      await new Promise(resolve => setTimeout(resolve, ATTACH_TIMEOUT_MS * 2));
      expect(socket.readyState).toBe(WebSocket.OPEN);

      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
    } finally {
      socket.close();
    }
  });
});
