import { test, expect } from "@playwright/test";

/**
 * Presentation ("Present") mode on /explore: enter, navigate, prove a slide
 * stays interactive, exit. Kept out of the CI-gated smoke path (smoke.spec.ts)
 * per the repo's CI-minute-budget note; fullscreen itself is not asserted
 * (headless browsers report it inconsistently) — the overlay is.
 */
test("explore -> present -> navigate -> interact -> exit", async ({ page }) => {
  // Deny the Fullscreen API so the test exercises the deterministic fallback
  // overlay: headless Chromium grants fullscreen but then drops it at random,
  // which correctly (by design) ends the presentation and flakes the test.
  await page.addInitScript(() => {
    HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error("denied"));
  });
  await page.goto("/explore");
  await expect(page.getByText(/^N = /).first()).toBeVisible();

  // The button renders once at least one slide has registered (client effect).
  const present = page.getByRole("button", { name: "Present" });
  await expect(present).toBeVisible();
  await present.click();

  // Title slide: counter at 1 / N, area name shown big.
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Philippines", exact: true })).toBeVisible();

  // Advance to the first content slide (the at-a-glance summary), asserting
  // against the promoted wrapper so a match under the backdrop can't pass.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();
  await expect(page.locator("[data-slide-active]")).toContainText("at a glance");

  // Jump to the honorarium slide via the overview grid and switch a tab —
  // slides must stay fully interactive.
  await page.getByRole("button", { name: "Overview" }).click();
  await page.getByRole("button", { name: /\d+\.\s*Honorarium$/ }).click();
  const amountTab = page.getByRole("tab", { name: "How much" });
  await expect(amountTab).toBeVisible();
  await amountTab.click();
  await expect(amountTab).toHaveAttribute("aria-selected", "true");

  // Exit restores the normal page (Escape may be eaten by fullscreen exit in
  // some environments, so use the explicit control).
  await page.getByRole("button", { name: "Exit presentation" }).click();
  await expect(page.getByText(/^\d+ \/ \d+$/)).toBeHidden();
  await expect(page.getByRole("button", { name: "Present" })).toBeVisible();
});
