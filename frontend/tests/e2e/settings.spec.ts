import { expect, test } from "@playwright/test";

for (const width of [1280, 375]) {
  test(`time zone dropdown supports keyboard save and persistence at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let savedZone: string | null = null;
    let streamVersion = 0;
    await page.route("**/auth/session", (route) =>
      route.fulfill({
        json: {
          user: { id: "owner-settings" },
          accessToken: "memory-only",
          csrfToken: "memory-only-csrf",
        },
      }),
    );
    await page.route("**/api/v1/account", async (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        expect(body.currency).toBe("EUR");
        expect(route.request().headers()["if-match"]).toBe(
          `"${streamVersion}"`,
        );
        savedZone = body.timeZone;
        streamVersion += 1;
      }
      await route.fulfill({
        json: {
          currency: "EUR",
          timeZone: savedZone,
          settingsLocked: false,
          streamVersion,
        },
      });
    });
    await page.route("**/api/v1/history**", (route) =>
      route.fulfill({ json: { items: [], nextCursor: null, streamVersion } }),
    );
    await page.goto("/settings");
    const timeZone = page.getByRole("combobox", { name: "Time zone" });
    await expect(timeZone).toBeVisible();
    await expect(timeZone).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Save settings" }),
    ).toBeDisabled();
    await timeZone.focus();
    await page.keyboard.press("u");
    await expect(timeZone).toHaveValue("UTC");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Save settings" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Account settings saved.")).toBeVisible();
    await page.reload();
    await expect(timeZone).toHaveValue("UTC");
    await timeZone.selectOption("America/New_York");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Account settings saved.")).toBeVisible();
    await page.reload();
    await expect(timeZone).toHaveValue("America/New_York");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/cost-timezone-${width}.png`,
      fullPage: true,
    });
  });
}
