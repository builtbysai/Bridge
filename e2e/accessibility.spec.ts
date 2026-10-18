import { expect, test } from "@playwright/test";
import { expectNoContrastViolations, expectNoHorizontalScroll, expectNoSeriousViolations, pair } from "./helpers";

test("waiting, broken-link and settings states pass automated WCAG checks", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#invite-copy")).toBeVisible();
  await expectNoSeriousViolations(page);
  await expectNoContrastViolations(page);

  await page.locator("#settings-toggle").click();
  await expect(page.locator("#settings-panel")).toBeVisible();
  await expectNoSeriousViolations(page);
  await expectNoContrastViolations(page);

  await page.goto("/?session=nope#key=bad");
  await expect(page.locator("#note-title")).toContainText("This link is broken");
  await expectNoSeriousViolations(page);
  await expectNoContrastViolations(page);
});

test("connected host and guest pass WCAG checks and keep touch targets comfortable", async ({ browser }) => {
  const { host, guest, close } = await pair(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const page of [host, guest]) {
    await expectNoSeriousViolations(page);
    await expectNoContrastViolations(page);
  }
  await expectNoHorizontalScroll(guest);
  for (const button of await guest.locator("[data-action]").all()) {
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await close();
});

test("primary controls are keyboard reachable with a visible focus indicator", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#invite-copy")).toBeVisible();
  const reached = new Set<string>();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      return { id: el.id, outline: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0 };
    });
    if (info?.id) {
      reached.add(info.id);
      expect(info.outline, `${info.id} shows a focus indicator`).toBe(true);
    }
  }
  expect([...reached]).toEqual(expect.arrayContaining(["settings-toggle", "invite-copy"]));
});

test("remains usable with forced colors and without horizontal scroll on a narrow phone", async ({ browser }) => {
  const context = await browser.newContext({ forcedColors: "active", viewport: { width: 320, height: 640 } });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("#invite-copy")).toBeVisible();
  await expect(page.locator("#qr")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await context.close();
});
