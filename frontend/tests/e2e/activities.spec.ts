import { expect, test } from "@playwright/test";
import {
  connectLocalBackend,
  ensureLocalAccountAndHorse,
} from "./localBackend";

test("an owner logs quantity-only effort and sees the activity summary update", async ({
  page,
}) => {
  let streamVersion = 7;
  let logged: Record<string, unknown> | null = null;
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        user: { id: "owner-activity" },
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
        ownerToday: "2026-10-09",
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
          { horseId: "inactive", name: "Retired horse", status: "Retired" },
        ],
        streamVersion,
      }),
    }),
  );
  await page.route("**/api/v1/tasks**", async (route) => {
    if (route.request().method() === "POST") {
      logged = route.request().postDataJSON() as Record<string, unknown>;
      streamVersion += 1;
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: { ETag: `"${streamVersion}"` },
        body: JSON.stringify({ taskId: "task-a", streamVersion }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: logged ? [{ taskId: "task-a", ...logged, streamVersion }] : [],
        nextCursor: null,
        streamVersion,
      }),
    });
  });
  await page.route("**/api/v1/reports/activity**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: logged
          ? [{ taskType: "PaddockDuty", count: 1, minutes: 0 }]
          : [],
        streamVersion,
      }),
    }),
  );

  await page.goto("/tasks");
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Horse", { exact: true }).selectOption("horse-a");
  await page.getByLabel("Task type").selectOption("PaddockDuty");
  await page.getByRole("spinbutton", { name: "Quantity" }).fill("2.5");
  await page.getByLabel("Quantity unit").fill("hours");
  await page.getByRole("button", { name: "Save task" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Task saved.");
  expect(logged).toMatchObject({
    horseId: "horse-a",
    taskDate: "2026-10-09",
    taskType: "PaddockDuty",
    minutes: 0,
    quantity: 2.5,
    quantityUnit: "hours",
  });
  await expect(page.getByRole("list", { name: "Recent tasks" })).toContainText(
    "Paddock Duty",
  );
  await expect(page.getByRole("list", { name: "Recent tasks" })).toContainText(
    "2.5 hours",
  );
  await expect(
    page.getByRole("list", { name: "Activity summary" }),
  ).toContainText("Paddock Duty");
  await expect(page.getByText("Retired horse")).toHaveCount(0);
});

test("a real backend quantity-only task updates activity without financial balance changes", async ({
  page,
  request,
}) => {
  const session = await connectLocalBackend(page);
  const horseName = "Backend Activity Horse";
  const owner = await ensureLocalAccountAndHorse(request, session, horseName);
  await page.goto(new URL("/tasks", session.webUrl).toString());
  await page.getByLabel("Horse", { exact: true }).selectOption(owner.horseId);
  await page.getByLabel("Task type").selectOption("PaddockDuty");
  await page.getByRole("spinbutton", { name: "Quantity" }).fill("2.5");
  await page.getByLabel("Quantity unit").fill("hours");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByText("Task saved.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Recent tasks" })).toContainText(
    "2.5 hours",
  );
  const activity = page.getByRole("list", { name: "Activity summary" });
  await expect(activity).toContainText("Paddock Duty");
  await expect(activity).toContainText("1 tasks, 0 minutes");

  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const [tasks, report] = await Promise.all([
    request.get(
      new URL(
        "/api/v1/tasks?from=2026-09-01&to=2026-09-21",
        session.apiUrl,
      ).toString(),
      { headers },
    ),
    request.get(
      new URL(
        "/api/v1/reports/activity?from=2026-09-01&to=2026-09-21",
        session.apiUrl,
      ).toString(),
      { headers },
    ),
  ]);
  expect(tasks.status()).toBe(200);
  expect(report.status()).toBe(200);
  const taskPage = (await tasks.json()) as {
    items: { horseId: string; taskType: string; quantity: number }[];
  };
  expect(taskPage.items).toContainEqual(
    expect.objectContaining({
      horseId: owner.horseId,
      taskType: "PaddockDuty",
      quantity: 2.5,
    }),
  );
  const activityReport = (await report.json()) as {
    items: { taskType: string; count: number; minutes: number }[];
  };
  expect(activityReport.items).toContainEqual({
    taskType: "PaddockDuty",
    count: 1,
    minutes: 0,
  });
});

test("a horse detail activity tab shows the server-grouped work summary", async ({
  page,
}) => {
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        user: { id: "owner-activity" },
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
        ownerToday: "2026-10-09",
        streamVersion: 7,
      }),
    }),
  );
  await page.route("**/api/v1/horses/horse-a", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        horseId: "horse-a",
        name: "Misty",
        breed: "Arabian",
        dateOfBirth: null,
        status: "Active",
        streamVersion: 7,
      }),
    }),
  );
  await page.route("**/api/v1/history**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], nextCursor: null, streamVersion: 7 }),
    }),
  );
  await page.route("**/api/v1/reports/monthly-pnl**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        currency: "EUR",
        month: "2026-10",
        items: [],
        streamVersion: 7,
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
        complete: true,
        nextCursor: null,
        items: [],
        streamVersion: 7,
      }),
    }),
  );
  await page.route("**/api/v1/reports/activity**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          { taskType: "Riding", count: 2, minutes: 90 },
          { taskType: "Grooming", count: 1, minutes: 20 },
        ],
        streamVersion: 7,
      }),
    }),
  );

  await page.goto("/horses/horse-a");
  await expect(page.getByRole("heading", { name: "Misty" })).toBeVisible();
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByRole("tabpanel", { name: "Activity" })).toContainText(
    "Riding: 2 tasks, 90 minutes",
  );
  await expect(page.getByRole("tabpanel", { name: "Activity" })).toContainText(
    "Grooming: 1 tasks, 20 minutes",
  );
  await expect(page.getByRole("tab", { name: "History" })).toHaveAttribute(
    "aria-selected",
    "false",
  );
});

test("an expired task cursor offers a clean reload and hides further paging", async ({
  page,
}) => {
  let listRequests = 0;
  await page.route("**/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify({
        user: { id: "owner-activity" },
        accessToken: "memory-only",
        csrfToken: "memory-only-csrf",
      }),
    }),
  );
  await page.route("**/api/v1/account", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ownerToday: "2026-10-09", streamVersion: 8 }),
    }),
  );
  await page.route("**/api/v1/horses", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], streamVersion: 8 }),
    }),
  );
  await page.route("**/api/v1/reports/activity**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], streamVersion: 8 }),
    }),
  );
  await page.route("**/api/v1/tasks**", (route) => {
    const url = new URL(route.request().url());
    listRequests += 1;
    if (url.searchParams.has("cursor"))
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "invalid_cursor",
          message: "Task list changed. Reload tasks.",
          correlationId: "task-cursor-expired",
          streamVersion: 8,
        }),
      });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            taskId: `task-${listRequests}`,
            horseId: "horse-a",
            taskDate: "2026-10-08",
            taskType: "Riding",
            minutes: 30,
            quantity: null,
            quantityUnit: null,
            notes: "",
            streamVersion: 7,
          },
        ],
        nextCursor: listRequests === 1 ? "expired-cursor" : null,
        streamVersion: listRequests === 1 ? 7 : 8,
      }),
    });
  });
  await page.goto("/tasks");
  await expect(page.getByRole("list", { name: "Recent tasks" })).toContainText(
    "Riding",
  );
  await page.getByRole("button", { name: "Load more tasks" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Task list changed. Reload tasks.",
  );
  await expect(
    page.getByRole("button", { name: "Load more tasks" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Reload tasks" }).click();
  await expect(page.getByText("Task list changed. Reload tasks.")).toHaveCount(
    0,
  );
  expect(listRequests).toBe(3);
});
