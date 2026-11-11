import { expect, test } from "@playwright/test";

test("an owner saves a driving rate and horse with silent session renewal", async ({
  page,
}) => {
  let expired = false;
  let refreshCount = 0;
  let currentToken = "memory-only-test-token";
  await page.route("**/auth/refresh", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-csrf-token"]).toBe("memory-only-csrf");
    refreshCount += 1;
    currentToken = `renewed-token-${refreshCount}`;
    expired = false;
    await route.fulfill({
      json: { user: { id: "owner-first-use" }, accessToken: currentToken },
    });
  });
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        user: { id: "owner-first-use" },
        ...(expired ? {} : { accessToken: currentToken }),
        expiresAt: "2026-10-08T18:00:00Z",
        csrfToken: "memory-only-csrf",
      }),
    }),
  );
  const rejectedWrites = new Map<
    string,
    { body: string | null; key: string; version: string }
  >();
  async function rejectExpiredWrite(route: import("@playwright/test").Route) {
    const request = route.request();
    const headers = request.headers();
    const descriptor = {
      body: request.postData(),
      key: headers["idempotency-key"],
      version: headers["if-match"],
    };
    if (expired) {
      rejectedWrites.set(request.url(), descriptor);
      await route.fulfill({
        status: 401,
        json: {
          code: "unauthenticated",
          message: "Sign in",
          correlationId: "expiry-test",
        },
      });
      return true;
    }
    expect(headers.authorization).toBe(`Bearer ${currentToken}`);
    expect(descriptor).toEqual(rejectedWrites.get(request.url()));
    return false;
  }
  let streamVersion = 0;
  let savedRate: number | null = null;
  await page.route("**/api/v1/account", (route) =>
    route.fulfill({
      json: {
        currency: "EUR",
        timeZone: "UTC",
        streamVersion,
        drivingRateMinorPerKm: savedRate,
        settingsLocked: false,
      },
    }),
  );
  await page.route("**/api/v1/history**", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null, streamVersion } }),
  );
  await page.route("**/api/v1/driving-rate", async (route) => {
    if (await rejectExpiredWrite(route)) return;
    expect(route.request().postDataJSON()).toEqual({ rateMinorPerKm: 30 });
    savedRate = 30;
    streamVersion += 1;
    await route.fulfill({ json: { rateMinorPerKm: savedRate, streamVersion } });
  });
  await page.route("**/api/v1/horses", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], nextCursor: null, streamVersion }),
      });
      return;
    }
    if (await rejectExpiredWrite(route)) return;
    const command = route.request().postDataJSON() as {
      name: string;
      breed: string;
      dateOfBirth: string | null;
      status: string;
    };
    expect(command).toEqual({
      name: "Misty",
      breed: "Arabian",
      dateOfBirth: null,
      status: "Active",
    });
    streamVersion += 1;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ horseId: "misty-id", streamVersion }),
    });
  });

  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toBeVisible();
  const configureLink = page.getByRole("link", {
    name: "Settings",
    exact: true,
  });
  await expect(configureLink).toBeVisible();
  expired = true;
  await configureLink.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Driving rate (€/km)").fill("0.30");
  expired = true;
  await page.getByRole("button", { name: "Save driving rate" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Driving rate saved.")).toBeVisible();
  const horsesLink = page.getByRole("link", { name: "Horses", exact: true });
  await horsesLink.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Add horse" })).toBeVisible();
  await page.getByRole("button", { name: "Add horse" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /add horse/i })).toBeVisible();
  await page.getByLabel("Name").fill("Misty");
  await page.getByLabel("Breed").fill("Arabian");
  expired = true;
  await page.getByRole("button", { name: "Save horse" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText(/horse saved/i);
  expect(refreshCount).toBe(3);
  expect(rejectedWrites.size).toBe(2);
});
