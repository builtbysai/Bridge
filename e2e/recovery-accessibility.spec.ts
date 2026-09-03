import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const TEST_SECRET_BYTE = 0x42;
const TEST_SECRET = "42".repeat(32);

interface PairedPages {
  hostContext: BrowserContext;
  guestContext: BrowserContext;
  host: Page;
  guest: Page;
}

const pairReceivePortal = async (browser: Browser): Promise<PairedPages> => {
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

    const originalCreateDataChannel = RTCPeerConnection.prototype.createDataChannel;
    RTCPeerConnection.prototype.createDataChannel = function (...args) {
      const channel = originalCreateDataChannel.apply(this, args);
      const testWindow = window as typeof window & { __bridgeTestChannels?: RTCDataChannel[] };
      (testWindow.__bridgeTestChannels ??= []).push(channel);
      return channel;
    };
  }, { secretByte: TEST_SECRET_BYTE });

  const host = await hostContext.newPage();
  await host.goto("/");

  const sessionCode = host.locator("#session-code strong");
  await expect(sessionCode).toHaveText(/^[A-F0-9]{12}$/);
  const sessionId = (await sessionCode.textContent())?.toLowerCase();
  if (!sessionId || !/^[a-f0-9]{12}$/.test(sessionId)) {
    throw new Error("Host did not expose a valid signaling session id");
  }

  const guest = await guestContext.newPage();
  await guest.goto(`/?session=${sessionId}&receive=1#key=${TEST_SECRET}`);

  await expect(host.locator("#connection-title")).toHaveText("Device connected", { timeout: 20_000 });
  await expect(guest.locator("#connection-title")).toHaveText("Ready to send", { timeout: 20_000 });

  return { hostContext, guestContext, host, guest };
};

const closePair = async ({ hostContext, guestContext }: PairedPages) => {
  await guestContext.close();
  await hostContext.close();
};

test("recovers from an authenticated data-channel interruption and restores usable keyboard actions", async ({ browser }) => {
  const pair = await pairReceivePortal(browser);
  const { host, guest } = pair;

  try {
    const request = host.getByRole("button", { name: "Request something" });
    await request.focus();
    await expect(request).toBeFocused();

    const initialChannelCount = await host.evaluate(() => {
      const testWindow = window as typeof window & { __bridgeTestChannels?: RTCDataChannel[] };
      return testWindow.__bridgeTestChannels?.length ?? 0;
    });
    expect(initialChannelCount).toBeGreaterThanOrEqual(1);

    await host.evaluate(() => {
      const testWindow = window as typeof window & { __bridgeTestChannels?: RTCDataChannel[] };
      const channel = testWindow.__bridgeTestChannels?.at(-1);
      if (!channel) throw new Error("Bridge test channel was not captured");
      channel.close();
    });

    await expect(host.locator("#connection-title")).toHaveText("Device found — connecting", { timeout: 10_000 });
    await expect(host.locator("#connection-detail")).toContainText(/recovery|negotiating/i);

    await expect(host.locator("#connection-title")).toHaveText("Device connected", { timeout: 20_000 });
    await expect(guest.locator("#connection-title")).toHaveText("Ready to send", { timeout: 20_000 });
    await expect(request).toBeEnabled();

    const recoveredChannelCount = await host.evaluate(() => {
      const testWindow = window as typeof window & { __bridgeTestChannels?: RTCDataChannel[] };
      return testWindow.__bridgeTestChannels?.length ?? 0;
    });
    expect(recoveredChannelCount).toBeGreaterThan(initialChannelCount);

    await request.focus();
    await expect(request).toBeFocused();
    const focusIndicator = await request.evaluate(element => {
      const styles = getComputedStyle(element);
      return {
        outlineStyle: styles.outlineStyle,
        outlineWidth: Number.parseFloat(styles.outlineWidth),
        boxShadow: styles.boxShadow
      };
    });
    expect(
      (focusIndicator.outlineStyle !== "none" && focusIndicator.outlineWidth > 0)
        || focusIndicator.boxShadow !== "none"
    ).toBe(true);

    guest.once("dialog", async dialog => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("Recovered channel hello");
    });
    await guest.getByRole("button", { name: "Send text" }).click();
    await expect(host.locator("#incoming-title")).toHaveText("Incoming text");
    await host.getByRole("button", { name: "Accept" }).click();
    await expect(host.locator("#received-content")).toHaveText("Recovered channel hello");
  } finally {
    await closePair(pair);
  }
});
