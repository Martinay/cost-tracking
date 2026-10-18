import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { IncomeDecisionDialogs } from "../../src/features/approvals/IncomeDecisionDialogs";

const item = {
  ruleId: "rule-monthly",
  scheduledDate: "2026-10-01",
  amountMinor: 10000,
  source: "Boarding",
  splitMode: "Equal",
  allocations: [
    { horseId: "horse-a", weight: 500000, amountMinor: 5000 },
    { horseId: "horse-b", weight: 500000, amountMinor: 5000 },
  ],
};
const horses = [
  { horseId: "horse-a", name: "Misty", status: "Active" as const },
  { horseId: "horse-b", name: "Comet", status: "Leased" as const },
];
const preview = {
  currency: "EUR",
  date: "2026-10-09",
  amountMinor: 2500,
  splitMode: "Equal",
  allocations: [
    { horseId: "horse-a", weight: 500000, amountMinor: 1250 },
    { horseId: "horse-b", weight: 500000, amountMinor: 1250 },
  ],
  monthlyEffect: [],
  streamVersion: 9,
};

describe("income decision dialogs", () => {
  test("shows scheduled and actual dates separately and requires server preview before approval", async () => {
    const onPreview = vi.fn().mockResolvedValue(preview);
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(
      <IncomeDecisionDialogs
        item={item}
        horses={horses}
        currency="EUR"
        today="2026-10-09"
        onPreview={onPreview}
        onApprove={onApprove}
        onReject={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Scheduled date:")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("region", { name: "Approval preview" }),
    ).toHaveTextContent("€25.00");
    expect(onPreview).toHaveBeenCalledWith({
      kind: "Income",
      values: {
        receivedDate: "2026-10-09",
        amountMinor: 10000,
        source: "Boarding",
        split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
      },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm approval" }),
    );
    expect(onApprove).toHaveBeenCalledWith({
      receivedDate: "2026-10-09",
      amountMinor: 10000,
      split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
    });
  });

  test("requires explicit confirmation before rejecting and retains recoverable errors", async () => {
    const onReject = vi
      .fn()
      .mockRejectedValue(new Error("Already processed. Refresh the inbox."));
    render(
      <IncomeDecisionDialogs
        item={item}
        horses={horses}
        currency="EUR"
        today="2026-10-09"
        onPreview={vi.fn().mockResolvedValue(preview)}
        onApprove={vi.fn().mockResolvedValue(undefined)}
        onReject={onReject}
      />,
    );

    const rejectButton = screen.getByRole("button", { name: "Reject" });
    await userEvent.click(rejectButton);
    const dialog = await screen.findByRole("dialog", {
      name: "Reject payment",
    });
    expect(dialog).toHaveTextContent("This decision cannot be undone.");
    await userEvent.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Reject payment" }),
    ).not.toBeInTheDocument();
    expect(rejectButton).toHaveFocus();
    await userEvent.click(rejectButton);
    await userEvent.click(screen.getByRole("button", { name: "Keep pending" }));
    expect(onReject).not.toHaveBeenCalled();
    await userEvent.click(rejectButton);
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm rejection" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Already processed",
    );
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  test("editing approval values invalidates preview until the changed payment is reviewed", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn().mockResolvedValue(preview);
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(
      <IncomeDecisionDialogs
        item={item}
        horses={horses}
        currency="EUR"
        today="2026-10-09"
        onPreview={onPreview}
        onApprove={onApprove}
        onReject={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit and approve" }));
    await user.clear(screen.getByLabelText("Actual received date"));
    await user.type(
      screen.getByLabelText("Actual received date"),
      "2026-10-08",
    );
    await user.clear(screen.getByLabelText("Actual amount"));
    await user.type(screen.getByLabelText("Actual amount"), "125.50");
    await user.click(screen.getByRole("button", { name: "Preview approval" }));
    expect(
      await screen.findByRole("region", { name: "Approval preview" }),
    ).toHaveTextContent("Actual received date: 2026-10-08");
    await user.clear(screen.getByLabelText("Actual amount"));
    await user.type(screen.getByLabelText("Actual amount"), "130.00");
    expect(
      screen.queryByRole("button", { name: "Confirm approval" }),
    ).not.toBeInTheDocument();
    expect(onApprove).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Preview approval" }));
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(onApprove).toHaveBeenCalledWith({
      receivedDate: "2026-10-08",
      amountMinor: 13000,
      split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
    });
  });

  test("announces a losing-tab approval conflict without claiming success", async () => {
    const user = userEvent.setup();
    const onApprove = vi
      .fn()
      .mockRejectedValue(new Error("This payment was already decided."));
    render(
      <IncomeDecisionDialogs
        item={item}
        horses={horses}
        currency="EUR"
        today="2026-10-09"
        onPreview={vi.fn().mockResolvedValue(preview)}
        onApprove={onApprove}
        onReject={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByRole("region", { name: "Approval preview" });
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This payment was already decided.",
    );
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});
