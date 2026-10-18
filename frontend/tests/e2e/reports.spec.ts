import { expect, test } from "@playwright/test";

test("compares monthly horse totals with category, source, and activity details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  let selectedHorse: string | null = null;
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        user: { id: "owner-reports" },
        accessToken: "memory-only",
        csrfToken: "csrf",
      }),
    }),
  );
  await page.route("**/api/v1/account", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        currency: "EUR",
        ownerToday: "2026-10-09",
        streamVersion: 5,
      }),
    }),
  );
  await page.route("**/api/v1/horses", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          { horseId: "horse-a", name: "Misty", status: "Retired" },
          { horseId: "horse-b", name: "Comet", status: "Sold" },
        ],
        streamVersion: 5,
      }),
    }),
  );
  await page.route("**/api/v1/reports/monthly-pnl**", (route) => {
    const url = new URL(route.request().url());
    selectedHorse = url.searchParams.get("horseId");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        currency: "EUR",
        month: "2026-10",
        streamVersion: 5,
        items: selectedHorse
          ? [
              {
                horseId: selectedHorse,
                incomeMinor: 10000,
                expenseMinor: 2500,
                netMinor: 7500,
              },
            ]
          : [
              {
                horseId: "horse-a",
                incomeMinor: 10000,
                expenseMinor: 2500,
                netMinor: 7500,
              },
              {
                horseId: "horse-b",
                incomeMinor: 0,
                expenseMinor: 500,
                netMinor: -500,
              },
            ],
      }),
    });
  });
  await page.route("**/api/v1/reports/breakdown**", (route) => {
    const url = new URL(route.request().url());
    const expenses = url.searchParams.get("kind") === "expense";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        currency: "EUR",
        streamVersion: 5,
        asOfDate: "2026-10-09",
        totalMinor: expenses ? 2500 : 10000,
        items: [
          {
            label: expenses ? "Feed" : "Boarding",
            amountMinor: expenses ? 2500 : 10000,
          },
        ],
      }),
    });
  });
  await page.route("**/api/v1/reports/activity**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        streamVersion: 5,
        items: [
          { taskType: "Riding", count: 2, minutes: 75 },
          { taskType: "PaddockDuty", count: 1, minutes: 0 },
        ],
      }),
    }),
  );
  await page.route("**/api/v1/reports/lifetime**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        currency: "EUR",
        asOfDate: "2026-10-09",
        streamVersion: 5,
        complete: true,
        nextCursor: null,
        items: [
          {
            horseId: "horse-a",
            incomeMinor: 10000,
            expenseMinor: 2500,
            netMinor: 7500,
          },
          {
            horseId: "horse-b",
            incomeMinor: 0,
            expenseMinor: 500,
            netMinor: -500,
          },
        ],
      }),
    }),
  );

  await page.goto("/reports");
  await expect(page.getByTestId("report-ready")).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Monthly profit and loss" }),
  ).toContainText("Misty (Retired)");
  await expect(
    page.getByRole("table", { name: "Expense breakdown" }),
  ).toContainText("Feed");
  await expect(
    page.getByRole("table", { name: "Income breakdown" }),
  ).toContainText("Boarding");
  await expect(
    page.getByRole("table", { name: "Activity summary" }),
  ).toContainText("75 minutes");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "200%";
  });
  const reportLayout = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    overflowing: Array.from(document.body.querySelectorAll<HTMLElement>("*"))
      .map((element) => ({
        name: element.tagName.toLowerCase(),
        className: element.className,
        width: Math.round(element.getBoundingClientRect().width),
        right: Math.round(element.getBoundingClientRect().right),
      }))
      .filter((element) => element.right > document.documentElement.clientWidth)
      .slice(0, 12),
  }));
  expect(
    reportLayout.documentWidth,
    `reports must remain within the viewport at a narrow 200% zoom; overflow: ${JSON.stringify(reportLayout.overflowing)}`,
  ).toBeLessThanOrEqual(reportLayout.viewportWidth);
  const pnlViewport = page.getByRole("region", {
    name: "Monthly profit and loss table; scroll horizontally if needed",
  });
  await expect(pnlViewport).toBeVisible();
  await expect(pnlViewport).toHaveAttribute("tabindex", "0");
  const overflow = await pnlViewport.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
  await pnlViewport.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => pnlViewport.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await page.getByLabel("Horse filter").selectOption("horse-a");
  await expect.poll(() => selectedHorse).toBe("horse-a");
  await expect(
    page.getByRole("table", { name: "Monthly profit and loss" }),
  ).toContainText("Misty (Retired)");
});
