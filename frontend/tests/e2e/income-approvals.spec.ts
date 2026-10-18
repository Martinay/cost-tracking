import { expect, test } from "@playwright/test";
import {
  connectLocalBackend,
  ensureLocalAccountAndHorse,
} from "./localBackend";

test("owner reviews a pending payment with scheduled and received dates before approving by keyboard", async ({
  page,
}) => {
  let decided = false;
  const commands: {
    path: string;
    body: unknown;
    headers: Record<string, string>;
  }[] = [];
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        user: { id: "owner-approvals" },
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
          { horseId: "horse-a", name: "Misty", status: "Active" },
          { horseId: "horse-b", name: "Comet", status: "Leased" },
        ],
        streamVersion: 9,
        nextCursor: null,
      }),
    }),
  );
  await page.route("**/api/v1/income-approvals**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: decided
          ? []
          : [
              {
                ruleId: "rule-board",
                scheduledDate: "2026-10-01",
                amountMinor: 10000,
                source: "Boarding",
                splitMode: "Equal",
                allocations: [
                  { horseId: "horse-a", weight: 500000, amountMinor: 5000 },
                  { horseId: "horse-b", weight: 500000, amountMinor: 5000 },
                ],
              },
            ],
        nextCursor: null,
        from: "2026-10-01",
        through: "2026-10-09",
        asOfDate: "2026-10-09",
        streamVersion: decided ? 10 : 9,
      }),
    }),
  );
  await page.route("**/api/v1/previews/financial", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      kind: "Income",
      values: { source: "Boarding" },
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        currency: "EUR",
        date: "2026-10-09",
        amountMinor: 10000,
        splitMode: "Equal",
        allocations: [
          { horseId: "horse-a", weight: 500000, amountMinor: 5000 },
          { horseId: "horse-b", weight: 500000, amountMinor: 5000 },
        ],
        monthlyEffect: [],
        streamVersion: 9,
      }),
    });
  });
  await page.route(
    "**/api/v1/income-rules/*/occurrences/*/approve",
    async (route) => {
      commands.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postDataJSON(),
        headers: route.request().headers(),
      });
      decided = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: '"10"' },
        body: JSON.stringify({
          ruleId: "rule-board",
          scheduledDate: "2026-10-01",
          decision: "Approved",
          realizedIncomeId: "income-rule/rule-board/2026-10-01",
          nextDueDate: null,
          streamVersion: 10,
        }),
      });
    },
  );

  await page.goto("/approvals");
  const card = page.getByRole("article", { name: "Boarding" });
  await expect(card).toContainText("Scheduled date: 2026-10-01");
  await expect(card).toContainText("Pending");
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await approve.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Approval preview" }),
  ).toContainText("€100.00");
  const confirm = page.getByRole("button", { name: "Confirm approval" });
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]?.body).toEqual({
    receivedDate: "2026-10-09",
    amountMinor: 10000,
    split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
  });
  expect(commands[0]?.headers["idempotency-key"]).toBeTruthy();
  await expect(
    page.getByText("No pending payments in this window."),
  ).toBeVisible();
});

test("the inbox can load earlier pages and recover from an oversized date window", async ({
  page,
}) => {
  const windows: string[] = [];
  let wideWindowAttempts = 0;
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: "owner-approval-window" },
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
        streamVersion: 9,
      }),
    }),
  );
  await page.route("**/api/v1/horses", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], nextCursor: null, streamVersion: 9 }),
    }),
  );
  await page.route("**/api/v1/income-approvals**", (route) => {
    const url = new URL(route.request().url());
    const from = url.searchParams.get("from") ?? "";
    windows.push(from);
    if (from === "2020-10-01") {
      wideWindowAttempts += 1;
      return route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          code: "occurrence_window_too_large",
          message: "Choose a shorter window.",
          correlationId: "wide-window",
        }),
      });
    }
    if (url.searchParams.get("cursor") === "page-3")
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "cursor_expired",
          message: "This inbox cursor expired.",
          correlationId: "approval-cursor",
          streamVersion: 10,
        }),
      });
    const olderPage = url.searchParams.get("cursor") === "page-2";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            ruleId: olderPage ? "rule-earlier" : "rule-first",
            scheduledDate: olderPage ? "2026-09-30" : "2026-10-02",
            amountMinor: 10000,
            source: olderPage ? "Earlier payment" : "First payment",
            splitMode: "Equal",
            allocations: [],
          },
        ],
        nextCursor: olderPage ? "page-3" : "page-2",
        from,
        through: "2026-10-09",
        asOfDate: "2026-10-09",
        streamVersion: 9,
      }),
    });
  });

  await page.goto("/approvals");
  await expect(
    page.getByRole("article", { name: "First payment" }),
  ).toBeVisible();
  await page.getByLabel("Scheduled dates from").fill("2026-10-08");
  await expect(
    page.getByRole("button", { name: "Earlier pending payments" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Earlier pending payments" }).click();
  await expect(
    page.getByRole("article", { name: "First payment" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load more pending payments" })
    .click();
  await expect(
    page.getByRole("article", { name: "Earlier payment" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load more pending payments" })
    .click();
  await expect(page.getByRole("alert")).toContainText("cursor expired");
  await page.getByRole("button", { name: "Restart this window" }).click();
  await expect(
    page.getByRole("article", { name: "First payment" }),
  ).toBeVisible();

  await page.getByLabel("Scheduled dates from").fill("2020-10-01");
  const oversized = page.getByRole("alert");
  await expect(oversized).toContainText("Choose a shorter window");
  await expect(oversized).toContainText("choose a later start date");
  await page.getByRole("button", { name: "Restart this window" }).click();
  await expect.poll(() => wideWindowAttempts).toBe(2);
  expect(windows).toContain("2026-09-01");
});

test("a real backend recurring income rule creates pending payments and approval realizes one", async ({
  page,
  request,
}) => {
  const session = await connectLocalBackend(page);
  const apiUrl = session.apiUrl;
  const webUrl = session.webUrl;
  const accessToken = session.accessToken;
  const authorization = { Authorization: `Bearer ${accessToken}` };
  const horseName = "Browser Test Horse";
  const owner = await ensureLocalAccountAndHorse(request, session, horseName);

  await page.goto(webUrl!);
  await page.getByRole("link", { name: "Income" }).click();
  await expect(page.getByTestId("ledger-ready")).toBeVisible();
  await page
    .getByRole("button", { name: "Create recurring income rule" })
    .click();
  await page.getByLabel("Cadence").selectOption("Daily");
  await page.getByLabel("Start date").fill("2026-09-19");
  await page.getByLabel("Amount").fill("100.00");
  await page.getByLabel("Source").fill("Browser lesson");
  await page.getByLabel(horseName).check();
  await page
    .getByRole("button", { name: "Preview example occurrence" })
    .click();
  await expect(
    page.getByRole("region", { name: "Example occurrence" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create income rule" }).click();
  await expect(page.getByText("Income rule created.")).toBeVisible();

  await page.getByRole("link", { name: "Approvals" }).click();
  const pending = page.getByRole("region", { name: "Pending payments" });
  await expect(pending).toContainText("Browser lesson");
  await expect(pending).toContainText("Scheduled date: 2026-09-19");
  const firstPayment = page
    .getByRole("article")
    .filter({ hasText: "Scheduled date: 2026-09-19" });
  await firstPayment
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm approval" }).click();
  await expect(pending).not.toContainText("Scheduled date: 2026-09-19");
  const editedPayment = page
    .getByRole("article")
    .filter({ hasText: "Scheduled date: 2026-09-20" });
  await editedPayment.getByRole("button", { name: "Edit and approve" }).click();
  await editedPayment.getByLabel("Actual amount").fill("150.00");
  await editedPayment.getByRole("button", { name: "Preview approval" }).click();
  await expect(
    editedPayment.getByRole("region", { name: "Approval preview" }),
  ).toContainText("€150.00");
  await editedPayment.getByRole("button", { name: "Confirm approval" }).click();
  await expect(pending).not.toContainText("Scheduled date: 2026-09-20");
  const rejectedPayment = page
    .getByRole("article")
    .filter({ hasText: "Scheduled date: 2026-09-21" });
  await rejectedPayment.getByRole("button", { name: "Reject" }).click();
  const rejectionResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/reject") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm rejection" }).click();
  const rejectionResponse = await rejectionResponsePromise;
  expect(rejectionResponse.status()).toBe(200);
  const freshApprovals = await request.get(
    new URL(
      "/api/v1/income-approvals?from=2026-09-19&through=2026-09-21",
      apiUrl!,
    ).toString(),
    { headers: authorization },
  );
  expect(freshApprovals.status()).toBe(200);
  const pendingAfterRejection = (await freshApprovals.json()) as {
    items: { scheduledDate: string }[];
  };
  expect(pendingAfterRejection.items).not.toContainEqual(
    expect.objectContaining({ scheduledDate: "2026-09-21" }),
  );
  await expect(
    page.getByText("No pending payments in this window."),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Pending payments" }),
  ).toHaveCount(0);

  const realized = await request.get(
    new URL("/api/v1/income?from=2026-09-19&to=2026-09-21", apiUrl!).toString(),
    { headers: authorization },
  );
  expect(realized.status()).toBe(200);
  const ledger = (await realized.json()) as {
    items: {
      source: string;
      amountMinor: number;
      allocations: { horseId: string; amountMinor: number }[];
    }[];
  };
  expect(ledger.items).toHaveLength(2);
  expect(ledger.items).toContainEqual(
    expect.objectContaining({
      source: "Browser lesson",
      amountMinor: 10000,
      allocations: [
        expect.objectContaining({
          horseId: owner.horseId,
          amountMinor: 10000,
        }),
      ],
    }),
  );
  expect(ledger.items).toContainEqual(
    expect.objectContaining({
      source: "Browser lesson",
      amountMinor: 15000,
      allocations: [
        expect.objectContaining({
          horseId: owner.horseId,
          amountMinor: 15000,
        }),
      ],
    }),
  );

  await page.getByRole("link", { name: "Income" }).click();
  await page.getByRole("button", { name: "Revise income rule" }).click();
  await page.getByLabel("Effective from (future date)").fill("2026-09-22");
  await page.getByLabel("Amount").fill("125.00");
  await page.getByLabel("Source").fill("Revised lesson");
  await page
    .getByRole("button", { name: "Preview example occurrence" })
    .click();
  await expect(
    page.getByRole("region", { name: "Example occurrence" }),
  ).toContainText("2026-09-22");
  await page.getByRole("button", { name: "Save income rule revision" }).click();
  await expect(page.getByText("Income rule revision saved.")).toBeVisible();
  await page.getByRole("button", { name: "Stop income rule" }).click();
  await page.getByLabel("Last date (inclusive)").fill("2026-09-22");
  await page.getByRole("button", { name: "Confirm stop" }).click();
  await expect(page.getByText("Income rule stopped.")).toBeVisible();

  const rules = await request.get(
    new URL("/api/v1/income-rules", apiUrl!).toString(),
    { headers: authorization },
  );
  expect(rules.status()).toBe(200);
  const ruleList = (await rules.json()) as {
    items: {
      startDate: string;
      lastDate: string;
      revisions: { effectiveFrom: string }[];
    }[];
  };
  expect(ruleList.items).toHaveLength(1);
  expect(ruleList.items[0].startDate).toBe("2026-09-19");
  expect(ruleList.items[0].lastDate).toBe("2026-09-22");
  expect(ruleList.items[0].revisions).toHaveLength(2);
  expect(ruleList.items[0].revisions[1].effectiveFrom).toBe("2026-09-22");
});

test("two approval tabs resolve a concurrent decision without a false success", async ({
  browser,
  page,
  request,
}) => {
  const session = await connectLocalBackend(page);
  const source = `Concurrent lesson ${crypto.randomUUID()}`;
  const owner = await ensureLocalAccountAndHorse(
    request,
    session,
    `Concurrent horse ${crypto.randomUUID()}`,
  );
  const authorization = { Authorization: `Bearer ${session.accessToken}` };
  const accountResponse = await request.get(
    new URL("/api/v1/account", session.apiUrl).toString(),
    { headers: authorization },
  );
  expect(accountResponse.status()).toBe(200);
  const account = (await accountResponse.json()) as {
    ownerToday: string;
    streamVersion: number;
  };
  const createdRule = await request.post(
    new URL("/api/v1/income-rules", session.apiUrl).toString(),
    {
      headers: {
        ...authorization,
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
        "If-Match": `"${account.streamVersion}"`,
      },
      data: {
        schedule: {
          cadence: "Daily",
          interval: 1,
          weekdays: [],
          dayOfMonth: null,
          startDate: account.ownerToday,
          endDate: account.ownerToday,
        },
        amountMinor: 7900,
        source,
        split: { mode: "Equal", horseIds: [owner.horseId] },
      },
    },
  );
  expect(createdRule.status()).toBe(201);
  const rule = (await createdRule.json()) as { ruleId: string };
  const scheduleDate = account.ownerToday;

  const secondContext = await browser.newContext();
  try {
    const secondPage = await secondContext.newPage();
    const secondSession = await connectLocalBackend(secondPage);
    expect(secondSession.subject).toBe(session.subject);
    let firstInboxGets = 0;
    let secondInboxGets = 0;
    const wasInboxGet = (response: {
      url(): string;
      request(): { method(): string };
    }) =>
      response.request().method() === "GET" &&
      response.url().includes("/api/v1/income-approvals");
    page.on("response", (response) => {
      if (wasInboxGet(response)) firstInboxGets += 1;
    });
    secondPage.on("response", (response) => {
      if (wasInboxGet(response)) secondInboxGets += 1;
    });

    await Promise.all([
      page.goto(new URL("/approvals", session.webUrl).toString()),
      secondPage.goto(new URL("/approvals", session.webUrl).toString()),
    ]);
    const firstCard = page.getByRole("article", { name: source });
    const secondCard = secondPage.getByRole("article", { name: source });
    await expect(firstCard).toContainText(`Scheduled date: ${scheduleDate}`);
    await expect(secondCard).toContainText(`Scheduled date: ${scheduleDate}`);
    const firstInitialInboxGets = firstInboxGets;
    const secondInitialInboxGets = secondInboxGets;

    await Promise.all([
      firstCard.getByRole("button", { name: "Approve", exact: true }).click(),
      secondCard.getByRole("button", { name: "Approve", exact: true }).click(),
    ]);
    await Promise.all([
      expect(
        page.getByRole("region", { name: "Approval preview" }),
      ).toBeVisible(),
      expect(
        secondPage.getByRole("region", { name: "Approval preview" }),
      ).toBeVisible(),
    ]);

    const approvalPost = (response: {
      url(): string;
      request(): { method(): string };
    }) =>
      response.request().method() === "POST" &&
      response.url().includes(`/occurrences/${scheduleDate}/approve`);
    const firstDecision = page.waitForResponse(approvalPost);
    const secondDecision = secondPage.waitForResponse(approvalPost);
    await Promise.all([
      page.getByRole("button", { name: "Confirm approval" }).click(),
      secondPage.getByRole("button", { name: "Confirm approval" }).click(),
    ]);
    const [firstResponse, secondResponse] = await Promise.all([
      firstDecision,
      secondDecision,
    ]);
    expect([firstResponse.status(), secondResponse.status()].sort()).toEqual([
      200, 409,
    ]);
    const losingPage = firstResponse.status() === 409 ? page : secondPage;
    const losingRefetchSeen = () =>
      firstResponse.status() === 409
        ? firstInboxGets > firstInitialInboxGets
        : secondInboxGets > secondInitialInboxGets;
    await expect(
      losingPage.getByText("No pending payments in this window."),
    ).toBeVisible();
    expect(losingRefetchSeen()).toBe(true);
    await expect(losingPage.getByRole("status")).toHaveText(
      "This payment was already processed in another tab. The inbox has been refreshed.",
    );
    await expect(losingPage.getByText("Approval saved.")).toHaveCount(0);

    const finalInbox = await request.get(
      new URL(
        `/api/v1/income-approvals?from=${scheduleDate}&through=${scheduleDate}`,
        session.apiUrl,
      ).toString(),
      { headers: authorization },
    );
    expect(finalInbox.status()).toBe(200);
    expect((await finalInbox.json()).items).toHaveLength(0);
    const realized = await request.get(
      new URL(
        `/api/v1/income?from=${scheduleDate}&to=${scheduleDate}`,
        session.apiUrl,
      ).toString(),
      { headers: authorization },
    );
    expect(realized.status()).toBe(200);
    const realizedRows = (await realized.json()).items as {
      source: string;
      amountMinor: number;
    }[];
    expect(realizedRows.filter((row) => row.source === source)).toHaveLength(1);
    expect(realizedRows).toContainEqual(
      expect.objectContaining({ source, amountMinor: 7900 }),
    );
    expect(rule.ruleId).toBeTruthy();
  } finally {
    await secondContext.close();
  }
});
