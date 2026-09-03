import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";

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

describe("signaling message shape validation", () => {
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
      },
      stdio: "pipe",
    });
    await waitForHealth(port);
  }, 10_000);

  afterAll(() => {
    childProcess?.kill("SIGTERM");
  });

  it.each(["null", "[]", '"signal"', "42", "true"])(
    "rejects valid JSON that is not a message object: %s",
    async rawMessage => {
      const socket = await connect(signalUrl);
      try {
        const response = nextJson(socket);
        socket.send(rawMessage);
        await expect(response).resolves.toMatchObject({ type: "error", code: "invalid-message" });

        const health = await fetch(`http://127.0.0.1:${port}/health`);
        expect(health.status).toBe(200);
        await expect(health.json()).resolves.toEqual({ ok: true });
      } finally {
        socket.close();
      }
    },
  );
});
