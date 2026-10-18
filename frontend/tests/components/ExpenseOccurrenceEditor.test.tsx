import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ExpenseOccurrenceEditor } from "../../src/features/expenseRules/ExpenseOccurrenceEditor";

const baseline = {
  amountMinor: 4800,
  category: "Feed",
  description: "Weekly hay",
  split: { mode: "Equal" as const, horseIds: ["horse-a", "horse-b"] },
};

const changed = {
  amountMinor: 6300,
  category: "Veterinary",
  description: "Urgent visit",
  split: { mode: "Equal" as const, horseIds: ["horse-a", "horse-b"] },
};
const horses = [
  { horseId: "horse-a", name: "Misty", status: "Active" as const },
  { horseId: "horse-b", name: "Comet", status: "Leased" as const },
];

const changePreview = {
  currency: "EUR",
  date: "2026-10-12",
  amountMinor: 6300,
  splitMode: "Equal",
  allocations: [
    { horseId: "horse-a", weight: 500000, amountMinor: 3150 },
    { horseId: "horse-b", weight: 500000, amountMinor: 3150 },
  ],
  monthlyEffect: [
    {
      month: "2026-10",
      horseId: "horse-a",
      incomeDeltaMinor: 0,
      expenseDeltaMinor: 750,
      netDeltaMinor: -750,
    },
  ],
  streamVersion: 18,
};

describe("recurring expense occurrence editor", () => {
  test("previews exact changed values and displays the server delta before saving", async () => {
    const onPreview = vi.fn().mockResolvedValue(changePreview);
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ExpenseOccurrenceEditor
        ruleId="rule-a"
        scheduledDate="2026-10-12"
        currency="EUR"
        defaults={baseline}
        horses={horses}
        current={{ action: "Changed", changed }}
        onPreview={onPreview}
        onSave={onSave}
      />,
    );

    expect(screen.getByLabelText("Amount")).toHaveValue(63);
    expect(screen.getByLabelText("Category")).toHaveValue("Veterinary");
    expect(screen.getByLabelText("Description")).toHaveValue("Urgent visit");
    await userEvent.click(
      screen.getByRole("button", { name: "Preview change" }),
    );
    const preview = await screen.findByRole("region", {
      name: "Occurrence preview",
    });
    expect(
      within(preview).getByText(/expense change.*€7\.50/i),
    ).toBeInTheDocument();
    expect(onPreview).toHaveBeenCalledWith({
      kind: "ExpenseOccurrenceChange",
      ruleId: "rule-a",
      scheduledDate: "2026-10-12",
      values: { action: "Changed", changed },
    });
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "Save occurrence change" }),
    );
    expect(onSave).toHaveBeenCalledWith({ action: "Changed", changed });
  });

  test("confirms Skip and keeps the scheduled display value while contribution delta comes from server", async () => {
    const onPreview = vi.fn().mockResolvedValue({
      ...changePreview,
      amountMinor: 4800,
      monthlyEffect: [
        {
          ...changePreview.monthlyEffect[0],
          expenseDeltaMinor: -2400,
          netDeltaMinor: 2400,
        },
      ],
    });
    const onSave = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <ExpenseOccurrenceEditor
        ruleId="rule-a"
        scheduledDate="2026-10-12"
        currency="EUR"
        defaults={baseline}
        horses={horses}
        current={{ action: null, changed: null }}
        onPreview={onPreview}
        onSave={onSave}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Skip this occurrence" }),
    );
    expect(confirm).toHaveBeenCalled();
    expect(onPreview).toHaveBeenCalledWith({
      kind: "ExpenseOccurrenceChange",
      ruleId: "rule-a",
      scheduledDate: "2026-10-12",
      values: { action: "Skipped", changed: null },
    });
    expect(
      await screen.findByRole("region", { name: "Occurrence preview" }),
    ).toHaveTextContent("€48.00");
    expect(screen.getByText(/Contribution: €0\.00/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Save occurrence change" }),
    );
    expect(onSave).toHaveBeenCalledWith({ action: "Skipped", changed: null });
    confirm.mockRestore();
  });

  test("restoring a skipped date previews the complete baseline values and retains drafts on protected-date conflict", async () => {
    const onPreview = vi.fn().mockResolvedValue(changePreview);
    const onSave = vi
      .fn()
      .mockRejectedValue(
        new Error("This occurrence is protected by a later decision."),
      );
    render(
      <ExpenseOccurrenceEditor
        ruleId="rule-a"
        scheduledDate="2026-10-12"
        currency="EUR"
        defaults={baseline}
        horses={horses}
        current={{ action: "Skipped", changed: null }}
        onPreview={onPreview}
        onSave={onSave}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Restore occurrence" }),
    );
    expect(onPreview).toHaveBeenCalledWith({
      kind: "ExpenseOccurrenceChange",
      ruleId: "rule-a",
      scheduledDate: "2026-10-12",
      values: { action: "Changed", changed: baseline },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Save occurrence change" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This occurrence is protected",
    );
    expect(screen.getByLabelText("Description")).toHaveValue("Weekly hay");
  });

  test("keeps an existing custom split and its weights when opening a Changed occurrence", async () => {
    const custom = {
      ...changed,
      split: {
        mode: "Custom" as const,
        shares: [
          { horseId: "horse-a", weight: 700000 },
          { horseId: "horse-b", weight: 300000 },
        ],
      },
    };
    const onPreview = vi.fn().mockResolvedValue(changePreview);
    render(
      <ExpenseOccurrenceEditor
        ruleId="rule-a"
        scheduledDate="2026-10-12"
        currency="EUR"
        defaults={baseline}
        horses={horses}
        current={{ action: "Changed", changed: custom }}
        onPreview={onPreview}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByLabelText("Allocation")).toHaveValue("Custom");
    expect(screen.getByLabelText("Weight for Misty")).toHaveValue(700000);
    expect(screen.getByLabelText("Weight for Comet")).toHaveValue(300000);
    await userEvent.click(
      screen.getByRole("button", { name: "Preview change" }),
    );
    await screen.findByRole("region", { name: "Occurrence preview" });
    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        values: { action: "Changed", changed: custom },
      }),
    );
  });
});
