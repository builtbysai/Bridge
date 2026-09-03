import { expect, test } from "@playwright/test";

const shouldRunTurn = process.env.BRIDGE_E2E_TURN === "1";
const TEST_SECRET_BYTE = 0x42;
const TEST_SECRET = "42".repeat(32);

test.skip(!shouldRunTurn, "TURN relay integration requires the local coturn CI fixture");

test("relay-only peers report relayed and transfer encrypted text", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();

  await hostContext.addInitScript(({ secretByte }) => {
    const originalGetRandomValues = crypto.getRandomValues.bind(crypto);
    let seededBridgeSecret = false;
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      value: (array: ArrayBufferView) => {
        if (!seededBridgeSecret && array instanceof Uint8Array && array.byteLength === 32) {
          array.fill(secretByte);
          seededBridgeSecret = true;
          return array;
        }
        return originalGetRandomValues(array);
      }
    });
    localStorage.setItem("bridge:relay-only", "1");
  }, { secretByte: TEST_SECRET_BYTE });

  await guestContext.addInitScript(() => {
    localStorage.setItem("bridge:relay-only", "1");
  });

  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await host.goto("/");
    const sessionCode = host.locator("#session-code strong");
    await expect(sessionCode).toHaveText(/^[A-F0-9]{12}$/);
    const sessionId = (await sessionCode.textContent())?.toLowerCase();
    if (!sessionId || !/^[a-f0-9]{12}$/.test(sessionId)) {
      throw new Error("Host did not expose a valid signaling session id");
    }

    await guest.goto(`/?session=${sessionId}&portal=receive#key=${TEST_SECRET}`);
    await expect(host.locator("#connection-title")).toHaveText("Device connected", { timeout: 20_000 });
    await expect(guest.locator("#connection-title")).toHaveText("Ready to send", { timeout: 20_000 });
    await expect(host.locator("#route-pill")).toContainText("Relayed", { timeout: 20_000 });
    await expect(guest.locator("#route-pill")).toContainText("Relayed", { timeout: 20_000 });

    guest.once("dialog", async dialog => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("relay-only verification");
    });
    await guest.getByRole("button", { name: "Send text" }).click();

    await expect(host.locator("#incoming-title")).toHaveText("Incoming text");
    await host.getByRole("button", { name: "Accept" }).click();
    await expect(host.locator("#received-content")).toHaveText("relay-only verification");
  } finally {
    await guestContext.close();
    await hostContext.close();
  }
});
