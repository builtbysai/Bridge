import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

const TEST_ORIGIN = "https://bridge.test";
const CONNECTION_LIMIT = 2;

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

const expectCapacityRejection = async (url: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Origin: TEST_ORIGIN } });
    const timer = setTimeout(() => reject(new Error("Timed out waiting for capacity rejection")), 2_000);
    socket.once("open", () => {
      clearTimeout(timer);
      socket.close();
      reject(new Error("Connection unexpectedly opened above signaling capacity"));
    });
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      expect(response.statusCode).toBe(503);
      expect(response.headers["retry-after"]).toBe("1");
      response.resume();
      resolve();
    });
    socket.once("error", () => {
      // ws may emit an error after the HTTP rejection; unexpected-response is the assertion boundary.
    });
  });
};

const waitForConnections = async (port: number, expected: number): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/metrics`);
    const metrics = await response.json() as { connections?: number };
    if (metrics.connections === expected) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for connections=${expected}`);
};

describe("signaling connection capacity", () => {
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
        SIGNAL_ATTACH_TIMEOUT_MS: "5000",
        MAX_SIGNAL_CONNECTIONS: String(CONNECTION_LIMIT),
      },
      stdio: "pipe",
    });
    await waitForHealth(port);
  }, 10_000);

  afterAll(() => {
    childProcess?.kill("SIGTERM");
  });

  it("rejects upgrades above capacity and admits a new connection after capacity is released", async () => {
    const first = await connect(signalUrl);
    const second = await connect(signalUrl);
    try {
      await waitForConnections(port, CONNECTION_LIMIT);
      await expectCapacityRejection(signalUrl);

      const metricsResponse = await fetch(`http://127.0.0.1:${port}/metrics`);
      const metrics = await metricsResponse.json() as {
        connections?: number;
        signalingErrors?: Record<string, number>;
      };
      expect(metrics.connections).toBe(CONNECTION_LIMIT);
      expect(metrics.signalingErrors?.["server-connection-capacity"]).toBeGreaterThanOrEqual(1);

      first.close();
      await waitForConnections(port, CONNECTION_LIMIT - 1);

      const replacement = await connect(signalUrl);
      replacement.close();
    } finally {
      if (first.readyState === WebSocket.OPEN) first.close();
      if (second.readyState === WebSocket.OPEN) second.close();
    }
  });
});
