import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const MISSING_SESSION = "deadbeefcafe";
const TEST_SECRET = "42".repeat(32);

const seriousOrCritical = new Set(["serious", "critical"]);

test("missing-session failure remains readable, bounded, and inaccessible actions stay disabled", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`/?session=${MISSING_SESSION}&portal=receive#key=${TEST_SECRET}`);

  await expect(page.locator("#connection-title")).toHaveText("Connection problem", { timeout: 10_000 });
  await expect(page.locator("#connection-detail")).not.toBeEmpty();

  for (const action of ["Send files", "Send text", "Send a link", "Send clipboard"]) {
    await expect(page.getByRole("button", { name: action })).toBeDisabled();
  }
  await expect(page.locator("#drop-zone")).toHaveAttribute("aria-disabled", "true");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const broad = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const severe = broad.violations.filter(violation => seriousOrCritical.has(violation.impact ?? ""));
  expect(severe, severe.map(violation => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);

  const contrast = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .analyze();
  expect(
    contrast.violations,
    contrast.violations.map(violation => `${violation.id}: ${violation.help}`).join("\n")
  ).toEqual([]);
});
