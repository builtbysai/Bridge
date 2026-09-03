import { expect, test } from "@playwright/test";

test("transfer progress exposes an accessible name and description", async ({ page }) => {
  await page.goto("/");

  const progress = page.locator("#transfer-progress");
  await expect(progress).toHaveAttribute("aria-labelledby", "transfer-title");
  await expect(progress).toHaveAttribute("aria-describedby", "transfer-detail");
});

test("queue progress is named with its file", async ({ page }) => {
  await page.goto("/");

  await page.locator("#queue-list").evaluate((list) => {
    list.innerHTML = `
      <article class="queue-item">
        <div class="queue-item-copy">
          <strong>example.txt</strong>
          <small>Sending · 1 KB / 2 KB</small>
          <progress max="100" value="50"></progress>
        </div>
      </article>
    `;
  });

  await expect(page.locator(".queue-item progress")).toHaveAttribute(
    "aria-label",
    "example.txt transfer progress",
  );
});
