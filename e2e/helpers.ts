import AxeBuilder from "@axe-core/playwright";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export const live = (page: Page) => expect(page.locator("#st")).toHaveText("LIVE", { timeout: 25_000 });

export interface Pair {
  hostContext: BrowserContext;
  guestContext: BrowserContext;
  host: Page;
  guest: Page;
  close: () => Promise<void>;
}

/** Pairs a host with a guest the way a user without a camera would: copy the invite link. */
export const pair = async (browser: Browser, guestOptions: Parameters<Browser["newContext"]>[0] = {}): Promise<Pair> => {
  const hostContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const guestContext = await browser.newContext(guestOptions);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await host.goto("/");
  await host.locator("#invite-copy").click();
  await guest.goto(await host.evaluate(() => navigator.clipboard.readText()));
  await live(host);
  await live(guest);
  return {
    hostContext,
    guestContext,
    host,
    guest,
    close: async () => {
      await guestContext.close();
      await hostContext.close();
    }
  };
};

export const expectNoSeriousViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const serious = results.violations.filter(v => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map(v => `${v.id}: ${v.help} ${v.nodes.map(n => n.target.join(" ")).join(", ")}`).join("\n")).toEqual([]);
};

export const expectNoContrastViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  expect(
    results.violations,
    results.violations.flatMap(v => v.nodes.map(n => `${n.target.join(" ")}: ${n.failureSummary ?? v.help}`)).join("\n")
  ).toEqual([]);
};

export const expectNoHorizontalScroll = async (page: Page) => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
};
