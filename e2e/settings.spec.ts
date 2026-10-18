import { expect, test } from "@playwright/test";
import { pair } from "./helpers";

test("device name is saved, persists across reloads and is shown to the other device", async ({ browser }) => {
  const { host, guest, close } = await pair(browser);
  await host.locator("#settings-toggle").click();
  await host.locator("#device-name-input").fill("Studio Mac");
  await host.locator("#device-name-input").press("Enter");
  await expect(host.locator("#peerline-local")).toHaveText("STUDIO MAC");
  await expect(guest.locator("#peerline-peer")).toHaveText("STUDIO MAC");

  await host.reload();
  await host.locator("#settings-toggle").click();
  await expect(host.locator("#device-name-input")).toHaveValue("Studio Mac");

  await host.keyboard.press("Escape");
  await expect(host.locator("#settings-panel")).toBeHidden();
  await expect(host.locator("#settings-toggle")).toBeFocused();
  await close();
});

test("relay-only privacy mode persists and a host can restart to apply it", async ({ page }) => {
  await page.goto("/");
  await page.locator("#settings-toggle").click();
  const toggle = page.locator("#relay-only-toggle");
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.locator("#relay-only-status")).toContainText("next session");
  await expect(page.locator("#relay-only-restart")).toBeVisible();

  await page.reload();
  await page.locator("#settings-toggle").click();
  await expect(page.locator("#relay-only-toggle")).toBeChecked();
  await page.locator("#relay-only-toggle").uncheck();
  await expect(page.locator("#relay-only-status")).toContainText("Direct connections");
});
