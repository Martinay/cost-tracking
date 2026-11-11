import { expect, test, type Page } from "@playwright/test";

async function syntheticAccount(page: Page) {
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "language-owner" },
        accessToken: "test-only",
        csrfToken: "test-only",
      },
    }),
  );
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const base = { streamVersion: 1, nextCursor: null, items: [] };
    if (url.pathname === "/api/v1/account")
      return route.fulfill({
        json: {
          ...base,
          currency: "EUR",
          timeZone: "Europe/Berlin",
          ownerToday: "2026-11-01",
          settingsLocked: true,
          drivingRateMinorPerKm: 30,
        },
      });
    if (url.pathname === "/api/v1/horses")
      return route.fulfill({
        json: {
          ...base,
          items: [
            {
              horseId: "horse-a",
              name: "Income",
              breed: "Other",
              status: "Active",
            },
          ],
        },
      });
    if (url.pathname.endsWith("monthly-pnl"))
      return route.fulfill({
        json: {
          ...base,
          month: "2026-11",
          currency: "EUR",
          items: [
            {
              horseId: "horse-a",
              incomeMinor: 123456,
              expenseMinor: 23456,
              netMinor: 100000,
            },
          ],
        },
      });
    if (url.pathname.endsWith("lifetime"))
      return route.fulfill({
        json: {
          ...base,
          complete: true,
          asOfDate: "2026-11-01",
          currency: "EUR",
        },
      });
    if (url.pathname.endsWith("breakdown"))
      return route.fulfill({ json: { ...base, totalMinor: 0 } });
    if (url.pathname === "/api/v1/previews/financial")
      return route.fulfill({
        json: {
          streamVersion: 1,
          amountMinor: 1001,
          currency: "EUR",
          date: "2026-11-01",
          splitMode: "Equal",
          allocations: [{ horseId: "horse-a", amountMinor: 1001 }],
          monthlyEffect: [],
        },
      });
    return route.fulfill({ json: base });
  });
}

test("signed-out language selection persists and is keyboard accessible", async ({
  page,
}) => {
  await page.route("**/auth/session", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Language").focus();
  await page.keyboard.press("d");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(
    page.getByRole("link", { name: "Anmelden", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Sprache")).toHaveValue("de");
  await page.getByLabel("Sprache").selectOption("en");
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
});

for (const width of [1440, 375]) {
  test(`German navigation, locked settings, reports and drafts at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await syntheticAccount(page);
    await page.goto("/horses");
    await page.getByLabel("Language").selectOption("de");
    await expect(
      page.getByRole("heading", { name: "Deine Pferde", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Pferde", exact: true }),
    ).toHaveCSS("display", "grid");
    await expect(
      page.getByRole("heading", { name: "Income", exact: true }),
    ).toBeVisible();
    for (const [path, heading] of [
      ["/tasks", "Aufgaben"],
      ["/income", "Einnahmen"],
      ["/approvals", "Einnahmenbestätigungen"],
      ["/reports", "Finanzberichte"],
      ["/settings", "Einstellungen"],
      ["/expenses", "Ausgaben"],
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading, exact: true, level: 1 }),
      ).toBeVisible();
      await expect(page.getByLabel("Sprache")).toHaveValue("de");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (path === "/settings") {
        await expect(page.getByLabel("Währung")).toHaveCount(0);
        await expect(
          page.getByRole("heading", { name: "Kilometersatz", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Kilometersatz speichern" }),
        ).toBeEnabled();
        await expect(
          page.getByRole("heading", { name: "Kontoverlauf", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Buchführungseinstellungen" }),
        ).toHaveCount(0);
        await expect(page.getByLabel("Sprache")).toBeEnabled();
      }
      if (path === "/reports")
        await expect(
          page.getByRole("table", {
            name: "Monatliche Gewinn- und Verlustrechnung",
            exact: true,
          }),
        ).toContainText("1.234,56");
    }
    await page
      .getByRole("button", { name: "Ausgabe erfassen", exact: true })
      .click();
    await page.getByLabel("Betrag", { exact: true }).fill("10.01");
    await page.getByLabel("Kategorie", { exact: true }).selectOption("Feed");
    await page.getByLabel("Beschreibung", { exact: true }).fill("Income");
    await page.getByLabel("Income", { exact: true }).check();
    await page
      .getByRole("button", { name: "Ausgabe prüfen", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Ausgabenvorschau" }),
    ).toContainText("10,01");
    const previewForm = page;
    await previewForm.getByLabel("Sprache").selectOption("en");
    await expect(
      page.getByRole("region", { name: "Expense preview" }),
    ).toContainText("€10.01");
    await expect(previewForm.getByLabel("Amount", { exact: true })).toHaveValue(
      "10.01",
    );
    await expect(
      previewForm.getByLabel("Description", { exact: true }),
    ).toHaveValue("Income");
    await previewForm.getByLabel("Language").selectOption("de");
    await expect(
      page.getByRole("region", { name: "Ausgabenvorschau" }),
    ).toContainText("10,01");
    await page.goto("/horses");
    await page
      .getByRole("button", { name: "Pferd hinzufügen", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name", { exact: true }).fill("Draft name");
    await dialog.getByLabel("Sprache").selectOption("en");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
      "Draft name",
    );
    await dialog.getByLabel("Language").selectOption("de");
    await expect(
      dialog.getByRole("heading", { name: "Pferd hinzufügen", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.goto("/tasks");
    await page.getByLabel("Pferd", { exact: true }).selectOption("horse-a");
    await page.getByLabel("Minuten", { exact: true }).fill("45");
    await page.getByLabel("Sprache").selectOption("en");
    await expect(page.getByLabel("Minutes", { exact: true })).toHaveValue("45");
    await page.getByLabel("Language").selectOption("de");
    await expect(page.getByLabel("Minuten", { exact: true })).toHaveValue("45");
    await page.screenshot({
      path: `test-results/german-${width}.png`,
      fullPage: true,
    });
  });
}
