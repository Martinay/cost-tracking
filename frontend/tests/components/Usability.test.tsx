import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { test, expect, vi } from "vitest";
import { normalizeSplit } from "../../src/features/finance/useFinancialForm";
import { DrivingForm } from "../../src/features/driving/DrivingForm";
import { TaskForm } from "../../src/features/tasks/TaskForm";

test("U01 ratios preserve deterministic exact millionths", () => {
  expect(
    normalizeSplit({
      mode: "Custom",
      shares: [
        { horseId: "a", weight: 2 },
        { horseId: "b", weight: 1 },
      ],
    }),
  ).toEqual({
    mode: "Custom",
    shares: [
      { horseId: "a", weight: 666667 },
      { horseId: "b", weight: 333333 },
    ],
  });
  expect(
    normalizeSplit({
      mode: "Custom",
      shares: [
        { horseId: "b", weight: 1 },
        { horseId: "a", weight: 1 },
        { horseId: "c", weight: 1 },
      ],
    }),
  ).toEqual({
    mode: "Custom",
    shares: [
      { horseId: "b", weight: 333333 },
      { horseId: "a", weight: 333334 },
      { horseId: "c", weight: 333333 },
    ],
  });
  expect(() =>
    normalizeSplit({ mode: "Custom", shares: [{ horseId: "a", weight: 0 }] }),
  ).toThrow();
});
test("U02 euro/km input sends 30 cents for €0.30 and previews €7.20", async () => {
  const onPreview = vi.fn().mockResolvedValue({
    currency: "EUR",
    amountMinor: 720,
    streamVersion: 1,
    splitMode: "Equal",
    driving: { kilometers: 24, rateMinorPerKm: 30 },
    allocations: [],
  });
  render(
    <DrivingForm
      horses={[{ horseId: "a", name: "Luna", status: "Active" }]}
      today="2026-11-10"
      currency="EUR"
      savedRateMinorPerKm={null}
      onPreview={onPreview}
      onCommit={vi.fn()}
    />,
  );
  await userEvent.type(screen.getByLabelText("Distance (km)"), "24");
  await userEvent.type(screen.getByLabelText(/Rate per km/), "0.30");
  await userEvent.type(screen.getByLabelText("Description"), "Stable trip");
  await userEvent.click(screen.getByLabelText("Luna"));
  await userEvent.click(
    screen.getByRole("button", { name: "Preview driving expense" }),
  );
  expect(onPreview).toHaveBeenCalledWith(
    expect.objectContaining({
      values: expect.objectContaining({ kilometers: 24, rateMinorPerKm: 30 }),
    }),
  );
  expect(await screen.findByText(/Total: €7.20/)).toBeInTheDocument();
});
test("U16 successful task entry clears measurements for a new task", async () => {
  render(
    <TaskForm
      horses={[{ horseId: "a", name: "Luna" }]}
      today="2026-11-10"
      onSubmit={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  await userEvent.selectOptions(screen.getByLabelText("Horse"), "a");
  await userEvent.type(screen.getByLabelText("Minutes"), "45");
  await userEvent.click(screen.getByRole("button", { name: "Save task" }));
  await screen.findByText("Task saved.");
  expect(screen.getByLabelText("Minutes")).toHaveValue(null);
});

test("U09 scheduled monthly preview respects the payment day and end", async () => {
  const { firstOccurrence } =
    await import("../../src/features/recurrence/schedule");
  const schedule = {
    cadence: "Monthly" as const,
    interval: 1,
    weekdays: [],
    dayOfMonth: 10,
    startDate: "2026-11-02",
    endDate: null,
  };
  expect(firstOccurrence(schedule, "2026-11-02")).toBe("2026-11-10");
  expect(
    firstOccurrence({ ...schedule, endDate: "2026-11-09" }, "2026-11-02"),
  ).toBeNull();
  expect(
    firstOccurrence(
      { ...schedule, dayOfMonth: 31, startDate: "2026-01-31" },
      "2026-02-01",
    ),
  ).toBe("2026-02-28");
});

test("recurring examples search beyond five years and respect the inclusive end", async () => {
  const { firstOccurrence } =
    await import("../../src/features/recurrence/schedule");
  const schedule = {
    cadence: "Monthly" as const,
    interval: 61,
    weekdays: [],
    dayOfMonth: 1,
    startDate: "2026-11-11",
    endDate: null,
  };
  expect(firstOccurrence(schedule, schedule.startDate)).toBe("2031-12-01");
  expect(
    firstOccurrence({ ...schedule, endDate: "2031-12-01" }, schedule.startDate),
  ).toBe("2031-12-01");
  expect(
    firstOccurrence({ ...schedule, endDate: "2031-11-30" }, schedule.startDate),
  ).toBeNull();
  expect(
    firstOccurrence({ ...schedule, interval: 366 }, schedule.startDate),
  ).toBe("2057-05-01");
  expect(
    firstOccurrence({ ...schedule, startDate: "9999-12-02" }, "9999-12-02"),
  ).toBeNull();
});

test("U23 monthly totals and U19 visible scroll guidance", async () => {
  const { PnlTable } = await import("../../src/features/reports/PnlTable");
  render(
    <PnlTable
      month="2026-11"
      currency="EUR"
      items={[
        {
          horseId: "a",
          horseName: "Luna",
          incomeMinor: 29000,
          expenseMinor: 97721,
          netMinor: -68721,
        },
      ]}
    />,
  );
  expect(screen.getByRole("rowheader", { name: "Total" })).toBeInTheDocument();
  expect(screen.getByText(/Scroll horizontally/)).toBeInTheDocument();
});

test("U15 task drafts recover for the same owner and never cross identities", async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  const props = {
    horses: [{ horseId: "a", name: "Luna" }],
    today: "2026-11-10",
    onSubmit: submit,
  };
  const first = render(<TaskForm {...props} draftScope="owner-one" />);
  await userEvent.selectOptions(screen.getByLabelText("Horse"), "a");
  await userEvent.type(screen.getByLabelText("Minutes"), "25");
  first.unmount();
  const second = render(<TaskForm {...props} draftScope="owner-one" />);
  expect(screen.getByLabelText("Minutes")).toHaveValue(25);
  second.rerender(<TaskForm {...props} draftScope="owner-two" />);
  expect(screen.getByLabelText("Minutes")).toHaveValue(null);
  expect(screen.getByLabelText("Horse")).toHaveValue("");
});

test("overall money totals retain every cent beyond a single-entry safe integer", async () => {
  const { formatMoney } = await import("../../src/i18n/format");
  expect(formatMoney(18014398509481982n, "EUR", "en-US")).toBe(
    "€180,143,985,094,819.82",
  );
  expect(formatMoney(-1n, "EUR", "en-US")).toBe("-€0.01");
});

test("damaged stored split data falls back to an editable empty trip", () => {
  sessionStorage.setItem(
    "horse-ledger:draft:v1:owner:driving-split",
    JSON.stringify({ mode: "Equal", horseIds: null }),
  );
  render(
    <DrivingForm
      draftScope="owner"
      horses={[{ horseId: "a", name: "Luna", status: "Active" }]}
      today="2026-11-10"
      currency="EUR"
      savedRateMinorPerKm={30}
      onPreview={vi.fn()}
      onCommit={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Luna")).not.toBeChecked();
});

test("driving conversion respects historical currency precision", async () => {
  const { parseRateMajor, formatRate } =
    await import("../../src/features/driving/rate");
  expect(parseRateMajor("0.30", "JPY")).toBe(0.3);
  expect(parseRateMajor("0.30", "BHD")).toBe(300);
  expect(formatRate(30, "JPY", "en-US")).toBe("¥30");
});

test("saved percentage shares round-trip to the original exact allocation", () => {
  expect(
    normalizeSplit({
      mode: "Custom",
      shares: [
        { horseId: "a", weight: 66.6667 },
        { horseId: "b", weight: 33.3333 },
      ],
    }),
  ).toEqual({
    mode: "Custom",
    shares: [
      { horseId: "a", weight: 666667 },
      { horseId: "b", weight: 333333 },
    ],
  });
});

test.each([0, 1.5, 32, null])(
  "invalid monthly day %s is rejected before searching",
  async (dayOfMonth) => {
    const { firstOccurrence } =
      await import("../../src/features/recurrence/schedule");
    const iso = vi.spyOn(Date.prototype, "toISOString");
    try {
      const result = firstOccurrence(
        {
          cadence: "Monthly",
          interval: 1,
          weekdays: [],
          dayOfMonth,
          startDate: "2026-11-11",
          endDate: "2026-12-11",
        },
        "2026-11-11",
      );
      expect(iso).not.toHaveBeenCalled();
      expect(result).toBeNull();
    } finally {
      iso.mockRestore();
    }
  },
);
