import { expect, test } from "@playwright/test";
import {
  connectLocalBackend,
  ensureLocalAccountAndHorse,
} from "./localBackend";

test("remediation: exact entries, consecutive tasks, corrections, partial balances and phone/keyboard recovery", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const session = await connectLocalBackend(page);
  const luna = await ensureLocalAccountAndHorse(
    request,
    session,
    "Remediation Luna",
  );
  const maja = await ensureLocalAccountAndHorse(
    request,
    session,
    "Remediation Maja",
  );
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  const api = (path: string) => new URL(path, session.apiUrl).toString();
  const account = await (
    await request.get(api("/api/v1/account"), { headers })
  ).json();
  const today = account.ownerToday as string;
  async function command(path: string, data: unknown) {
    const current = await (
      await request.get(api("/api/v1/account"), { headers })
    ).json();
    const response = await request.post(api(path), {
      headers: {
        ...headers,
        "If-Match": `"${current.streamVersion}"`,
        "Idempotency-Key": crypto.randomUUID(),
      },
      data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return await response.json();
  }
  const current = await (
    await request.get(api("/api/v1/account"), { headers })
  ).json();
  expect(
    (
      await request.put(api(`/api/v1/horses/${maja.horseId}/status`), {
        headers: {
          ...headers,
          "If-Match": `"${current.streamVersion}"`,
          "Idempotency-Key": crypto.randomUUID(),
        },
        data: { status: "Retired" },
      })
    ).ok(),
  ).toBeTruthy();
  const taskStatuses: number[] = [];
  page.on("response", (r) => {
    if (
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/v1/tasks"
    )
      taskStatuses.push(r.status());
  });
  await page.goto("/tasks");
  for (const [horse, minutes, notes] of [
    [luna.horseId, "45", "Remediation ride"],
    [maja.horseId, "15", "Retired care"],
  ]) {
    await page.getByLabel("Horse", { exact: true }).selectOption(horse);
    await page.getByLabel("Minutes", { exact: true }).fill(minutes);
    await page.getByLabel("Notes", { exact: true }).fill(notes);
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(page.getByText("Task saved.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Minutes", { exact: true })).toBeEmpty();
  }
  await page.getByLabel("Horse", { exact: true }).selectOption(luna.horseId);
  await page.getByLabel("Task type").selectOption("PaddockDuty");
  await page.getByLabel("Quantity", { exact: true }).fill("3");
  await page.getByLabel("Quantity unit", { exact: true }).fill("paddocks");
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await expect(page.getByText("Task saved.", { exact: true })).toBeVisible();
  expect(taskStatuses).toEqual([201, 201, 201]);
  await expect(
    page.getByRole("list", { name: "Activity summary", exact: true }),
  ).toContainText("3 paddocks");
  const taskRow = page
    .getByRole("list", { name: "Recent tasks", exact: true })
    .locator("li")
    .filter({ hasText: "Remediation ride" });
  await taskRow
    .getByRole("button", { name: "Correct task", exact: true })
    .click();
  const taskDialog = page.getByRole("dialog");
  await taskDialog.getByLabel("Reason for correction").fill("Timer correction");
  await taskDialog.getByLabel("Minutes", { exact: true }).fill("30");
  await taskDialog
    .getByRole("button", { name: "Save task", exact: true })
    .click();
  await expect(taskDialog).toHaveCount(0);
  await expect(taskRow).toContainText("30 minutes");
  await page.goto("/expenses");
  await page
    .getByRole("button", { name: "Record expense", exact: true })
    .click();
  await expect(page.getByLabel("Expense date")).toBeFocused();
  await page.getByLabel("Amount", { exact: true }).fill("60");
  await page.getByLabel("Category", { exact: true }).selectOption("Feed");
  await page.getByLabel("Description", { exact: true }).fill("Remediation hay");
  await page.getByLabel("Remediation Luna", { exact: true }).check();
  await page.getByLabel("Remediation Maja", { exact: true }).check();
  await page.getByLabel("Allocation", { exact: true }).selectOption("Custom");
  await page.getByLabel("Share for Remediation Luna").fill("2");
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Reports", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Expenses", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Record expense", exact: true })
    .click();
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue("60");
  await expect(
    page.getByRole("region", { name: "Expense preview", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Preview expense", exact: true })
    .click();
  const preview = page.getByRole("region", {
    name: "Expense preview",
    exact: true,
  });
  await expect(preview).toContainText("Remediation Luna: €40.00");
  await expect(preview).toContainText("Remediation Maja: €20.00");
  await preview
    .getByRole("button", { name: "Save expense", exact: true })
    .click();
  await expect(page.getByText("Expense saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel entry", exact: true }).click();
  const expenseRow = page
    .getByRole("list", { name: "Expense ledger", exact: true })
    .locator("li")
    .filter({
      has: page.getByRole("heading", { name: "Remediation hay", exact: true }),
    });
  await expenseRow
    .getByRole("button", { name: "Correct entry", exact: true })
    .click();
  const correction = page.getByRole("dialog");
  await correction.getByLabel("Reason for correction").fill("Correct bill");
  await correction.getByLabel("Amount", { exact: true }).fill("90");
  await correction.getByRole("button", { name: "Preview correction" }).click();
  await expect(
    correction.getByRole("region", { name: "Correction preview" }),
  ).toContainText("€90.00");
  await correction.getByRole("button", { name: "Save correction" }).click();
  await expect(correction).toHaveCount(0);
  await expect(expenseRow).toContainText("€90.00");
  await page
    .getByRole("button", { name: "Record driving expense", exact: true })
    .click();
  await page.getByLabel("Distance (km)").fill("24");
  await page.getByLabel("Rate per km (€/km, optional)").fill("0.30");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Remediation trip");
  await page.getByLabel("Remediation Luna", { exact: true }).check();
  await page
    .getByRole("button", { name: "Preview driving expense", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Driving expense preview" }),
  ).toContainText("€7.20");
  await page
    .getByRole("button", { name: "Save driving expense", exact: true })
    .click();
  await expect(
    page.getByText("Driving expense saved.", { exact: true }),
  ).toBeVisible();
  await command("/api/v1/income-rules", {
    schedule: {
      cadence: "Daily",
      interval: 1,
      weekdays: [],
      dayOfMonth: null,
      startDate: today,
      endDate: today,
    },
    amountMinor: 15000,
    source: "Remediation share",
    split: { mode: "Equal", horseIds: [luna.horseId] },
  });
  await page.goto("/approvals");
  const payment = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Remediation share",
      exact: true,
    }),
  });
  await payment
    .getByLabel("Partial receipt — keep the unpaid balance pending")
    .check();
  await payment.getByRole("button", { name: "Edit and approve" }).click();
  await payment.getByLabel("Actual amount").fill("140");
  await payment.getByRole("button", { name: "Preview approval" }).click();
  await payment.getByRole("button", { name: "Confirm approval" }).click();
  await expect(payment).toContainText("€10.00");
  await expect(
    page.getByRole("region", { name: "Payment decision history" }),
  ).toContainText("Partial");
  await payment.getByRole("button", { name: "Edit and approve" }).click();
  await expect(payment.getByLabel("Actual amount")).toHaveValue("10.00");
  await payment.getByRole("button", { name: "Preview approval" }).click();
  await payment.getByRole("button", { name: "Confirm approval" }).click();
  await expect(payment).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "View payment decision" }),
  ).toBeVisible();
  await page.goto("/reports");
  await page.getByLabel("Horse filter").selectOption(luna.horseId);
  await expect(
    page.getByRole("table", { name: "Monthly profit and loss", exact: true }),
  ).toBeVisible();
  for (const width of [1440, 680, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const name of [
      "Horses",
      "Expenses",
      "Income",
      "Approvals",
      "Tasks",
      "Reports",
      "Settings",
    ])
      await expect(
        page
          .getByRole("navigation", { name: "Primary navigation" })
          .getByRole("link", { name, exact: true }),
      ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
    await expect(
      page.getByRole("region", { name: "Monthly overall result" }),
    ).toBeVisible();
    await page.screenshot({
      path: `../specs/005-usability-remediation/validation/reports-${width}.png`,
      fullPage: true,
    });
  }
  const tableRegion = page.getByRole("region", {
    name: /Monthly profit and loss table/,
  });
  await tableRegion.focus();
  await page.keyboard.press("ArrowRight");
  await expect(tableRegion).toBeFocused();
  await page
    .getByRole("link", { name: "View expenses for this month", exact: true })
    .click();
  await expect(page.getByLabel("Horse filter")).toHaveValue(luna.horseId);
  await expect(page.getByLabel("Ledger month")).toHaveValue(today.slice(0, 7));
  const correctionTrigger = page
    .getByRole("list", { name: "Expense ledger", exact: true })
    .locator("li")
    .filter({
      has: page.getByRole("heading", { name: "Remediation hay", exact: true }),
    })
    .getByRole("button", { name: "Correct entry", exact: true });
  await correctionTrigger.click();
  await expect(
    page.getByRole("dialog").getByLabel("Date", { exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("dialog").getByLabel("Share for Remediation Luna"),
  ).toHaveValue("66.6667");
  await page.screenshot({
    path: "../specs/005-usability-remediation/validation/correction-390.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "../specs/005-usability-remediation/validation/correction-1440.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(correctionTrigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/expenses?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        code: "storage_unavailable",
        message: "Try again.",
        correlationId: "synthetic",
      }),
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Retry expenses" }),
  ).toBeVisible({ timeout: 15000 });
  await page.screenshot({
    path: "../specs/005-usability-remediation/validation/error-390.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "../specs/005-usability-remediation/validation/error-1440.png",
    fullPage: true,
  });
  await page.goto("/income?month=2025-01");
  await expect(page.getByText("No income this month.")).toBeVisible();
  await page.screenshot({
    path: "../specs/005-usability-remediation/validation/empty-1440.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../specs/005-usability-remediation/validation/empty-390.png",
    fullPage: true,
  });
});
