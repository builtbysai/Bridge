import QRCode from "qrcode";
import { expect, test } from "@playwright/test";

// Feeds the host's real QR code to the guest as a fake camera, then scans it
// the way a user would: open Bridge, tap "Scan to join", point at the code.
test("scanning the host QR joins the session", async ({ browser }) => {
  const hostContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const host = await hostContext.newPage();
  await host.goto("/");
  await host.locator("#invite-copy").click();
  const pairingUrl = await host.evaluate(() => navigator.clipboard.readText());
  expect(pairingUrl).toMatch(/session=[0-9a-f]{12}/i);

  const qrDataUrl = await QRCode.toDataURL(pairingUrl, { width: 400, margin: 1 });

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto("/");
  // Fake camera: a canvas streaming the host's QR code.
  await guest.evaluate((dataUrl) => {
    const img = new Image();
    return new Promise<void>((resolve) => {
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext("2d")!;
        const draw = () => {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          const s = 400;
          ctx.drawImage(img, (canvas.width - s) / 2, (canvas.height - s) / 2, s, s);
          requestAnimationFrame(draw);
        };
        draw();
        const stream = canvas.captureStream(15);
        Object.defineProperty(navigator, "mediaDevices", {
          value: { getUserMedia: async () => stream },
          configurable: true,
        });
        resolve();
      };
      img.src = dataUrl;
    });
  }, qrDataUrl);

  await guest.locator("#invite-scan").click();
  await expect(guest.locator(".scan-overlay")).toBeVisible();
  // A successful scan navigates to the invite URL, which starts the guest flow.
  await expect(guest).toHaveURL(/session=[0-9a-f]{12}/i, { timeout: 15_000 });
  await expect(guest.locator("#st")).toHaveText("LIVE", { timeout: 25_000 });

  await guestContext.close();
  await hostContext.close();
});

test("cancelling the scanner leaves the session alone", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.locator("#invite-scan").click();
  await expect(page.locator(".scan-overlay")).toBeVisible();
  await page.locator(".scan-cancel").click();
  await expect(page.locator(".scan-overlay")).toHaveCount(0);
  await expect(page).not.toHaveURL(/session=/);
  await context.close();
});

test("denied camera access is reported, not silent", async ({ browser }) => {
  const context = await browser.newContext({ permissions: [] });
  const page = await context.newPage();
  await page.goto("/");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        },
      },
      configurable: true,
    });
  });
  await page.locator("#invite-scan").click();
  await expect(page.locator(".scan-overlay")).toBeVisible();
  await expect(page.locator("#scan-error")).toContainText("denied", { timeout: 10_000 });
  await context.close();
});
