import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { BreakdownTable } from "../../src/features/reports/BreakdownTable";
import { ActivitySummary } from "../../src/features/reports/ActivitySummary";
import { PnlTable } from "../../src/features/reports/PnlTable";

test("shows allocated category totals in an accessible comparison table", () => {
  render(
    <BreakdownTable
      kind="expense"
      currency="EUR"
      from="2026-10-01"
      to="2026-10-09"
      items={[
        { label: "Feed", amountMinor: 4200 },
        { label: "Veterinary", amountMinor: 1300 },
      ]}
      totalMinor={5500}
    />,
  );
  const table = screen.getByRole("table", { name: "Expense breakdown" });
  expect(table).toHaveTextContent("Feed");
  expect(table).toHaveTextContent("€42.00");
  expect(table).toHaveTextContent("Total");
  expect(table).toHaveTextContent("€55.00");
});

test("summarizes task counts and duration without combining quantity units", () => {
  render(
    <ActivitySummary
      from="2026-10-01"
      to="2026-10-09"
      items={[
        { taskType: "Riding", count: 2, minutes: 75 },
        { taskType: "PaddockDuty", count: 1, minutes: 0 },
      ]}
    />,
  );
  const table = screen.getByRole("table", { name: "Activity summary" });
  expect(table).toHaveTextContent("Riding");
  expect(table).toHaveTextContent("75 minutes");
  expect(table).toHaveTextContent("Paddock Duty");
  expect(table).toHaveTextContent("0 minutes");
  expect(table).not.toHaveTextContent("quantity total");
});

test("compares monthly income, expenses, and net by selected horse", () => {
  render(
    <PnlTable
      month="2026-10"
      currency="EUR"
      items={[
        {
          horseId: "horse-a",
          horseName: "Misty (Retired)",
          incomeMinor: 10000,
          expenseMinor: 2500,
          netMinor: 7500,
        },
      ]}
    />,
  );
  const table = screen.getByRole("table", { name: "Monthly profit and loss" });
  expect(table).toHaveTextContent("Misty (Retired)");
  expect(table).toHaveTextContent("€100.00");
  expect(table).toHaveTextContent("€25.00");
  expect(table).toHaveTextContent("€75.00");
  expect(screen.getByRole("link", { name: "Misty (Retired)" })).toHaveAttribute(
    "href",
    "/horses/horse-a",
  );
});
