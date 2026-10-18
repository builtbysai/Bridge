import { expect, test, type Page } from "@playwright/test";

// Covers the redesigned ("Signal Room") flow: copy-invite pairing, the
// request picker, the inline composer, and that no native dialogs appear.

const live = (page: Page) => expect(page.locator("#st")).toHaveText("LIVE", { timeout: 25_000 });

test("pairs via copied invite link and completes a request without native dialogs", async ({ browser }) => {
  const hostContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  const dialogs: string[] = [];
  for (const page of [host, guest]) {
    page.on("dialog", dialog => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
  }

  await host.goto("/");
  await host.locator("#invite-copy").click();
  await expect(host.locator("#toast")).toContainText("Invite link copied");
  const link = await host.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\?session=[a-f0-9]{12}#key=[a-f0-9]{64}$/);

  await guest.goto(link);
  await live(host);
  await live(guest);

  // Host requests a link; the guest answers in the inline composer.
  await host.locator('[data-action="request"]').click();
  await host.locator('[data-request-kind="link"]').click();
  await guest.locator("#request-fulfill").click();
  await guest.locator("#compose-submit").click();
  await expect(guest.locator("#compose-panel")).toBeVisible(); // empty input is not sent
  await guest.locator("#compose-input").fill("https://example.com/hello");
  await guest.locator("#compose-submit").click();

  // The requester asked for it, so it arrives without an Accept prompt.
  await expect(host.locator("#received-content")).toHaveText("https://example.com/hello");
  await expect(host.locator("#incoming-panel")).toBeHidden();
  await expect(host.locator("#received-open")).toHaveAttribute("href", "https://example.com/hello");

  // Non-http(s) "links" are never offered as clickable.
  await host.locator('[data-action="request"]').click();
  await host.locator('[data-request-kind="link"]').click();
  await guest.locator("#request-fulfill").click();
  await guest.locator("#compose-input").fill("javascript:alert(1)");
  await guest.locator("#compose-submit").click();
  await expect(host.locator("#received-content")).toHaveText("javascript:alert(1)");
  await expect(host.locator("#received-open")).toBeHidden();

  // A decline surfaces as a toast, and Escape dismisses the picker.
  await guest.locator('[data-action="request"]').click();
  await guest.locator('[data-request-kind="text"]').click();
  await host.locator("#request-decline").click();
  await expect(guest.locator("#toast")).toContainText("declined");
  await host.locator('[data-action="request"]').click();
  await host.keyboard.press("Escape");
  await expect(host.locator("#picker-panel")).toBeHidden();

  expect(dialogs).toEqual([]);
  await guestContext.close();
  await hostContext.close();
});

test("both devices can send text, links and pasted content; drops outside the zone don't navigate", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await host.goto("/");
  await host.waitForSelector("#invite-copy:not([hidden])");
  await hostContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  await host.locator("#invite-copy").click();
  await guest.goto(await host.evaluate(() => navigator.clipboard.readText()));
  await live(host);
  await live(guest);

  // The host (not just a receive portal) can send text; a URL becomes a link.
  await host.locator('[data-action="send-text"]').click();
  await host.locator("#compose-input").fill("https://example.com/from-host");
  await host.locator("#compose-submit").click();
  await guest.locator("#incoming-memory").click();
  await expect(guest.locator("#received-title")).toHaveText("Received link");
  await expect(guest.locator("#received-open")).toHaveAttribute("href", "https://example.com/from-host");

  // Plain text from the guest side.
  await guest.locator('[data-action="send-text"]').click();
  await guest.locator("#compose-input").fill("two words");
  await guest.locator("#compose-submit").click();
  await host.locator("#incoming-memory").click();
  await expect(host.locator("#received-title")).toHaveText("Received text");

  // Pasting outside any input sends the text.
  await host.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "pasted note");
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await guest.locator("#incoming-memory").click();
  await expect(guest.locator("#received-content")).toHaveText("pasted note");

  // A drop that misses the drop zone is swallowed instead of navigating away.
  const prevented = await host.evaluate(() => {
    const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);

  await guestContext.close();
  await hostContext.close();
});
