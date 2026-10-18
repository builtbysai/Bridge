import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { pair } from "./helpers";

test("a file is approved, transferred with an accessible progress bar, and downloads intact", async ({ browser }) => {
  const { host, guest, close } = await pair(browser);
  const payload = Buffer.alloc(3 * 1024 * 1024, "bridge-");

  await guest.locator("#file-input").setInputFiles({ name: "big.bin", mimeType: "application/octet-stream", buffer: payload });
  await expect(host.locator("#incoming-detail")).toContainText("big.bin");

  const download = host.waitForEvent("download");
  await host.locator("#incoming-memory").click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("big.bin");
  expect((await readFile(await file.path())).equals(payload)).toBe(true);

  await expect(host.locator("#xferbar")).toHaveAttribute("aria-valuenow", "100");
  await expect(host.locator("#transfer-status")).toHaveText(/100% complete/);
  await expect(guest.locator(".qrow[data-status='completed']")).toHaveCount(1);
  await close();
});

test("declining an incoming file is reported to the sender", async ({ browser }) => {
  const { host, guest, close } = await pair(browser);
  await guest.locator("#file-input").setInputFiles({ name: "no.txt", mimeType: "text/plain", buffer: Buffer.from("nope") });
  await host.locator("#incoming-reject").click();
  await expect(guest.locator(".qrow[data-status='failed'], .qrow[data-status='cancelled']")).toHaveCount(1);
  await close();
});

test("controls pause while the browser is offline and resume when it returns", async ({ browser }) => {
  const { host, close, hostContext } = await pair(browser);
  const send = host.locator('[data-action="send"]');
  await expect(send).toBeEnabled();
  await hostContext.setOffline(true);
  await expect(send).toBeDisabled();
  await expect(host.locator("#toast")).toContainText("offline");
  await hostContext.setOffline(false);
  await expect(send).toBeEnabled();
  await close();
});
