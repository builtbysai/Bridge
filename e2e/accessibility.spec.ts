import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const MIN_NON_TEXT_CONTRAST = 3;

const expectNoSeriousAccessibilityViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const serious = results.violations.filter(violation => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, serious.map(violation => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
};

const expectNoContrastViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  expect(
    results.violations,
    results.violations.flatMap(violation => violation.nodes.map(node => `${violation.id}: ${node.target.join(" ")}: ${node.failureSummary ?? violation.help}`)).join("\n")
  ).toEqual([]);
};

const expectNoPageOverflow = async (page: Page) => {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
};

const expectKeyboardFocusCycle = async (page: Page, minimumControls: number) => {
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

      const parseColor = (value: string) => {
        const match = value.match(/^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*(\d+(?:\.\d+)?))?\)$/);
        if (!match) return null;
        return {
          r: Number(match[1]),
          g: Number(match[2]),
          b: Number(match[3]),
          a: match[4] === undefined ? 1 : Number(match[4])
        };
      };
      const composite = (
        foreground: { r: number; g: number; b: number; a: number },
        background: { r: number; g: number; b: number; a: number }
      ) => {
        const alpha = foreground.a + background.a * (1 - foreground.a);
        if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
        return {
          r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
          g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
          b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
          a: alpha
        };
      };
      const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
        const channel = (value: number) => {
          const normalized = value / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };
      const contrastRatio = (
        foreground: { r: number; g: number; b: number },
        background: { r: number; g: number; b: number }
      ) => {
        const foregroundLuminance = luminance(foreground);
        const backgroundLuminance = luminance(background);
        return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
          / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
      };

      const ancestors: HTMLElement[] = [];
      for (let node: HTMLElement | null = element.parentElement; node; node = node.parentElement) ancestors.unshift(node);
      let surrounding = { r: 255, g: 255, b: 255, a: 1 };
      for (const ancestor of ancestors) {
        const background = parseColor(getComputedStyle(ancestor).backgroundColor);
        if (background && background.a > 0) surrounding = composite(background, surrounding);
      }
      const outlineColor = parseColor(styles.outlineColor);
      const indicatorContrast = outlineColor && outlineColor.a > 0
        ? contrastRatio(composite(outlineColor, surrounding), surrounding)
        : null;

      return {
        key: `${element.tagName}:${element.id}:${label}`,
        visible: rect.width > 0 && rect.height > 0 && styles.visibility !== "hidden" && styles.display !== "none",
        hasIndicator: (styles.outlineStyle !== "none" && Number.parseFloat(styles.outlineWidth) > 0)
          || styles.boxShadow !== "none",
        indicatorContrast
      };
    });

    if (!state) continue;
    if (seen.has(state.key)) break;
    seen.add(state.key);
    expect(state.visible, `Keyboard focus landed on a hidden control: ${state.key}`).toBe(true);
    expect(state.hasIndicator, `Keyboard-focused control lacks a visible indicator: ${state.key}`).toBe(true);
    expect(
      state.indicatorContrast,
      `Keyboard-focused control lacks a measurable outline contrast: ${state.key}`
    ).not.toBeNull();
    expect(
      state.indicatorContrast ?? 0,
      `Keyboard focus indicator contrast is below 3:1: ${state.key}`
    ).toBeGreaterThanOrEqual(MIN_NON_TEXT_CONTRAST);
  }

  expect(seen.size).toBeGreaterThanOrEqual(minimumControls);
};

test("host shell has no serious automated WCAG violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Move something between devices.");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expectNoSeriousAccessibilityViolations(page);
});

test("receive portal has no serious automated WCAG violations", async ({ page }) => {
  await page.goto("/?session=ABC123&receive=1#key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Send something to this device.");
  await expect(page.getByRole("button", { name: "Send files" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("host, receive portal, and expanded rename state meet automated WCAG AA text contrast", async ({ page }) => {
  await page.goto("/");
  await expectNoContrastViolations(page);

  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByLabel("Device name")).toBeVisible();
  await expectNoContrastViolations(page);

  await page.goto("/?session=ABC123&receive=1#key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  await expect(page.getByRole("button", { name: "Send files" })).toBeVisible();
  await expectNoContrastViolations(page);
});

test("visible host controls are reachable by keyboard without a focus trap and show focus", async ({ page }) => {
  await page.goto("/");
  await expectKeyboardFocusCycle(page, 4);
});

test("visible receive portal controls are reachable by keyboard without a focus trap and show focus", async ({ page }) => {
  await page.goto("/?session=ABC123&receive=1#key=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
  await expectKeyboardFocusCycle(page, 4);
});

test("device rename disclosure is keyboard operable, visibly focused, and restores focus", async ({ page }) => {
  await page.goto("/");
  const rename = page.getByRole("button", { name: "Rename" });
  await rename.focus();
  await page.keyboard.press("Enter");

  const input = page.getByLabel("Device name");
  await expect(input).toBeFocused();
  const outline = await input.evaluate(element => {
    const styles = getComputedStyle(element);
    return { style: styles.outlineStyle, width: styles.outlineWidth };
  });
  expect(outline.style).not.toBe("none");
  expect(Number.parseFloat(outline.width)).toBeGreaterThanOrEqual(2);

  await input.fill("Kitchen tablet");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(rename).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("Device name saved as Kitchen tablet.");
});

test("narrow viewport does not introduce page-level horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await expectNoPageOverflow(page);
});

test("200 percent layout zoom keeps the primary shell reflowed without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto("/");

  // CSS zoom is a deterministic Chromium layout proxy for the release-time
  // browser-zoom walkthrough. It catches fixed-width/clipping regressions but
  // does not replace checking native browser zoom with assistive technology.
  await page.locator("html").evaluate(element => {
    element.style.zoom = "2";
  });

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rename" })).toBeVisible();
  await expect(page.locator("#drop-zone")).toBeVisible();
  await expectNoPageOverflow(page);
});

test("reduced-motion preference suppresses nonessential transition timing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const maxTransitionMs = await page.locator("#drop-zone").evaluate(element => {
    const durations = getComputedStyle(element).transitionDuration.split(",");
    return Math.max(...durations.map(value => {
      const duration = Number.parseFloat(value);
      return value.trim().endsWith("ms") ? duration : duration * 1000;
    }));
  });

  expect(maxTransitionMs).toBeLessThanOrEqual(1);
});
