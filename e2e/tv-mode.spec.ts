import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { live } from "./helpers";

// Pairs a TV-display host with a phone-style guest: the TV shows the invite,
// the guest joins from the copied link, exactly like scanning the QR.
const pairWithTv = async (browser: Browser) => {
  const hostContext = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 1920, height: 1080 }
  });
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await host.goto("/?tv=1");
  await host.locator("#invite-copy").click();
  await guest.goto(await host.evaluate(() => navigator.clipboard.readText()));
  await live(host);
  await live(guest);
  return {
    host,
    guest,
    close: async () => {
      await guestContext.close();
      await hostContext.close();
    }
  };
};

test("TV display mode is on the page and says files save automatically", async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const host = await hostContext.newPage();
  await host.goto("/?tv=1");
  await expect(host.locator("body")).toHaveClass(/tv/);
  await expect(host.locator("#tv-note-invite")).toBeVisible();
  await expect(host.locator("#tv-note-invite")).toContainText("SAVED AUTOMATICALLY");
  await expect(host.locator("#ask")).toHaveText("Point your phone camera at the code.");
  await expect(host.locator("#tv-note-link")).toBeHidden();
  await hostContext.close();
});

test("a file sent to the TV is received and downloaded with no prompt", async ({ browser }) => {
  const { host, guest, close } = await pairWithTv(browser);
  await expect(host.locator("#tv-note-link")).toBeVisible();
  const payload = Buffer.alloc(1024 * 1024, "tv-");

  const download = host.waitForEvent("download");
  await guest.locator("#file-input").setInputFiles({ name: "movie.mp4", mimeType: "video/mp4", buffer: payload });
  const file = await download;

  // Nobody touched the TV: the decision panel never appeared.
  await expect(host.locator("#incoming-panel")).toBeHidden();
  expect(file.suggestedFilename()).toBe("movie.mp4");
  expect((await readFile(await file.path())).equals(payload)).toBe(true);
  await expect(host.locator("#xferbar")).toHaveAttribute("aria-valuenow", "100");
  await expect(guest.locator(".qrow[data-status='completed']")).toHaveCount(1);
  await close();
});

test("text sent to the TV lands in the Received panel with no prompt", async ({ browser }) => {
  const { host, guest, close } = await pairWithTv(browser);
  await guest.locator('[data-action="send-text"]').click();
  await guest.locator("#compose-input").fill("meet at eight");
  await guest.locator("#compose-submit").click();
  await expect(host.locator("#incoming-panel")).toBeHidden();
  await expect(host.locator("#received-title")).toHaveText("Received text");
  await expect(host.locator("#received-content")).toHaveText("meet at eight");
  await close();
});
