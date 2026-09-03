import { expect, test } from "@playwright/test";

const RELAY_ONLY_STORAGE_KEY = "bridge.privacy.relayOnly";

test("relay-only preference stages disruptive changes until explicitly applied", async ({ page }) => {
  await page.addInitScript(storageKey => window.localStorage.removeItem(storageKey), RELAY_ONLY_STORAGE_KEY);
  await page.goto("/");

  const toggle = page.getByRole("checkbox", { name: "Relay-only privacy mode" });
  const apply = page.getByRole("button", { name: "Apply & restart" });
  const cancel = page.getByRole("button", { name: "Cancel" });
  const status = page.locator("#relay-only-status");

  await expect(toggle).not.toBeChecked();
  await expect(apply).toBeHidden();

  await toggle.check();

  await expect(apply).toBeVisible();
  await expect(cancel).toBeVisible();
  await expect(status).toContainText("Relay-only mode will be enabled after you apply and restart");
  await expect.poll(() => page.evaluate(storageKey => window.localStorage.getItem(storageKey), RELAY_ONLY_STORAGE_KEY)).toBeNull();

  await cancel.click();

  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeFocused();
  await expect(apply).toBeHidden();
  await expect(status).toBeEmpty();
});
