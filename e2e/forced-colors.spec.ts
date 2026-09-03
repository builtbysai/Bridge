import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ forcedColors: "active" });

const expectForcedColorsKeyboardSurface = async (page: Page, minimumControls: number) => {
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
        outlineStyle: styles.outlineStyle,
        outlineWidth: Number.parseFloat(styles.outlineWidth),
        outlineColor: styles.outlineColor,
        boxShadow: styles.boxShadow
      };
    });

    if (!state) continue;
    if (seen.has(state.key)) break;
    seen.add(state.key);

    expect(state.visible, `Forced-colors keyboard focus landed on a hidden control: ${state.key}`).toBe(true);
    expect(
      (state.outlineStyle !== "none" && state.outlineWidth > 0 && state.outlineColor !== "transparent") || state.boxShadow !== "none",
      `Forced-colors keyboard-focused control lacks a visible focus indicator: ${state.key}`
    ).toBe(true);
  }

  expect(seen.size).toBeGreaterThanOrEqual(minimumControls);
};

const expectVisibleBoundary = async (locator: Locator, label: string) => {
  const boundary = await locator.evaluate(element => {
    const styles = getComputedStyle(element);
    return {
      style: styles.borderTopStyle,
      width: Number.parseFloat(styles.borderTopWidth),
      color: styles.borderTopColor
    };
  });
  expect(boundary.style, `${label} should retain a border in forced-colors mode`).not.toBe("none");
  expect(boundary.width, `${label} should retain a non-zero border in forced-colors mode`).toBeGreaterThan(0);
  expect(boundary.color, `${label} border should not become transparent in forced-colors mode`).not.toBe("transparent");
};

const expectNoPageOverflow = async (page: Page) => {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
};

test("host remains usable with forced colors enabled", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Move something between devices.");
  await expect(page.getByRole("button", { name: "Rename" })).toBeVisible();
  await expect(page.locator("#drop-zone")).toBeVisible();
  await expectVisibleBoundary(page.locator(".pair-card"), "Pairing card");
  await expectVisibleBoundary(page.locator("#drop-zone"), "Drop zone");
  await expectVisibleBoundary(page.locator(".connection"), "Connection status");
  // All primary [data-action] buttons stay disabled (and out of tab order)
  // until a real peer connects, which never happens in these single-page
  // tests -- so only 3 controls are ever focusable here, not 4.
  await expectForcedColorsKeyboardSurface(page, 3);
  await expectNoPageOverflow(page);
});

test("receive portal remains usable with forced colors enabled", async ({ page }) => {
  await page.goto("/?session=0123456789ab&portal=receive#key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Send something to this device.");
  await expect(page.getByRole("button", { name: "Send files" })).toBeVisible();
  await expectVisibleBoundary(page.locator(".pair-card"), "Receive Portal card");
  await expectVisibleBoundary(page.locator("#drop-zone"), "Receive Portal drop zone");
  // All primary [data-action] buttons stay disabled (and out of tab order)
  // until a real peer connects, which never happens in these single-page
  // tests -- so only 3 controls are ever focusable here, not 4.
  await expectForcedColorsKeyboardSurface(page, 3);
  await expectNoPageOverflow(page);
});
