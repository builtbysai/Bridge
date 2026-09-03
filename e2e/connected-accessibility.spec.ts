import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const TEST_SECRET_BYTE = 0x43;
const TEST_SECRET = "43".repeat(32);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

interface PairedPages {
  hostContext: BrowserContext;
  guestContext: BrowserContext;
  host: Page;
  guest: Page;
}

const pairReceivePortal = async (browser: Browser): Promise<PairedPages> => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();

  await hostContext.addInitScript(({ secretByte }) => {
    const originalGetRandomValues = crypto.getRandomValues.bind(crypto);
    let seededBridgeSecret = false;
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      value: (array: ArrayBufferView) => {
        if (!seededBridgeSecret && array instanceof Uint8Array && array.byteLength === 32) {
          array.fill(secretByte);
          seededBridgeSecret = true;
          return array;
        }
        return originalGetRandomValues(array);
      }
    });
  }, { secretByte: TEST_SECRET_BYTE });

  const host = await hostContext.newPage();
  await host.goto("/");
  const sessionCode = host.locator("#session-code strong");
  await expect(sessionCode).toHaveText(/^[A-F0-9]{12}$/);
  const sessionId = (await sessionCode.textContent())?.toLowerCase();
  if (!sessionId || !/^[a-f0-9]{12}$/.test(sessionId)) {
    throw new Error("Host did not expose a valid signaling session id");
  }

  const guest = await guestContext.newPage();
  await guest.goto(`/?session=${sessionId}&portal=receive#key=${TEST_SECRET}`);
  await expect(host.locator("#connection-title")).toHaveText("Device connected", { timeout: 20_000 });
  await expect(guest.locator("#connection-title")).toHaveText("Ready to send", { timeout: 20_000 });
  await expect(host.locator("#route-pill")).toBeVisible();
  await expect(guest.locator("#route-pill")).toBeVisible();

  return { hostContext, guestContext, host, guest };
};

const closePair = async ({ hostContext, guestContext }: PairedPages) => {
  await guestContext.close();
  await hostContext.close();
};

const expectNoSeriousAccessibilityViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const serious = results.violations.filter(violation => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, serious.map(violation => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
};

const expectNoTextContrastViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  expect(
    results.violations,
    results.violations.flatMap(violation => violation.nodes.map(node => `${violation.id}: ${node.target.join(" ")}: ${node.failureSummary ?? violation.help}`)).join("\n")
  ).toEqual([]);
};

test("authenticated connected host and Receive Portal pass accessibility and text-contrast gates", async ({ browser }) => {
  const pair = await pairReceivePortal(browser);
  const { host, guest } = pair;

  try {
    await expect(host.locator("#route-pill")).toHaveText(/Direct|Relayed/);
    await expect(guest.locator("#route-pill")).toHaveText(/Direct|Relayed/);

    await expectNoSeriousAccessibilityViolations(host);
    await expectNoTextContrastViolations(host);
    await expectNoSeriousAccessibilityViolations(guest);
    await expectNoTextContrastViolations(guest);
  } finally {
    await closePair(pair);
  }
});
