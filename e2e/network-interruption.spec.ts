import { Buffer } from "node:buffer";
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
  await guest.goto(`/?session=${sessionId}&portal=receive#key=${TEST_SECRET}`);

  await expect(host.locator("#connection-title")).toHaveText("Device connected", { timeout: 20_000 });
  await expect(guest.locator("#connection-title")).toHaveText("Ready to send", { timeout: 20_000 });

  return { hostContext, guestContext, host, guest };
};

const closePair = async ({ hostContext, guestContext }: PairedPages) => {
  await guestContext.close();
  await hostContext.close();
};

test("pauses transfer controls and announces browser network interruption", async ({ browser }) => {
  const pair = await pairReceivePortal(browser);
  const { hostContext, guestContext, host, guest } = pair;

  try {
    const sendFiles = guest.getByRole("button", { name: "Send files" });
    const sendText = guest.getByRole("button", { name: "Send text" });
    const dropZone = guest.locator("#drop-zone");
    const networkStatus = guest.locator("#network-status");

    await expect(sendFiles).toBeEnabled();
    await expect(sendText).toBeEnabled();
    await expect(dropZone).toHaveAttribute("aria-disabled", "false");

    await guestContext.setOffline(true);

    await expect(networkStatus).toContainText("Network connection lost");
    await expect(networkStatus).toHaveAttribute("role", "status");
    await expect(networkStatus).toHaveAttribute("aria-live", "polite");
    await expect(sendFiles).toBeDisabled();
    await expect(sendText).toBeDisabled();
    await expect(dropZone).toHaveAttribute("aria-disabled", "true");

    await guest.evaluate(() => {
      const dynamicAction = document.createElement("button");
      dynamicAction.type = "button";
      dynamicAction.dataset.action = "test-dynamic-transfer";
      dynamicAction.textContent = "Dynamic transfer action";
      document.body.append(dynamicAction);
    });
    const dynamicAction = guest.getByRole("button", { name: "Dynamic transfer action" });
    await expect(dynamicAction).toBeDisabled();

    await guestContext.setOffline(false);

    await expect(networkStatus).toContainText("Network connection restored");
    await expect(sendFiles).toBeEnabled();
    await expect(sendText).toBeEnabled();
    await expect(dropZone).toHaveAttribute("aria-disabled", "false");
    await expect(dynamicAction).toBeEnabled();
    await dynamicAction.evaluate(element => element.remove());

    const chooserPromise = guest.waitForEvent("filechooser");
    await sendFiles.click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "offline-approval.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("pending approval should pause safely")
    });

    const receiveInBrowser = host.getByRole("button", { name: "Receive in browser" });
    const decline = host.getByRole("button", { name: "Decline" });
    await expect(host.locator("#incoming-panel")).toBeVisible();
    await expect(receiveInBrowser).toBeEnabled();
    await expect(decline).toBeEnabled();

    await hostContext.setOffline(true);

    await expect(host.locator("#network-status")).toContainText("Network connection lost");
    await expect(receiveInBrowser).toBeDisabled();
    await expect(decline).toBeDisabled();

    await hostContext.setOffline(false);

    await expect(host.locator("#network-status")).toContainText("Network connection restored");
    await expect(receiveInBrowser).toBeEnabled();
    await expect(decline).toBeEnabled();
    await decline.click();
  } finally {
    await hostContext.setOffline(false).catch(() => undefined);
    await guestContext.setOffline(false).catch(() => undefined);
    await closePair(pair);
  }
});
