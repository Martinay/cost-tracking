import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { IncomeRuleList } from "../../src/features/incomeRules/IncomeRuleList";
import type { IncomeRuleInitialValue } from "../../src/features/incomeRules/IncomeRuleForm";

const rule = {
  ruleId: "rule-monthly",
  startDate: "2026-10-01",
  effectiveFrom: "2026-11-01",
  schedule: {
    cadence: "Monthly",
    interval: 1,
    weekdays: [],
    dayOfMonth: 1,
    startDate: "2026-10-01",
    endDate: null,
  },
  defaults: {
    amountMinor: 15000,
    source: "Boarding",
    splitMode: "Equal",
    allocations: [],
  },
  revisions: [
    {
      effectiveFrom: "2026-10-01",
      schedule: {
        cadence: "Monthly",
        interval: 1,
        weekdays: [],
        dayOfMonth: 1,
        startDate: "2026-10-01",
        endDate: null,
      },
      defaults: {
        amountMinor: 10000,
        source: "Boarding",
        splitMode: "Equal",
        allocations: [],
      },
    },
    {
      effectiveFrom: "2026-11-01",
      schedule: {
        cadence: "Monthly",
        interval: 1,
        weekdays: [],
        dayOfMonth: 1,
        startDate: "2026-10-01",
        endDate: null,
      },
      defaults: {
        amountMinor: 15000,
        source: "Boarding",
        splitMode: "Equal",
        allocations: [],
      },
    },
  ],
  lastDate: null,
} satisfies IncomeRuleInitialValue;

test("shows queued income revisions and offers stop only for an active rule", async () => {
  const onRevise = vi.fn();
  const onStop = vi.fn();
  render(
    <IncomeRuleList
      rules={[rule]}
      currency="EUR"
      onRevise={onRevise}
      onStop={onStop}
    />,
  );
  expect(
    screen.getByRole("list", { name: "Revisions for Boarding" }),
  ).toHaveTextContent("2026-10-01");
  expect(
    screen.getByRole("list", { name: "Revisions for Boarding" }),
  ).toHaveTextContent("€100.00");
  expect(
    screen.getByRole("list", { name: "Revisions for Boarding" }),
  ).toHaveTextContent("2026-11-01");
  await userEvent.click(
    screen.getByRole("button", { name: "Revise income rule" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Stop income rule" }),
  );
  expect(onRevise).toHaveBeenCalledWith(rule.ruleId);
  expect(onStop).toHaveBeenCalledWith(rule.ruleId);
});
