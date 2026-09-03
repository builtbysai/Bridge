import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

const TEST_SECRET_BYTE = 0x42;
const TEST_SECRET = "42".repeat(32);

type Rgb = [number, number, number];

const parseRgb = (value: string): Rgb => {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) throw new Error(`Expected rgb/rgba color, got ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const luminance = ([r, g, b]: Rgb) => {
  const linear = [r, g, b].map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const contrast = (first: string, second: string) => {
  const firstLuminance = luminance(parseRgb(first));
  const secondLuminance = luminance(parseRgb(second));
  return (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05);
};

test("active queue progress exposes at least 3:1 non-text contrast", async ({ browser }) => {
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
  const guest = await guestContext.newPage();

  try {
    await host.goto("/");
    const sessionCode = host.locator("#session-code strong");
    await expect(sessionCode).toHaveText(/^[A-F0-9]{12}$/);
    const sessionId = (await sessionCode.textContent())?.toLowerCase();
    if (!sessionId) throw new Error("Host did not expose a signaling session id");

    await guest.goto(`/?session=${sessionId}&portal=receive#key=${TEST_SECRET}`);
    await expect(host.locator("#connection-title")).toHaveText("Device connected", { timeout: 20_000 });
    await expect(guest.locator("#connection-title")).toHaveText("Ready to send", { timeout: 20_000 });

    const file = {
      name: "bridge-progress-contrast.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.alloc(128 * 1024, 0x70)
    };
    await guest.locator("#file-input").setInputFiles(file);

    const row = guest.locator(".queue-item", { hasText: file.name });
    await expect(row).toHaveAttribute("data-status", "sending");
    await expect(host.locator("#incoming-detail")).toContainText(file.name);

    const colors = await row.locator("progress").evaluate(progress => {
      const styles = getComputedStyle(progress);
      const rowStyles = getComputedStyle(progress.closest(".queue-item")!);
      const valueRule = Array.from(document.styleSheets)
        .flatMap(sheet => Array.from(sheet.cssRules))
        .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule)
        .find(rule => rule.selectorText?.includes(".queue-item progress::-webkit-progress-value"));

      return {
        track: styles.backgroundColor,
        border: styles.borderTopColor,
        surrounding: rowStyles.backgroundColor,
        fill: valueRule?.style.backgroundColor ?? ""
      };
    });

    expect(colors.fill, "Progress fill must use an explicit reviewed color").not.toBe("");
    expect(contrast(colors.fill, colors.track), "Progress fill must contrast against its track by at least 3:1").toBeGreaterThanOrEqual(3);
    expect(contrast(colors.border, colors.surrounding), "Progress boundary must contrast against the surrounding queue surface by at least 3:1").toBeGreaterThanOrEqual(3);
  } finally {
    await guestContext.close();
    await hostContext.close();
  }
});
