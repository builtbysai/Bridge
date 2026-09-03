import { expect, test } from "@playwright/test";

test("premium shell exposes the reviewed semantic design tokens", async ({ page }) => {
  await page.goto("/");

  const tokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      background: styles.getPropertyValue("--bg").trim(),
      surface: styles.getPropertyValue("--surface").trim(),
      text: styles.getPropertyValue("--text").trim(),
      secondaryText: styles.getPropertyValue("--text-secondary").trim(),
      accent: styles.getPropertyValue("--accent").trim(),
      focus: styles.getPropertyValue("--focus").trim(),
      border: styles.getPropertyValue("--border").trim(),
      radius: styles.getPropertyValue("--radius-md").trim()
    };
  });

  for (const [name, value] of Object.entries(tokens)) {
    expect(value, `${name} design token should remain defined`).not.toBe("");
  }
});

test("primary transfer actions keep comfortable touch targets", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const sendFiles = page.getByRole("button", { name: "Send files" });
  const request = page.getByRole("button", { name: "Request something" });
  const receive = page.getByRole("button", { name: "Copy receive link" });

  for (const control of [sendFiles, request, receive]) {
    const box = await control.boundingBox();
    expect(box, "primary action should have a rendered box").not.toBeNull();
    expect(box!.height, "primary action should be at least 44 CSS px tall").toBeGreaterThanOrEqual(44);
  }
});

test("mobile shell retains visual hierarchy without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");

  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    pageWidth: document.documentElement.scrollWidth,
    heroWidth: document.querySelector(".hero")?.getBoundingClientRect().width ?? 0,
    cardWidth: document.querySelector(".pair-card")?.getBoundingClientRect().width ?? 0
  }));

  expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.heroWidth).toBeGreaterThan(0);
  expect(metrics.cardWidth).toBeGreaterThan(0);
  expect(metrics.cardWidth).toBeLessThanOrEqual(metrics.viewport);
});
