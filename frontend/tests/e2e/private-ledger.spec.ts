import { expect, test } from "@playwright/test";
import {
  connectLocalBackend,
  ensureLocalAccountAndHorse,
} from "./localBackend";

const apiBaseUrl = process.env.VITE_API_BASE_URL ?? "";

test("a signed-out owner can reach the hosted sign-in handoff by keyboard", async ({
  page,
  request,
}) => {
  const fixtureApi = process.env.E2E_API_URL;
  expect(
    fixtureApi,
    "E2E_API_URL must be supplied by scripts/run-e2e.mjs",
  ).toBeTruthy();
  const health = await request.get(
    new URL("/__fixture/health", fixtureApi).toString(),
  );
  await expect(health).toBeOK();
  expect(await health.json()).toEqual({ ready: true });

  await page.route("**/auth/session", (route) =>
    route.fulfill({ status: 401, body: "" }),
  );
  await page.route("**/auth/login?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<main><h1>Hosted sign-in handoff</h1></main>",
    }),
  );
  await page.goto("/");

  const signIn = page.getByRole("link", { name: "Sign in" });
  await expect(signIn).toHaveAttribute(
    "href",
    `${apiBaseUrl}/auth/login?returnTo=%2Fhorses`,
  );
  await signIn.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Hosted sign-in handoff" }),
  ).toBeVisible();
});

test("a first-time owner can configure an account and add a horse by keyboard", async ({
  page,
}) => {
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        user: { id: "owner-first-use" },
        accessToken: "memory-only-test-token",
        expiresAt: "2026-10-08T18:00:00Z",
        csrfToken: "memory-only-csrf",
      }),
    }),
  );
  let configured = false;
  let streamVersion = 0;
  await page.route("**/api/v1/account", async (route) => {
    if (route.request().method() === "PUT") {
      const command = route.request().postDataJSON() as {
        currency: string;
        timeZone: string;
      };
      expect(command).toEqual({ currency: "EUR", timeZone: "Europe/Berlin" });
      configured = true;
      streamVersion += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: `"${streamVersion}"` },
        body: JSON.stringify({
          ...command,
          streamVersion,
          drivingRateMinorPerKm: null,
          settingsLocked: false,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: `"${streamVersion}"` },
      body: JSON.stringify({
        currency: configured ? "EUR" : null,
        timeZone: configured ? "Europe/Berlin" : null,
        streamVersion,
        drivingRateMinorPerKm: null,
        settingsLocked: false,
      }),
    });
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
  const configureLink = page.getByRole("link", { name: "Configure settings" });
  await expect(configureLink).toBeVisible();
  await configureLink.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Currency").selectOption("EUR");
  await page.getByLabel("Time zone").fill("Europe/Berlin");
  await page.getByRole("button", { name: "Save settings" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Account settings saved.")).toBeVisible();
  const horsesLink = page.getByRole("link", { name: "Horses", exact: true });
  await horsesLink.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Add horse" })).toBeVisible();
  await page.getByRole("button", { name: "Add horse" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /add horse/i })).toBeVisible();
  await page.getByLabel("Name").fill("Misty");
  await page.getByLabel("Breed").fill("Arabian");
  await page.getByRole("button", { name: "Save horse" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText(/horse saved/i);
});

test("a horse owner previews and records an exact split expense by keyboard", async ({
  page,
}) => {
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        user: { id: "owner-ledger" },
        accessToken: "memory-only",
        csrfToken: "memory-only-csrf",
      }),
    }),
  );
  await page.route("**/api/v1/account", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: '"4"' },
      body: JSON.stringify({
        currency: "EUR",
        timeZone: "Europe/Berlin",
        ownerToday: "2026-09-21",
        streamVersion: 4,
        settingsLocked: false,
      }),
    }),
  );
  await page.route("**/api/v1/horses", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            horseId: "horse-a",
            name: "Misty",
            breed: "Arabian",
            dateOfBirth: null,
            status: "Active",
            streamVersion: 4,
          },
          {
            horseId: "horse-b",
            name: "Comet",
            breed: "Warmblood",
            dateOfBirth: null,
            status: "Leased",
            streamVersion: 4,
          },
          {
            horseId: "horse-c",
            name: "Retired horse",
            breed: "",
            dateOfBirth: null,
            status: "Retired",
            streamVersion: 4,
          },
        ],
        nextCursor: null,
        streamVersion: 4,
      }),
    }),
  );
  await page.route("**/api/v1/expenses?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], nextCursor: null, streamVersion: 4 }),
    }),
  );
  await page.route("**/api/v1/previews/financial", async (route) => {
    const body = route.request().postDataJSON() as {
      kind: string;
      values: { amountMinor: number };
    };
    expect(body).toMatchObject({
      kind: "Expense",
      values: { amountMinor: 1001 },
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: '"4"' },
      body: JSON.stringify({
        currency: "EUR",
        date: "2026-09-21",
        amountMinor: 1001,
        splitMode: "Equal",
        streamVersion: 4,
        allocations: [
          { horseId: "horse-a", weight: 500000, amountMinor: 501 },
          { horseId: "horse-b", weight: 500000, amountMinor: 500 },
        ],
        monthlyEffect: [],
      }),
    });
  });
  await page.route("**/api/v1/expenses", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({
      expenseDate: "2026-09-21",
      amountMinor: 1001,
      category: "Veterinary",
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { ETag: '"5"' },
      body: JSON.stringify({
        expenseId: "expense-a",
        streamVersion: 5,
        allocations: [
          { horseId: "horse-a", weight: 500000, amountMinor: 501 },
          { horseId: "horse-b", weight: 500000, amountMinor: 500 },
        ],
      }),
    });
  });
  await page.route("**/api/v1/history**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], nextCursor: null, streamVersion: 5 }),
    }),
  );

  await page.goto("/expenses");
  await expect(
    page.getByRole("heading", { name: "Expenses", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Record expense" }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Expense date").fill("2026-09-21");
  await page.getByLabel("Amount").fill("10.01");
  await page.getByLabel("Category").selectOption("Veterinary");
  await page.getByLabel("Description").fill("Clinic visit");
  await page.getByLabel("Misty").check();
  await page.getByLabel("Comet").check();
  await page.getByRole("button", { name: "Preview expense" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Misty: €5.01")).toBeVisible();
  await expect(page.getByText("Comet: €5.00")).toBeVisible();
  await expect(page.getByLabel("Retired horse")).toBeDisabled();
  await page.getByRole("button", { name: "Save expense" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Expense saved.")).toBeVisible();
});

test("a real backend expense preview, commit, and report reconcile to one horse", async ({
  page,
  request,
}) => {
  const session = await connectLocalBackend(page);
  const horseName = "Backend Ledger Horse";
  const owner = await ensureLocalAccountAndHorse(request, session, horseName);
  await page.goto(new URL("/expenses", session.webUrl).toString());
  await page.getByRole("button", { name: "Record expense" }).click();
  await page.getByLabel("Expense date").fill("2026-09-21");
  await page.getByLabel("Amount").fill("17.25");
  await page.getByLabel("Category").selectOption("Feed");
  await page.getByLabel("Description").fill("Real backend hay order");
  await page.getByLabel(horseName).check();
  await page.getByRole("button", { name: "Preview expense" }).click();
  const preview = page.getByRole("region", { name: "Expense preview" });
  await expect(preview).toContainText("€17.25");
  await expect(preview).toContainText(horseName);
  await page.getByRole("button", { name: "Save expense" }).click();
  await expect(page.getByText("Expense saved.")).toBeVisible();

  const expenses = await request.get(
    new URL(
      "/api/v1/expenses?from=2026-09-21&to=2026-09-21",
      session.apiUrl,
    ).toString(),
    { headers: { Authorization: `Bearer ${session.accessToken}` } },
  );
  expect(expenses.status()).toBe(200);
  const ledger = (await expenses.json()) as {
    items: {
      category: string;
      description: string;
      amountMinor: number;
      allocations: { horseId: string; amountMinor: number }[];
    }[];
  };
  expect(ledger.items).toContainEqual(
    expect.objectContaining({
      category: "Feed",
      description: "Real backend hay order",
      amountMinor: 1725,
      allocations: [
        expect.objectContaining({ horseId: owner.horseId, amountMinor: 1725 }),
      ],
    }),
  );

  const authorization = { Authorization: `Bearer ${session.accessToken}` };
  const accountUrl = new URL("/api/v1/account", session.apiUrl).toString();
  const accountBeforeIncome = await request.get(accountUrl, {
    headers: authorization,
  });
  expect(accountBeforeIncome.status()).toBe(200);
  const incomeVersion = (
    (await accountBeforeIncome.json()) as { streamVersion: number }
  ).streamVersion;
  const income = await request.post(
    new URL("/api/v1/income", session.apiUrl).toString(),
    {
      headers: {
        ...authorization,
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
        "If-Match": `"${incomeVersion}"`,
      },
      data: {
        receivedDate: "2026-09-21",
        amountMinor: 5000,
        source: "Browser lesson",
        split: { mode: "Equal", horseIds: [owner.horseId] },
      },
    },
  );
  expect(income.status()).toBe(201);

  const accountBeforeTask = await request.get(accountUrl, {
    headers: authorization,
  });
  const taskVersion = (
    (await accountBeforeTask.json()) as { streamVersion: number }
  ).streamVersion;
  const task = await request.post(
    new URL("/api/v1/tasks", session.apiUrl).toString(),
    {
      headers: {
        ...authorization,
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
        "If-Match": `"${taskVersion}"`,
      },
      data: {
        horseId: owner.horseId,
        taskDate: "2026-09-21",
        taskType: "PaddockDuty",
        minutes: 45,
        quantity: null,
        quantityUnit: null,
        notes: "",
      },
    },
  );
  expect(task.status()).toBe(201);

  await page.goto(new URL("/reports", session.webUrl).toString());
  await expect(page.getByTestId("report-ready")).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Monthly profit and loss" }),
  ).toContainText(horseName);
  await expect(
    page.getByRole("table", { name: "Monthly profit and loss" }),
  ).toContainText("€17.25");
  await expect(
    page.getByRole("table", { name: "Expense breakdown" }),
  ).toContainText("Feed");
  await expect(
    page.getByRole("table", { name: "Income breakdown" }),
  ).toContainText("Browser lesson");
  await expect(
    page.getByRole("table", { name: "Activity summary" }),
  ).toContainText("Paddock Duty");
  const loadRemainingLifetime = page.getByRole("button", {
    name: "Load remaining lifetime results",
  });
  if (await loadRemainingLifetime.isVisible())
    await loadRemainingLifetime.click();
  await expect(
    page.getByRole("table", { name: "Lifetime totals" }),
  ).toContainText("€17.25");
});

test("an owner can review complete monthly and lifetime reports", async ({
  page,
}) => {
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        user: { id: "owner-report" },
        accessToken: "memory-only",
        csrfToken: "memory-only-csrf",
      }),
    }),
  );
  await page.route("**/api/v1/account", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        currency: "EUR",
        timeZone: "Europe/Berlin",
        ownerToday: "2026-09-21",
        streamVersion: 9,
      }),
    }),
  );
  await page.route("**/api/v1/horses", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          { horseId: "retired", name: "Misty", status: "Retired" },
          { horseId: "sold", name: "Comet", status: "Sold" },
        ],
        streamVersion: 9,
      }),
    }),
  );
  await page.route("**/api/v1/reports/monthly-pnl?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        currency: "EUR",
        month: "2026-09",
        streamVersion: 9,
        items: [
          {
            horseId: "retired",
            incomeMinor: 10000,
            expenseMinor: 4000,
            netMinor: 6000,
          },
          {
            horseId: "sold",
            incomeMinor: 20000,
            expenseMinor: 8000,
            netMinor: 12000,
          },
        ],
      }),
    }),
  );
  await page.route("**/api/v1/reports/lifetime?**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        cursor
          ? {
              currency: "EUR",
              asOfDate: "2026-09-21",
              streamVersion: 9,
              complete: true,
              nextCursor: null,
              items: [
                {
                  horseId: "sold",
                  incomeMinor: 20000,
                  expenseMinor: 8000,
                  netMinor: 12000,
                },
              ],
            }
          : {
              currency: "EUR",
              asOfDate: "2026-09-21",
              streamVersion: 9,
              complete: false,
              nextCursor: "batch-2",
              items: [
                {
                  horseId: "retired",
                  incomeMinor: 10000,
                  expenseMinor: 4000,
                  netMinor: 6000,
                },
              ],
            },
      ),
    });
  });
  await page.goto("/reports");
  await expect(
    page.getByRole("heading", { name: "Financial reports" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Misty (Retired)" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Comet (Sold)" })).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Lifetime totals" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Load remaining lifetime results" })
    .click();
  const totals = page.getByRole("table", { name: "Lifetime totals" });
  await expect(totals).toBeVisible();
  await expect(totals).toContainText("Through 2026-09-21");
  await expect(totals).toContainText("€300.00");
  await expect(totals).toContainText("€120.00");
  await expect(totals).toContainText("€180.00");
});
