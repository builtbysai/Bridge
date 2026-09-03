import { expect, test } from "@playwright/test";

const TEST_SECRET = "42".repeat(32);

test("removes consumed pairing secret from the visible URL and current history entry", async ({ page }) => {
  await page.goto(`/?session=deadbeefcafe&portal=receive#key=${TEST_SECRET}`);

  await expect.poll(() => page.url()).not.toContain("#key=");
  expect(page.url()).toBe("http://127.0.0.1:4173/?session=deadbeefcafe&portal=receive");

  const historyLength = await page.evaluate(() => history.length);
  await page.reload();
  expect(page.url()).not.toContain(TEST_SECRET);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
});
