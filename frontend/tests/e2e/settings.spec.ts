import { expect, test } from "@playwright/test";

for (const width of [1280, 375]) {
  for (const timezoneId of ["Europe/Berlin", "America/New_York"]) {
    test(`automatic defaults and local history at ${width}px in ${timezoneId}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        baseURL: process.env.E2E_WEB_URL,
        viewport: { width, height: 900 },
        timezoneId,
      });
      const page = await context.newPage();
      try {
        await page.route("**/auth/session", (route) =>
          route.fulfill({
            json: {
              user: { id: "owner-settings" },
              accessToken: "memory-only",
              csrfToken: "test-csrf",
            },
          }),
        );
        await page.route("**/api/v1/account", (route) => {
          expect(route.request().method()).toBe("GET");
          return route.fulfill({
            json: {
              currency: "EUR",
              timeZone: "UTC",
              settingsLocked: false,
              drivingRateMinorPerKm: null,
              streamVersion: 1,
            },
          });
        });
        const occurredAt = "2026-03-29T00:30:00Z";
        await page.route("**/api/v1/history**", (route) =>
          route.fulfill({
            json: {
              items: [
                {
                  eventId: "event-1",
                  occurredAt,
                  summary: "Horse registered",
                  type: "HorseRegistered",
                  changes: {},
                },
              ],
              nextCursor: null,
              streamVersion: 1,
            },
          }),
        );
        await page.goto("/settings");
        await expect(
          page.getByRole("heading", { name: "Driving rate" }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Ledger preferences" }),
        ).toHaveCount(0);
        await expect(page.getByLabel("Currency", { exact: true })).toHaveCount(
          0,
        );
        await expect(page.getByLabel("Time zone", { exact: true })).toHaveCount(
          0,
        );
        await expect(
          page.getByRole("button", { name: "Save settings" }),
        ).toHaveCount(0);
        const expected = await page.evaluate(
          (value) => new Date(value).toLocaleString("en-US"),
          occurredAt,
        );
        await expect(page.locator("time")).toHaveText(expected);
        await expect(page.locator("time")).toHaveAttribute(
          "datetime",
          occurredAt,
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `/tmp/cost-defaults-${width}-${timezoneId.replaceAll("/", "-")}.png`,
          fullPage: true,
        });
      } finally {
        await context.close();
      }
    });
  }
}
