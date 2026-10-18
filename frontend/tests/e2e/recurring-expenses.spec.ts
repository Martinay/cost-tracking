import { expect, test } from "@playwright/test";
import {
  connectLocalBackend,
  ensureLocalAccountAndHorse,
} from "./localBackend";

test("an owner creates and revises a recurring expense, changes one date, skips then restores another, and stops inclusively", async ({
  page,
}) => {
  let streamVersion = 12;
  const ruleId = "rule-weekly-feed";
  const ruleCommands: { method: string; url: string; body: unknown }[] = [];
  const occurrenceCommands: { url: string; body: unknown }[] = [];
  let rule: Record<string, unknown> | null = null;
  const overrides = new Map<
    string,
    { action: "Changed" | "Skipped"; changed: unknown }
  >();

  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        user: { id: "owner-recurring" },
        accessToken: "memory-only",
        csrfToken: "memory-only",
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
        settingsLocked: false,
        streamVersion,
      }),
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
        ],
        nextCursor: null,
        streamVersion,
      }),
    }),
  );
  await page.route("**/api/v1/expense-rules**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: rule ? [rule] : [],
          nextCursor: null,
          streamVersion,
        }),
      });
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    ruleCommands.push({ method: request.method(), url: url.pathname, body });
    streamVersion += 1;
    if (
      request.method() === "POST" &&
      url.pathname === "/api/v1/expense-rules"
    ) {
      rule = {
        ruleId,
        startDate: (body.schedule as { startDate: string }).startDate,
        effectiveFrom: (body.schedule as { startDate: string }).startDate,
        schedule: body.schedule,
        defaults: {
          amountMinor: body.amountMinor,
          category: body.category,
          description: body.description,
          splitMode: "Equal",
          allocations: [
            { horseId: "horse-a", weight: 500000, amountMinor: 2400 },
            { horseId: "horse-b", weight: 500000, amountMinor: 2400 },
          ],
        },
        revisions: [],
        lastDate: null,
      };
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: { ETag: `"${streamVersion}"` },
        body: JSON.stringify({ ruleId, streamVersion }),
      });
    }
    if (request.method() === "PATCH") {
      rule = {
        ...rule!,
        schedule: body.schedule,
        effectiveFrom: body.effectiveFrom,
        revisions: [
          {
            ...body,
            defaults: {
              amountMinor: body.amountMinor,
              category: body.category,
              description: body.description,
              splitMode: "Equal",
              allocations: [],
            },
          },
        ],
      };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: `"${streamVersion}"` },
        body: JSON.stringify({ ruleId, streamVersion }),
      });
    }
    if (url.pathname.endsWith("/stop")) {
      rule = { ...rule!, lastDate: body.lastDate };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: `"${streamVersion}"` },
        body: JSON.stringify({
          ruleId,
          lastDate: body.lastDate,
          streamVersion,
        }),
      });
    }
    throw new Error(
      `Unexpected recurring rule command: ${request.method()} ${url.pathname}`,
    );
  });
  await page.route("**/api/v1/previews/financial", async (route) => {
    const body = route.request().postDataJSON() as {
      kind: string;
      scheduledDate?: string;
      values: Record<string, unknown>;
    };
    if (body.kind === "Expense") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          currency: "EUR",
          date: "2026-10-12",
          amountMinor: 4800,
          splitMode: "Equal",
          allocations: [
            { horseId: "horse-a", weight: 500000, amountMinor: 2400 },
            { horseId: "horse-b", weight: 500000, amountMinor: 2400 },
          ],
          monthlyEffect: [],
          streamVersion,
        }),
      });
    }
    expect(body.kind).toBe("ExpenseOccurrenceChange");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        currency: "EUR",
        date: body.scheduledDate,
        amountMinor:
          body.values.action === "Skipped"
            ? 4800
            : (body.values.changed as { amountMinor: number }).amountMinor,
        splitMode: "Equal",
        allocations: [
          { horseId: "horse-a", weight: 500000, amountMinor: 2400 },
          { horseId: "horse-b", weight: 500000, amountMinor: 2400 },
        ],
        monthlyEffect: [
          {
            month: "2026-10",
            horseId: "horse-a",
            incomeDeltaMinor: 0,
            expenseDeltaMinor: body.values.action === "Skipped" ? -2400 : 1500,
            netDeltaMinor: 0,
          },
        ],
        streamVersion,
      }),
    });
  });
  await page.route("**/api/v1/expense-rules/*/occurrences/*", async (route) => {
    const body = route.request().postDataJSON() as {
      action: "Changed" | "Skipped";
      changed: unknown;
    };
    occurrenceCommands.push({
      url: new URL(route.request().url()).pathname,
      body,
    });
    overrides.set(
      new URL(route.request().url()).pathname.split("/").at(-1)!,
      body,
    );
    streamVersion += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: `"${streamVersion}"` },
      body: JSON.stringify({
        ruleId,
        scheduledDate: "2026-10-12",
        action: body.action,
        streamVersion,
      }),
    });
  });
  await page.route("**/api/v1/expenses?**", (route) => {
    const base = ["2026-10-12", "2026-10-15", "2026-10-19"].map(
      (scheduledDate, index) => {
        const override = overrides.get(scheduledDate);
        const changed = override?.changed as
          | { amountMinor: number; category: string; description: string }
          | null
          | undefined;
        return {
          id: `expense-rule/${ruleId}/${scheduledDate}`,
          expenseDate: scheduledDate,
          scheduledDate,
          ruleId,
          origin: "Recurring",
          occurrenceState: override?.action ?? "Computed",
          skipped: override?.action === "Skipped",
          amountMinor: changed?.amountMinor ?? 4800,
          category: changed?.category ?? "Feed",
          description: changed?.description ?? `Weekly delivery ${index + 1}`,
          splitMode: "Equal",
          allocations: [],
          contributionMinor:
            override?.action === "Skipped" ? 0 : (changed?.amountMinor ?? 4800),
        };
      },
    );
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: rule ? base : [],
        nextCursor: null,
        streamVersion,
      }),
    });
  });

  await page.goto("/expenses");
  await page.getByRole("button", { name: "Create recurring rule" }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Start date").fill("2026-10-12");
  await page.getByLabel("End date (inclusive)").fill("2026-12-31");
  await page.getByLabel("Cadence").selectOption("Weekly");
  await page.getByLabel("Amount").fill("48.00");
  await page.getByLabel("Category").fill("Feed");
  await page.getByLabel("Description").fill("Weekly delivery");
  await page.getByLabel("Misty").check();
  await page.getByLabel("Comet").check();
  await page
    .getByRole("button", { name: "Preview example occurrence" })
    .click();
  await expect(
    page.getByRole("region", { name: "Example occurrence" }),
  ).toContainText("€48.00");
  await page.getByRole("button", { name: "Create expense rule" }).click();
  await expect(page.getByText("Weekly delivery 1")).toBeVisible();
  expect(ruleCommands[0]?.body).toMatchObject({
    amountMinor: 4800,
    category: "Feed",
    schedule: {
      cadence: "Weekly",
      interval: 1,
      startDate: "2026-10-12",
      endDate: "2026-12-31",
    },
  });

  await page.getByRole("button", { name: /Change.*2026-10-12/ }).click();
  await page.getByLabel("Amount").fill("63.00");
  await page.getByLabel("Category").fill("Veterinary");
  await page.getByLabel("Description").fill("Urgent visit");
  await page.getByRole("button", { name: "Preview change" }).click();
  await expect(
    page.getByRole("region", { name: "Occurrence preview" }),
  ).toContainText("€63.00");
  await page.getByRole("button", { name: "Save occurrence change" }).click();
  expect(occurrenceCommands.at(-1)?.body).toEqual({
    action: "Changed",
    changed: {
      amountMinor: 6300,
      category: "Veterinary",
      description: "Urgent visit",
      split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
    },
  });
  await expect(page.getByText("Changed")).toBeVisible();

  await page.getByRole("button", { name: /Skip.*2026-10-15/ }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Skip this occurrence" }).click();
  await expect(
    page.getByRole("region", { name: "Occurrence preview" }),
  ).toContainText("€48.00");
  await page.getByRole("button", { name: "Save occurrence change" }).click();
  expect(occurrenceCommands.at(-1)?.body).toEqual({
    action: "Skipped",
    changed: null,
  });
  await expect(page.getByText("Skipped")).toBeVisible();
  await expect(page.getByText(/Contribution: €0\.00/)).toBeVisible();

  await page.getByRole("button", { name: /Restore.*2026-10-15/ }).click();
  await page
    .getByRole("button", { name: "Restore occurrence", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Occurrence preview" }),
  ).toContainText("€48.00");
  expect(occurrenceCommands).toHaveLength(2);
  await page.getByRole("button", { name: "Save occurrence change" }).click();
  expect(occurrenceCommands.at(-1)?.body).toEqual({
    action: "Changed",
    changed: {
      amountMinor: 4800,
      category: "Feed",
      description: "Weekly delivery",
      split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
    },
  });

  await page.getByRole("button", { name: "Revise recurring rule" }).click();
  await page.getByLabel("Effective from (future date)").fill("2026-10-26");
  await page
    .getByRole("button", { name: "Preview example occurrence" })
    .click();
  await expect(
    page.getByRole("region", { name: "Example occurrence" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save rule revision" }).click();
  expect(ruleCommands.at(-1)?.method).toBe("PATCH");
  expect(ruleCommands.at(-1)?.body).toMatchObject({
    effectiveFrom: "2026-10-26",
  });
  await page.getByRole("button", { name: "Stop recurring rule" }).click();
  await page.getByLabel("Last date (inclusive)").fill("2026-12-31");
  await page.getByRole("button", { name: "Confirm stop" }).click();
  expect(ruleCommands.at(-1)?.url).toBe(`/api/v1/expense-rules/${ruleId}/stop`);
  expect(ruleCommands.at(-1)?.body).toEqual({ lastDate: "2026-12-31" });
});

test("a real backend expense rule projects occurrences and persists change, skip, restore, revision, and stop", async ({
  page,
  request,
}) => {
  const session = await connectLocalBackend(page);
  const horseName = "Backend Recurrence Horse";
  const owner = await ensureLocalAccountAndHorse(request, session, horseName);
  await page.goto(new URL("/expenses", session.webUrl).toString());
  await page.getByRole("button", { name: "Create recurring rule" }).click();
  await page.getByLabel("Start date").fill("2026-09-20");
  await page.getByLabel("Cadence").selectOption("Daily");
  await page.getByLabel("Amount").fill("48.00");
  await page.getByLabel("Category").fill("Feed");
  await page.getByLabel("Description").fill("Backend hay delivery");
  await page.getByLabel(horseName).check();
  await page
    .getByRole("button", { name: "Preview example occurrence" })
    .click();
  await expect(
    page.getByRole("region", { name: "Example occurrence" }),
  ).toContainText("€48.00");
  await page.getByRole("button", { name: "Create expense rule" }).click();

  await expect(
    page.getByRole("button", { name: "Skip occurrence 2026-09-21" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Change occurrence 2026-09-20" })
    .click();
  await page.getByLabel("Amount").fill("63.00");
  await page.getByLabel("Category").fill("Veterinary");
  await page.getByLabel("Description").fill("Backend urgent visit");
  await page.getByRole("button", { name: "Preview change" }).click();
  await expect(
    page.getByRole("region", { name: "Occurrence preview" }),
  ).toContainText("€63.00");
  await page.getByRole("button", { name: "Save occurrence change" }).click();
  await expect(page.getByText("Changed")).toBeVisible();

  await page
    .getByRole("button", { name: "Skip occurrence 2026-09-21" })
    .click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Skip this occurrence" }).click();
  await page.getByRole("button", { name: "Save occurrence change" }).click();
  await expect(page.getByText("Skipped")).toBeVisible();
  await expect(page.getByText(/Contribution: €0\.00/)).toBeVisible();

  await page
    .getByRole("button", { name: "Restore occurrence 2026-09-21" })
    .click();
  await page
    .getByRole("button", { name: "Restore occurrence", exact: true })
    .click();
  await page.getByRole("button", { name: "Save occurrence change" }).click();
  await expect(page.getByText("Changed")).toBeVisible();

  await page.getByRole("button", { name: "Revise recurring rule" }).click();
  await page.getByLabel("Effective from (future date)").fill("2026-09-22");
  await page
    .getByRole("form", { name: "Recurring expense rule form" })
    .getByLabel("Amount")
    .fill("55.00");
  await page
    .getByRole("button", { name: "Preview example occurrence" })
    .click();
  await expect(
    page.getByRole("region", { name: "Example occurrence" }),
  ).toContainText("2026-09-22");
  await page.getByRole("button", { name: "Save rule revision" }).click();
  await expect(page.getByText("Expense rule revision saved.")).toBeVisible();

  await page.getByRole("button", { name: "Stop recurring rule" }).click();
  await page.getByLabel("Last date (inclusive)").fill("2026-09-22");
  await page.getByRole("button", { name: "Confirm stop" }).click();
  await expect(page.getByText("Expense rule stopped.")).toBeVisible();

  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const rules = await request.get(
    new URL("/api/v1/expense-rules", session.apiUrl).toString(),
    { headers },
  );
  expect(rules.status()).toBe(200);
  const ruleList = (await rules.json()) as {
    items: {
      ruleId: string;
      startDate: string;
      lastDate: string;
      revisions: { effectiveFrom: string }[];
    }[];
  };
  const rule = ruleList.items.find((item) => item.startDate === "2026-09-20");
  expect(rule).toBeDefined();
  expect(rule?.lastDate).toBe("2026-09-22");
  expect(rule?.revisions).toHaveLength(2);
  const occurrences = await request.get(
    new URL(
      "/api/v1/expenses?from=2026-09-20&to=2026-09-22",
      session.apiUrl,
    ).toString(),
    { headers },
  );
  expect(occurrences.status()).toBe(200);
  const rows = (await occurrences.json()) as {
    items: {
      scheduledDate: string;
      occurrenceState: string;
      amountMinor: number;
      allocations: { horseId: string }[];
    }[];
  };
  expect(rows.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        scheduledDate: "2026-09-20",
        occurrenceState: "Changed",
        amountMinor: 6300,
        allocations: [expect.objectContaining({ horseId: owner.horseId })],
      }),
      expect.objectContaining({
        scheduledDate: "2026-09-21",
        occurrenceState: "Changed",
        amountMinor: 4800,
      }),
      expect.objectContaining({
        scheduledDate: "2026-09-22",
        amountMinor: 5500,
      }),
    ]),
  );
});
