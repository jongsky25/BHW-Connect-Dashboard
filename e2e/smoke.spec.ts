import { test, expect } from "@playwright/test";

/**
 * The one CI-gated smoke path BUILD_PLAN.md §5/§7 1.10 asks for: home ->
 * explore -> filter to a barangay -> export CSV. Runs against a production
 * build on every push to main (see .github/workflows/ci.yml), not every PR,
 * to stay within free CI-minute budgets.
 */
test("home -> explore -> filter to barangay -> export CSV", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Barangay Health Workers");

  await page.getByRole("link", { name: "Explore" }).click();
  await expect(page).toHaveURL(/\/explore/);
  await expect(page.getByText(/^N = /).first()).toBeVisible();

  await page.selectOption("#geo-select-Region", { label: "REGION I (ILOCOS REGION)" });
  await page.waitForURL(/geoLevel=region/);
  await page.waitForSelector("#geo-select-Province:not([disabled])");

  await page.selectOption("#geo-select-Province", { index: 1 });
  await page.waitForURL(/geoLevel=province/);
  await page.waitForSelector('#geo-select-City\\/Municipality:not([disabled])');

  await page.selectOption("#geo-select-City\\/Municipality", { index: 1 });
  await page.waitForURL(/geoLevel=citymun/);
  await page.waitForSelector("#geo-select-Barangay:not([disabled])");

  await page.selectOption("#geo-select-Barangay", { index: 1 });
  await page.waitForURL(/geoLevel=barangay/);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator('a[href^="/api/export/csv"]').first().click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
});
