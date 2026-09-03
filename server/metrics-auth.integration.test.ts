import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_TOKEN = "test-metrics-token-0123456789abcdef";

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

describe("signaling metrics authentication", () => {
  let port = 0;
  let childProcess: ChildProcess | null = null;

  beforeAll(async () => {
    port = await reservePort();
    childProcess = spawn(process.execPath, ["--import", "tsx", "server/signaling.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        SIGNAL_METRICS_BEARER_TOKEN: TEST_TOKEN,
      },
      stdio: "pipe",
    });
    await waitForHealth(port);
  }, 10_000);

  afterAll(() => {
    childProcess?.kill("SIGTERM");
  });

  it("leaves health and readiness probes unauthenticated", async () => {
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(200);
  });

  it("rejects missing and incorrect metrics credentials without returning metrics", async () => {
    const missing = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe("Bearer");
    await expect(missing.json()).resolves.toEqual({ error: "unauthorized" });

    const wrong = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { authorization: `Bearer ${"x".repeat(TEST_TOKEN.length)}` },
    });
    expect(wrong.status).toBe(401);
    await expect(wrong.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("returns aggregate metrics only for the configured bearer token", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/metrics`, {
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json() as Record<string, unknown>;
    expect(body).toHaveProperty("uptimeSeconds");
    expect(body).toHaveProperty("sessions");
    expect(body).toHaveProperty("routes");
    expect(JSON.stringify(body)).not.toContain(TEST_TOKEN);
  });
});
