import { expect, test } from "@playwright/test";
import {
  connectLocalBackend,
  ensureLocalAccountAndHorse,
} from "./localBackend";

test("an owner logs minutes without quantity fields and sees the activity summary update", async ({
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
          ? [{ taskType: "PaddockDuty", count: 1, minutes: 150 }]
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
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Quantity unit")).toHaveCount(0);
  await page.getByLabel("Minutes", { exact: true }).fill("150");
  await page.getByRole("button", { name: "Save task" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Task saved.");
  expect(logged).toMatchObject({
    horseId: "horse-a",
    taskDate: "2026-10-09",
    taskType: "PaddockDuty",
    minutes: 150,
  });
  await expect(page.getByRole("list", { name: "Recent tasks" })).toContainText(
    "Paddock Duty",
  );
  await expect(page.getByRole("list", { name: "Recent tasks" })).toContainText(
    "150 minutes",
  );
  await expect(
    page.getByRole("list", { name: "Activity summary" }),
  ).toContainText("Paddock Duty");
  await expect(page.getByText("Retired horse")).toHaveCount(0);
});

test("a real backend quick task retains its custom name and updates activity", async ({
  page,
  request,
}) => {
  const session = await connectLocalBackend(page);
  const horseName = "Backend Activity Horse";
  const owner = await ensureLocalAccountAndHorse(request, session, horseName);
  await page.goto(new URL("/tasks", session.webUrl).toString());
  await page.getByLabel("Horse", { exact: true }).selectOption(owner.horseId);
  await page.getByRole("button", { name: "New quick task" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Putzen");
  await dialog.getByLabel("Activity type").selectOption("Grooming");
  await dialog.getByLabel("Default minutes").fill("15");
  await dialog.getByRole("button", { name: "Save quick task" }).click();
  await page.getByRole("button", { name: "Putzen 15 min" }).click();
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page.getByText("Task saved.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Recent tasks" })).toContainText(
    "Putzen",
  );
  const activity = page.getByRole("list", { name: "Activity summary" });
  await expect(activity).toContainText("Grooming");
  await expect(activity).toContainText("1 tasks, 15 minutes");

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Putzen 15 min" }),
  ).toBeVisible();
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByLabel("Horse", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "New quick task" }).click();
    await expect(
      page.getByRole("dialog").getByLabel("Name", { exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "New quick task" }),
    ).toBeFocused();
    await page.screenshot({
      path: `test-results/quick-tasks-${viewport.width}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Manage quick tasks" }).click();
  await page.getByRole("button", { name: "Edit Putzen" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Putzen und Pflege");
  await page.getByRole("dialog").getByLabel("Default minutes").fill("20");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save quick task" })
    .click();
  await expect(
    page.getByRole("button", { name: "Putzen und Pflege 20 min" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete Putzen und Pflege" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Putzen und Pflege 20 min" }),
  ).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Recent tasks" })).toContainText(
    "Putzen",
  );

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
    items: {
      horseId: string;
      taskType: string;
      minutes: number;
      notes: string;
    }[];
  };
  expect(taskPage.items).toContainEqual(
    expect.objectContaining({
      horseId: owner.horseId,
      taskType: "Grooming",
      minutes: 15,
      notes: "Putzen",
    }),
  );
  const activityReport = (await report.json()) as {
    items: { taskType: string; count: number; minutes: number }[];
  };
  expect(activityReport.items).toContainEqual({
    taskType: "Grooming",
    count: 1,
    minutes: 15,
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
