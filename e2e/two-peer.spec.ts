import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

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
  await guest.goto(`/?session=${sessionId}&receive=1#key=${TEST_SECRET}`);

  await expect(host.locator("#connection-title")).toHaveText("Device connected", { timeout: 20_000 });
  await expect(guest.locator("#connection-title")).toHaveText("Ready to send", { timeout: 20_000 });

  return { hostContext, guestContext, host, guest };
};

const closePair = async ({ hostContext, guestContext }: PairedPages) => {
  await guestContext.close();
  await hostContext.close();
};

const focusByTab = async (page: Page, target: Locator, maxTabs = 40) => {
  await page.locator("body").click({ position: { x: 1, y: 1 } });

  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate(element => element === document.activeElement)) {
      const indicator = await target.evaluate(element => {
        const styles = getComputedStyle(element);
        return {
          outlineStyle: styles.outlineStyle,
          outlineWidth: Number.parseFloat(styles.outlineWidth),
          boxShadow: styles.boxShadow
        };
      });
      expect(
        (indicator.outlineStyle !== "none" && indicator.outlineWidth > 0) || indicator.boxShadow !== "none",
        "Keyboard-focused dynamic control must expose a visible focus indicator"
      ).toBe(true);
      return;
    }
  }

  throw new Error("Dynamic control was not reachable with Tab within the expected focus cycle");
};

test("pairs a host with a Receive Portal and transfers encrypted text", async ({ browser }) => {
  const pair = await pairReceivePortal(browser);
  const { host, guest } = pair;

  try {
    guest.once("dialog", async dialog => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("Bridge end-to-end hello");
    });
    await guest.getByRole("button", { name: "Send text" }).click();

    await expect(host.locator("#incoming-title")).toHaveText("Incoming text");
    await host.getByRole("button", { name: "Accept" }).click();

    await expect(host.locator("#received-title")).toHaveText("Received text");
    await expect(host.locator("#received-content")).toHaveText("Bridge end-to-end hello");
  } finally {
    await closePair(pair);
  }
});

test("connected approval and active queue cancellation are keyboard reachable with visible focus", async ({ browser }) => {
  const pair = await pairReceivePortal(browser);
  const { host, guest } = pair;
  const file = {
    name: "bridge-keyboard-cancel.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(128 * 1024, 0x6b)
  };

  host.on("dialog", dialog => void dialog.dismiss());
  guest.on("dialog", dialog => void dialog.dismiss());

  try {
    guest.once("dialog", async dialog => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("Keyboard approval hello");
    });
    await guest.getByRole("button", { name: "Send text" }).click();
    await expect(host.locator("#incoming-title")).toHaveText("Incoming text");

    const accept = host.getByRole("button", { name: "Accept" });
    await focusByTab(host, accept);
    await host.keyboard.press("Enter");
    await expect(host.locator("#received-content")).toHaveText("Keyboard approval hello");

    await guest.locator("#file-input").setInputFiles(file);
    const row = guest.locator(".queue-item", { hasText: file.name });
    await expect(row).toHaveAttribute("data-status", "sending");
    await expect(host.locator("#incoming-detail")).toContainText(file.name);

    const cancel = row.getByRole("button", { name: "Cancel" });
    await focusByTab(guest, cancel);
    await guest.keyboard.press("Enter");
    await expect(row).toHaveAttribute("data-status", "cancelled");
    await expect(guest.locator("#queue-summary")).toHaveText("Queue complete");
  } finally {
    await closePair(pair);
  }
});

test("request fulfillment and declined-request recovery are keyboard reachable", async ({ browser }) => {
  const pair = await pairReceivePortal(browser);
  const { host, guest } = pair;

  try {
    const request = host.getByRole("button", { name: "Request something" });
    await focusByTab(host, request);
    host.once("dialog", async dialog => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("text");
    });
    await host.keyboard.press("Enter");

    await expect(guest.locator("#request-title")).toHaveText("Incoming request");
    await expect(guest.locator("#request-detail")).toContainText("asking for text");
    const provide = guest.getByRole("button", { name: "Provide" });
    await focusByTab(guest, provide);
    guest.once("dialog", async dialog => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("Keyboard requested text");
    });
    await guest.keyboard.press("Enter");

    await expect(host.locator("#incoming-title")).toHaveText("Incoming text");
    const accept = host.getByRole("button", { name: "Accept" });
    await focusByTab(host, accept);
    await host.keyboard.press("Enter");
    await expect(host.locator("#received-content")).toHaveText("Keyboard requested text");

    await focusByTab(host, request);
    host.once("dialog", async dialog => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("link");
    });
    await host.keyboard.press("Enter");
    await expect(guest.locator("#request-detail")).toContainText("asking for a link");

    const decline = guest.getByRole("button", { name: "Decline" });
    await focusByTab(guest, decline);
    const declineAlert = host.waitForEvent("dialog");
    await guest.keyboard.press("Enter");
    const dialog = await declineAlert;
    expect(dialog.type()).toBe("alert");
    expect(dialog.message()).toContain("Request declined");
    await dialog.accept();

    await expect(host.locator("#connection-title")).toHaveText("Device connected");
    await expect(request).toBeEnabled();
    await focusByTab(host, request);
  } finally {
    await closePair(pair);
  }
});

test("serializes two files through approval, progress, integrity completion, and downloads", async ({ browser }) => {
  const pair = await pairReceivePortal(browser);
  const { host, guest } = pair;
  const firstFile = {
    name: "bridge-first.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("first bridge payload\n".repeat(2048))
  };
  const secondFile = {
    name: "bridge-second.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(Array.from({ length: 32 * 1024 }, (_, index) => index % 251))
  };

  try {
    await guest.locator("#file-input").setInputFiles([firstFile, secondFile]);

    const firstRow = guest.locator(".queue-item", { hasText: firstFile.name });
    const secondRow = guest.locator(".queue-item", { hasText: secondFile.name });
    await expect(firstRow).toHaveAttribute("data-status", "sending");
    await expect(secondRow).toHaveAttribute("data-status", "queued");

    await expect(host.locator("#incoming-detail")).toContainText(firstFile.name);
    const firstDownloadPromise = host.waitForEvent("download");
    await host.getByRole("button", { name: "Receive in browser" }).click();
    const firstDownload = await firstDownloadPromise;
    expect(firstDownload.suggestedFilename()).toBe(firstFile.name);
    const firstPath = await firstDownload.path();
    if (!firstPath) throw new Error("First completed transfer did not create a browser download");
    expect(await readFile(firstPath)).toEqual(firstFile.buffer);
    await expect(firstRow).toHaveAttribute("data-status", "completed");
    await expect(firstRow.locator("progress")).toHaveAttribute("value", "100");

    await expect(secondRow).toHaveAttribute("data-status", "sending");
    await expect(host.locator("#incoming-detail")).toContainText(secondFile.name);
    const secondDownloadPromise = host.waitForEvent("download");
    await host.getByRole("button", { name: "Receive in browser" }).click();
    const secondDownload = await secondDownloadPromise;
    expect(secondDownload.suggestedFilename()).toBe(secondFile.name);
    const secondPath = await secondDownload.path();
    if (!secondPath) throw new Error("Second completed transfer did not create a browser download");
    expect(await readFile(secondPath)).toEqual(secondFile.buffer);
    await expect(secondRow).toHaveAttribute("data-status", "completed");
    await expect(secondRow.locator("progress")).toHaveAttribute("value", "100");
    await expect(guest.locator("#queue-summary")).toHaveText("Queue complete");
  } finally {
    await closePair(pair);
  }
});

test("cancels an active file while it is waiting for recipient approval", async ({ browser }) => {
  const pair = await pairReceivePortal(browser);
  const { host, guest } = pair;
  const file = {
    name: "bridge-cancel.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(256 * 1024, 0x63)
  };

  host.on("dialog", dialog => void dialog.dismiss());
  guest.on("dialog", dialog => void dialog.dismiss());

  try {
    await guest.locator("#file-input").setInputFiles(file);
    const row = guest.locator(".queue-item", { hasText: file.name });

    await expect(row).toHaveAttribute("data-status", "sending");
    await expect(host.locator("#incoming-detail")).toContainText(file.name);
    await row.getByRole("button", { name: "Cancel" }).click();

    await expect(row).toHaveAttribute("data-status", "cancelled");
    await expect(guest.locator("#queue-summary")).toHaveText("Queue complete");
  } finally {
    await closePair(pair);
  }
});
