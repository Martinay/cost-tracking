import { expect, test, type Page } from "@playwright/test";

async function horseList(page: Page) {
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      json: {
        user: { id: "card-owner" },
        accessToken: "test-only",
        csrfToken: "test-only",
      },
    }),
  );
  await page.route("**/api/v1/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/v1/account")
      return route.fulfill({
        json: { currency: "EUR", timeZone: "Europe/Berlin", streamVersion: 1 },
      });
    if (pathname === "/api/v1/horses")
      return route.fulfill({
        json: {
          streamVersion: 1,
          items: [
            {
              horseId: "rocky",
              name: "Rocky",
              breed: "Holsteiner",
              status: "Active",
            },
            {
              horseId: "pearl",
              name: "Pearl with a very long horse name that wraps",
              breed: null,
              status: "Archived",
            },
          ],
        },
      });
    return route.fulfill({
      status: 404,
      json: { message: "Horse not found." },
    });
  });
}

for (const width of [1440, 375]) {
  for (const language of ["en", "de"]) {
    test(`whole horse cards support pointer and keyboard at ${width}px in ${language}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 960 });
      await horseList(page);
      await page.goto("/horses");
      await page.getByLabel("Language").selectOption(language);
      const label = language === "en" ? "View Rocky" : "Rocky ansehen";
      const list = page.locator(".horse-grid");
      const card = list.locator("li").first();
      for (const region of ["padding", "name", "breed", "status", "view"]) {
        await page.goto("/horses");
        const link = page.getByRole("link", { name: label, exact: true });
        await expect(link).toBeVisible();
        if (region === "padding")
          await card.click({ position: { x: 8, y: 8 } });
        else {
          const target =
            region === "name"
              ? card.locator("h2")
              : region === "breed"
                ? card.locator("p").first()
                : region === "status"
                  ? card.locator("span")
                  : link;
          const box = await target.boundingBox();
          if (!box) throw new Error(`Missing ${region} hit area`);
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
        await expect(page).toHaveURL(/\/horses\/rocky$/);
      }
      await page.goto("/horses");
      const links = list.getByRole("link");
      await expect(links).toHaveCount(2);
      await links.first().focus();
      await page.keyboard.press("Tab");
      await expect(links.nth(1)).toBeFocused();
      await expect(links.nth(1)).toHaveAttribute("href", "/horses/pearl");
      await expect(links.nth(1)).toHaveCSS("outline-style", "none");
      const outline = await links
        .nth(1)
        .evaluate((link) => getComputedStyle(link, "::after").outlineStyle);
      expect(outline).toBe("solid");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/horse-cards-${language}-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/horses\/pearl$/);
      await page.goto("/horses");
      const popupPromise = page.context().waitForEvent("page");
      await list
        .locator("li")
        .nth(1)
        .click({
          position: { x: 8, y: 8 },
          button: "middle",
        });
      const popup = await popupPromise;
      await expect(popup).toHaveURL(/\/horses\/pearl$/);
      await expect(page).toHaveURL(/\/horses$/);
      await popup.close();
    });
  }
}
