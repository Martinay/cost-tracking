import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ExpenseRuleForm } from "../../src/features/expenseRules/ExpenseRuleForm";

const horses = [
  { horseId: "horse-a", name: "Misty", status: "Active" as const },
  { horseId: "horse-b", name: "Comet", status: "Leased" as const },
];

const examplePreview = {
  currency: "EUR",
  date: "2026-10-12",
  amountMinor: 4800,
  splitMode: "Equal",
  allocations: [
    { horseId: "horse-a", weight: 500000, amountMinor: 2400 },
    { horseId: "horse-b", weight: 500000, amountMinor: 2400 },
  ],
  monthlyEffect: [],
  streamVersion: 12,
};

describe("recurring expense rule form", () => {
  test("previews server example allocation and creates only after review", async () => {
    const onPreview = vi.fn().mockResolvedValue(examplePreview);
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <ExpenseRuleForm
        today="2026-10-09"
        currency="EUR"
        horses={horses}
        onPreview={onPreview}
        onCreate={onCreate}
      />,
    );

    await userEvent.type(screen.getByLabelText("Start date"), "2026-10-12");
    await userEvent.type(
      screen.getByLabelText("End date (inclusive)"),
      "2026-12-31",
    );
    await userEvent.selectOptions(screen.getByLabelText("Cadence"), "Weekly");
    await userEvent.type(screen.getByLabelText("Amount"), "48.00");
    await userEvent.type(screen.getByLabelText("Category"), "Feed");
    await userEvent.type(screen.getByLabelText("Description"), "Hay delivery");
    await userEvent.click(screen.getByLabelText("Misty"));
    await userEvent.click(screen.getByLabelText("Comet"));
    await userEvent.click(
      screen.getByRole("button", { name: "Preview example occurrence" }),
    );

    const preview = await screen.findByRole("region", {
      name: "Example occurrence",
    });
    expect(within(preview).getByText(/€48\.00/)).toBeInTheDocument();
    expect(within(preview).getByText(/Misty.*€24\.00/)).toBeInTheDocument();
    expect(within(preview).getByText(/Comet.*€24\.00/)).toBeInTheDocument();
    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 4800,
        category: "Feed",
        description: "Hay delivery",
        expenseDate: "2026-10-12",
        split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
      }),
    );
    expect(onCreate).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "Create expense rule" }),
    );
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: expect.objectContaining({
          startDate: "2026-10-12",
          endDate: "2026-12-31",
        }),
        amountMinor: 4800,
      }),
    );
  });

  test("does not calculate recurrence dates and validates inclusive bounds through clear feedback", async () => {
    const onPreview = vi.fn().mockResolvedValue(examplePreview);
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <ExpenseRuleForm
        today="2026-10-09"
        currency="EUR"
        horses={horses}
        onPreview={onPreview}
        onCreate={onCreate}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Create expense rule" }),
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  test("queues a revision only from a future effective date and keeps the original anchor", async () => {
    const onRevise = vi.fn().mockResolvedValue(undefined);
    const onPreview = vi.fn().mockResolvedValue(examplePreview);
    render(
      <ExpenseRuleForm
        today="2026-10-09"
        currency="EUR"
        horses={horses}
        initialRule={{
          ruleId: "rule-a",
          startDate: "2026-09-21",
          effectiveFrom: "2026-09-21",
          schedule: {
            cadence: "Weekly",
            interval: 1,
            weekdays: [],
            dayOfMonth: null,
            startDate: "2026-09-21",
            endDate: null,
          },
          defaults: {
            amountMinor: 4800,
            category: "Feed",
            description: "Weekly hay",
            splitMode: "Equal",
            allocations: [
              { horseId: "horse-a", weight: 500000, amountMinor: 2400 },
              { horseId: "horse-b", weight: 500000, amountMinor: 2400 },
            ],
          },
          revisions: [],
          lastDate: null,
        }}
        onPreview={onPreview}
        onCreate={vi.fn().mockResolvedValue(undefined)}
        onRevise={onRevise}
      />,
    );

    expect(screen.getByLabelText("Start date")).toHaveValue("2026-09-21");
    await userEvent.clear(
      screen.getByLabelText("Effective from (future date)"),
    );
    await userEvent.type(
      screen.getByLabelText("Effective from (future date)"),
      "2026-10-26",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Preview example occurrence" }),
    );
    await screen.findByRole("region", { name: "Example occurrence" });
    await userEvent.click(
      screen.getByRole("button", { name: "Save rule revision" }),
    );
    expect(onRevise).toHaveBeenCalledWith(
      expect.objectContaining({
        effectiveFrom: "2026-10-26",
        schedule: expect.objectContaining({ startDate: "2026-09-21" }),
      }),
    );
  });

  test("selected weekdays serialize canonical ISO days with interval one", async () => {
    const onPreview = vi.fn().mockResolvedValue(examplePreview);
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <ExpenseRuleForm
        today="2026-10-09"
        currency="EUR"
        horses={horses}
        onPreview={onPreview}
        onCreate={onCreate}
      />,
    );
    await userEvent.type(screen.getByLabelText("Start date"), "2026-10-12");
    await userEvent.type(screen.getByLabelText("Amount"), "48.00");
    await userEvent.type(screen.getByLabelText("Category"), "Feed");
    await userEvent.type(
      screen.getByLabelText("Description"),
      "Weekday delivery",
    );
    await userEvent.click(screen.getByLabelText("Misty"));
    await userEvent.clear(screen.getByLabelText("Interval"));
    await userEvent.type(screen.getByLabelText("Interval"), "3");
    await userEvent.selectOptions(screen.getByLabelText("Cadence"), "Weekdays");
    await userEvent.click(screen.getByLabelText("Monday"));
    await userEvent.click(screen.getByLabelText("Thursday"));
    await userEvent.click(
      screen.getByRole("button", { name: "Preview example occurrence" }),
    );
    await screen.findByRole("region", { name: "Example occurrence" });
    await userEvent.click(
      screen.getByRole("button", { name: "Create expense rule" }),
    );
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: {
          cadence: "Weekdays",
          interval: 1,
          weekdays: [1, 4],
          dayOfMonth: null,
          startDate: "2026-10-12",
          endDate: null,
        },
      }),
    );
  });
});
