import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { IncomeRuleForm } from "../../src/features/incomeRules/IncomeRuleForm";

const horses = [
  { horseId: "horse-a", name: "Misty", status: "Active" as const },
  { horseId: "horse-b", name: "Comet", status: "Leased" as const },
];

test("previews an example income occurrence before saving a recurring rule", async () => {
  const onPreview = vi.fn().mockResolvedValue({
    currency: "EUR",
    date: "2026-10-09",
    amountMinor: 12000,
    splitMode: "Equal",
    allocations: [
      { horseId: "horse-a", weight: 500000, amountMinor: 6000 },
      { horseId: "horse-b", weight: 500000, amountMinor: 6000 },
    ],
    monthlyEffect: [],
    streamVersion: 9,
  });
  const onCreate = vi.fn().mockResolvedValue(undefined);
  render(
    <IncomeRuleForm
      currency="EUR"
      today="2026-10-09"
      horses={horses}
      onPreview={onPreview}
      onCreate={onCreate}
    />,
  );

  await userEvent.selectOptions(screen.getByLabelText("Cadence"), "Weekly");
  await userEvent.type(screen.getByLabelText("Start date"), "2026-10-12");
  await userEvent.type(screen.getByLabelText("Amount"), "120.00");
  await userEvent.type(screen.getByLabelText("Source"), "Boarding");
  await userEvent.click(screen.getByLabelText("Misty"));
  await userEvent.click(screen.getByLabelText("Comet"));
  await userEvent.click(
    screen.getByRole("button", { name: "Preview example occurrence" }),
  );
  expect(
    await screen.findByRole("region", { name: "Example occurrence" }),
  ).toHaveTextContent("€120.00");
  expect(onPreview).toHaveBeenCalledWith({
    kind: "Income",
    exampleOccurrence: true,
    values: {
      receivedDate: "2026-10-12",
      amountMinor: 12000,
      source: "Boarding",
      split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
    },
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Create income rule" }),
  );
  expect(onCreate).toHaveBeenCalledWith({
    schedule: {
      cadence: "Weekly",
      interval: 1,
      weekdays: [],
      dayOfMonth: null,
      startDate: "2026-10-12",
      endDate: null,
    },
    amountMinor: 12000,
    source: "Boarding",
    split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
  });
});

test("queues a future revision while keeping the rule's original cadence anchor", async () => {
  const onPreview = vi.fn().mockResolvedValue({
    currency: "EUR",
    date: "2026-11-01",
    amountMinor: 15000,
    splitMode: "Equal",
    allocations: [{ horseId: "horse-a", weight: 1000000, amountMinor: 15000 }],
    monthlyEffect: [],
    streamVersion: 10,
  });
  const onRevise = vi.fn().mockResolvedValue(undefined);
  render(
    <IncomeRuleForm
      currency="EUR"
      horses={horses}
      initialRule={{
        ruleId: "rule-monthly",
        startDate: "2026-10-01",
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
          allocations: [
            { horseId: "horse-a", weight: 500000, amountMinor: 5000 },
            { horseId: "horse-b", weight: 500000, amountMinor: 5000 },
          ],
        },
        revisions: [],
        lastDate: null,
      }}
      today="2026-10-09"
      onPreview={onPreview}
      onCreate={vi.fn().mockResolvedValue(undefined)}
      onRevise={onRevise}
    />,
  );
  await userEvent.type(
    screen.getByLabelText("Effective from (future date)"),
    "2026-11-01",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Preview example occurrence" }),
  );
  await screen.findByRole("region", { name: "Example occurrence" });
  await userEvent.click(
    screen.getByRole("button", { name: "Save income rule revision" }),
  );
  expect(onRevise).toHaveBeenCalledWith({
    effectiveFrom: "2026-11-01",
    schedule: {
      cadence: "Monthly",
      interval: 1,
      weekdays: [],
      dayOfMonth: 1,
      startDate: "2026-10-01",
      endDate: null,
    },
    amountMinor: 10000,
    source: "Boarding",
    split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
  });
});
