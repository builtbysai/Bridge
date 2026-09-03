import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const TEST_SECRET_BYTE = 0x44;
const TEST_SECRET = "44".repeat(32);

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

const dismissKeyboardPromptAndExpectFocusRestored = async (page: Page, selector: string) => {
  const trigger = page.locator(selector);
  await trigger.focus();
  await expect(trigger).toBeFocused();

  const dialogPromise = page.waitForEvent("dialog");
  await trigger.press("Enter");
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("prompt");
  await dialog.dismiss();

  await expect(trigger).toBeFocused();
};

test("native prompt cancellation restores keyboard focus and keeps both peers usable", async ({ browser }) => {
  const pair = await pairReceivePortal(browser);
  const { host, guest } = pair;

  try {
    await dismissKeyboardPromptAndExpectFocusRestored(host, '[data-action="request"]');
    await expect(host.locator("#connection-title")).toHaveText("Device connected");
    await expect(host.locator('[data-action="request"]')).toBeEnabled();

    await dismissKeyboardPromptAndExpectFocusRestored(guest, '[data-action="send-text"]');
    await expect(guest.locator("#connection-title")).toHaveText("Ready to send");
    await expect(guest.locator('[data-action="send-text"]')).toBeEnabled();
  } finally {
    await closePair(pair);
  }
});

test("keyboard file picker selection restores focus and enqueues the selected file", async ({ browser }) => {
  const pair = await pairReceivePortal(browser);
  const { guest } = pair;

  try {
    const trigger = guest.locator('[data-action="send"]');
    await trigger.focus();
    await expect(trigger).toBeFocused();

    const chooserPromise = guest.waitForEvent("filechooser");
    await trigger.press("Enter");
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "keyboard-picker.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Bridge keyboard picker focus regression")
    });

    await expect(trigger).toBeFocused();
    const queueItem = guest.locator('.queue-item:has-text("keyboard-picker.txt")');
    await expect(queueItem).toBeVisible();
    await expect(queueItem).toHaveAttribute("data-status", /queued|sending/);

    const cancel = queueItem.locator("[data-queue-cancel]");
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(queueItem).toHaveAttribute("data-status", "cancelled");
  } finally {
    await closePair(pair);
  }
});
