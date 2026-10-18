import { expect, test } from "@playwright/test";
import {
  connectLocalBackend,
  ensureLocalAccountAndHorse,
} from "./localBackend";

test("saved rate can clear on currency change, driving retries the exact preview, and receipt provenance remains fixed", async ({
  page,
}) => {
  let currency = "EUR";
  let rate: number | null = 30;
  let streamVersion = 6;
  let settingsLocked = false;
  let drivingAttempts = 0;
  let recorded = false;
  const drivingCalls: {
    body: unknown;
    idempotency: string | null;
    ifMatch: string | null;
  }[] = [];

  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        user: { id: "owner-driving" },
        accessToken: "memory-only",
        csrfToken: "memory-only-csrf",
      }),
    }),
  );
  await page.route("**/api/v1/account", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        currency: string;
        timeZone: string;
      };
      currency = body.currency;
      rate = null;
      streamVersion += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: `"${streamVersion}"` },
        body: JSON.stringify({
          currency,
          timeZone: body.timeZone,
          ownerToday: "2026-10-09",
          drivingRateMinorPerKm: rate,
          settingsLocked,
          streamVersion,
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: `"${streamVersion}"` },
      body: JSON.stringify({
        currency,
        timeZone: "Europe/Berlin",
        ownerToday: "2026-10-09",
        drivingRateMinorPerKm: rate,
        settingsLocked,
        streamVersion,
      }),
    });
  });
  await page.route("**/api/v1/driving-rate", async (route) => {
    const requestBody = route.request().postDataJSON() as {
      rateMinorPerKm: number;
    };
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["if-match"]).toBe(`"${streamVersion}"`);
    rate = requestBody.rateMinorPerKm;
    streamVersion += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: `"${streamVersion}"` },
      body: JSON.stringify({ rateMinorPerKm: rate, streamVersion }),
    });
  });
  await page.route("**/api/v1/history**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], nextCursor: null, streamVersion }),
    }),
  );
  await page.route("**/api/v1/horses", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          { horseId: "horse-a", name: "Misty", status: "Active" },
          { horseId: "horse-b", name: "Comet", status: "Leased" },
          {
            horseId: "horse-retired",
            name: "Retired horse",
            status: "Retired",
          },
        ],
        streamVersion,
      }),
    }),
  );
  await page.route("**/api/v1/previews/financial", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      kind: "Driving",
      values: {
        expenseDate: "2026-10-09",
        kilometers: 10.125,
        description: "Arena trip",
        split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
      },
    });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        currency,
        date: "2026-10-09",
        amountMinor: 314,
        splitMode: "Equal",
        streamVersion,
        driving: { kilometers: 10.125, rateMinorPerKm: 31 },
        allocations: [
          { horseId: "horse-a", weight: 500000, amountMinor: 157 },
          { horseId: "horse-b", weight: 500000, amountMinor: 157 },
        ],
        monthlyEffect: [],
      }),
    });
  });
  await page.route("**/api/v1/driving", async (route) => {
    const body = route.request().postDataJSON();
    drivingAttempts += 1;
    drivingCalls.push({
      body,
      idempotency: route.request().headers()["idempotency-key"] ?? null,
      ifMatch: route.request().headers()["if-match"] ?? null,
    });
    if (drivingAttempts === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "temporarily_unavailable",
          message: "Connection interrupted.",
          correlationId: "drive-retry",
        }),
      });
    recorded = true;
    settingsLocked = true;
    streamVersion += 1;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { ETag: `"${streamVersion}"` },
      body: JSON.stringify({
        expenseId: "driving-receipt",
        amountMinor: 314,
        allocations: [
          { horseId: "horse-a", weight: 500000, amountMinor: 157 },
          { horseId: "horse-b", weight: 500000, amountMinor: 157 },
        ],
        streamVersion,
      }),
    });
  });
  await page.route("**/api/v1/expenses?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: recorded
          ? [
              {
                id: "driving-receipt",
                expenseDate: "2026-10-09",
                amountMinor: 314,
                category: "Driving",
                description: "Arena trip",
                splitMode: "Equal",
                allocations: [
                  { horseId: "horse-a", weight: 500000, amountMinor: 157 },
                  { horseId: "horse-b", weight: 500000, amountMinor: 157 },
                ],
                driving: { kilometers: 10.125, rateMinorPerKm: 31 },
                contributionMinor: 314,
              },
            ]
          : [],
        nextCursor: null,
        streamVersion,
      }),
    }),
  );

  await page.goto("/settings");
  await page.getByLabel("Currency").selectOption("USD");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("No saved driving rate.")).toBeVisible();
  await page.getByLabel("Driving rate (minor units per km)").fill("31");
  await page.getByRole("button", { name: "Save driving rate" }).click();
  await expect(
    page.getByText("Current saved rate: 31.0000 minor units/km"),
  ).toBeVisible();

  await page.goto("/expenses");
  await page.getByRole("button", { name: "Record driving expense" }).click();
  await page.getByLabel("Distance (km)").fill("10.125");
  await page.getByLabel("Description").fill("Arena trip");
  await page.getByLabel("Misty").check();
  await page.getByLabel("Comet").check();
  await page.getByRole("button", { name: "Preview driving expense" }).click();
  const preview = page.getByRole("region", { name: "Driving expense preview" });
  await expect(preview).toContainText("31.0000 minor units/km");
  await expect(preview).toContainText("$3.14");
  await expect(preview).toContainText("Misty: $1.57");
  await expect(preview).toContainText("Comet: $1.57");
  await page.getByRole("button", { name: "Save driving expense" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Connection interrupted.",
  );
  await page.getByRole("button", { name: "Save driving expense" }).click();
  await expect(page.getByRole("status")).toHaveText("Driving expense saved.");
  expect(drivingCalls).toHaveLength(2);
  expect(drivingCalls[0].body).toEqual({
    expenseDate: "2026-10-09",
    kilometers: 10.125,
    rateMinorPerKm: 31,
    description: "Arena trip",
    split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
  });
  expect(drivingCalls[1]).toEqual(drivingCalls[0]);
  expect(drivingCalls[0].idempotency).toBeTruthy();
  expect(drivingCalls[0].ifMatch).toBe('"8"');

  await page.goto("/settings");
  await expect(
    page.getByText("Current saved rate: 31.0000 minor units/km"),
  ).toBeVisible();
  await page.getByLabel("Driving rate (minor units per km)").fill("40");
  await page.getByRole("button", { name: "Save driving rate" }).click();
  await expect(
    page.getByText("Current saved rate: 40.0000 minor units/km"),
  ).toBeVisible();
  await page.goto("/expenses");
  await expect(
    page.getByRole("list", { name: "Expense ledger" }),
  ).toContainText("10.125 km at 31.0000 minor units/km");
});

test("a real backend saved driving rate produces a persisted attributed trip", async ({
  page,
  request,
}) => {
  const session = await connectLocalBackend(page);
  const horseName = "Backend Driving Horse";
  const owner = await ensureLocalAccountAndHorse(request, session, horseName);
  await page.goto(new URL("/settings", session.webUrl).toString());
  await page.getByLabel("Driving rate (minor units per km)").fill("31");
  await page.getByRole("button", { name: "Save driving rate" }).click();
  await expect(page.getByText("Driving rate saved.")).toBeVisible();

  await page.goto(new URL("/expenses", session.webUrl).toString());
  await page.getByRole("button", { name: "Record driving expense" }).click();
  await page.getByLabel("Distance (km)").fill("10");
  await page.getByLabel("Description").fill("Backend arena trip");
  await page.getByLabel(horseName).check();
  await page.getByRole("button", { name: "Preview driving expense" }).click();
  const preview = page.getByRole("region", { name: "Driving expense preview" });
  await expect(preview).toContainText("31.0000 minor units/km");
  await expect(preview).toContainText("€3.10");
  await page.getByRole("button", { name: "Save driving expense" }).click();
  await expect(page.getByText("Driving expense saved.")).toBeVisible();

  const expenses = await request.get(
    new URL(
      "/api/v1/expenses?from=2026-09-21&to=2026-09-21",
      session.apiUrl,
    ).toString(),
    { headers: { Authorization: `Bearer ${session.accessToken}` } },
  );
  expect(expenses.status()).toBe(200);
  const result = (await expenses.json()) as {
    items: {
      description: string;
      amountMinor: number;
      category: string;
      driving: { kilometers: number; rateMinorPerKm: number } | null;
      allocations: { horseId: string; amountMinor: number }[];
    }[];
  };
  expect(result.items).toContainEqual(
    expect.objectContaining({
      description: "Backend arena trip",
      amountMinor: 310,
      category: "Driving",
      driving: { kilometers: 10, rateMinorPerKm: 31 },
      allocations: [
        expect.objectContaining({ horseId: owner.horseId, amountMinor: 310 }),
      ],
    }),
  );

  await page.goto(new URL("/settings", session.webUrl).toString());
  await page.getByLabel("Driving rate (minor units per km)").fill("40");
  await page.getByRole("button", { name: "Save driving rate" }).click();
  await expect(page.getByText("Driving rate saved.")).toBeVisible();
  await page.goto(new URL("/expenses", session.webUrl).toString());
  await expect(
    page.getByRole("list", { name: "Expense ledger" }),
  ).toContainText("10 km at 31.0000 minor units/km");

  const history = await request.get(
    new URL(
      `/api/v1/history?horseId=${encodeURIComponent(owner.horseId)}`,
      session.apiUrl,
    ).toString(),
    { headers: { Authorization: `Bearer ${session.accessToken}` } },
  );
  expect(history.status()).toBe(200);
  const historyPage = (await history.json()) as {
    items: {
      summary: string;
      changes: {
        description?: string;
        driving?: { kilometers: number; rateMinorPerKm: number } | null;
      };
    }[];
  };
  expect(historyPage.items).toContainEqual(
    expect.objectContaining({
      summary: "Expense recorded",
      changes: expect.objectContaining({
        description: "Backend arena trip",
        driving: { kilometers: 10, rateMinorPerKm: 31 },
      }),
    }),
  );
});
