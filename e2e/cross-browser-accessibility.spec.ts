import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const expectNoSeriousAccessibilityViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const serious = results.violations.filter(violation => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, serious.map(violation => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
};

const expectNoPageOverflow = async (page: Page) => {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
};

const expectKeyboardReachability = async (page: Page, minimumControls: number) => {
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const seen = new Set<string>();

  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const styles = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const label = element.getAttribute("aria-label")
        ?? element.textContent?.trim()
        ?? element.getAttribute("name")
        ?? element.id;
      return {
        key: `${element.tagName}:${element.id}:${label}`,
        visible: rect.width > 0 && rect.height > 0 && styles.visibility !== "hidden" && styles.display !== "none",
        hasIndicator: (styles.outlineStyle !== "none" && Number.parseFloat(styles.outlineWidth) > 0)
          || styles.boxShadow !== "none"
      };
    });

    if (!state) continue;
    if (seen.has(state.key)) break;
    seen.add(state.key);
    expect(state.visible, `Keyboard focus landed on a hidden control: ${state.key}`).toBe(true);
    expect(state.hasIndicator, `Keyboard-focused control lacks a rendered indicator: ${state.key}`).toBe(true);
  }

  expect(seen.size).toBeGreaterThanOrEqual(minimumControls);
};

test("host shell remains accessible and keyboard reachable across browser engines", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Move something between devices.");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expectNoPageOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);
  // All primary [data-action] buttons stay disabled (and out of tab order)
  // until a real peer connects, which never happens in these single-page
  // tests -- so only 3 controls are ever focusable here, not 4.
  await expectKeyboardReachability(page, 3);
});

test("receive portal remains accessible and keyboard reachable across browser engines", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/?session=0123456789ab&portal=receive#key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Send something to this device.");
  await expect(page.getByRole("button", { name: "Send files" })).toBeVisible();
  await expectNoPageOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);
  // All primary [data-action] buttons stay disabled (and out of tab order)
  // until a real peer connects, which never happens in these single-page
  // tests -- so only 3 controls are ever focusable here, not 4.
  await expectKeyboardReachability(page, 3);
});

test("missing-session failure remains readable and safely disabled across browser engines", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/?session=0123456789ab&portal=receive#key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

  await expect(page.getByText("Connection problem", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Send files" })).toBeDisabled();
  await expect(page.locator("#drop-zone")).toHaveAttribute("aria-disabled", "true");
  await expectNoPageOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);
});
