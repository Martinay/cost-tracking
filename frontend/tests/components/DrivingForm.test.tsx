import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import {
  DrivingForm,
  type DrivingCommandBody,
  type DrivingHorse,
  type DrivingPreview,
} from "../../src/features/driving/DrivingForm";
import { DrivingRateForm } from "../../src/features/driving/DrivingRateForm";

const horses: DrivingHorse[] = [
  { horseId: "horse-a", name: "Misty", status: "Active" },
  { horseId: "horse-b", name: "Comet", status: "Leased" },
  { horseId: "horse-c", name: "Retired horse", status: "Retired" },
];
const serverPreview: DrivingPreview = {
  currency: "EUR",
  amountMinor: 304,
  splitMode: "Equal",
  streamVersion: 4,
  driving: { kilometers: 10.125, rateMinorPerKm: 30 },
  allocations: [
    { horseId: "horse-a", amountMinor: 152 },
    { horseId: "horse-b", amountMinor: 152 },
  ],
};

async function fillTrip() {
  await userEvent.type(screen.getByLabelText("Distance (km)"), "10.125");
  await userEvent.type(screen.getByLabelText("Description"), "Arena trip");
  await userEvent.click(screen.getByLabelText("Misty"));
  await userEvent.click(screen.getByLabelText("Comet"));
}

describe("driving trip form", () => {
  test("previews and commits the server-resolved saved rate and exact allocations", async () => {
    const onPreview = vi
      .fn<
        (request: {
          kind: "Driving";
          values: Omit<DrivingCommandBody, "rateMinorPerKm"> & {
            rateMinorPerKm?: number;
          };
        }) => Promise<DrivingPreview>
      >()
      .mockResolvedValue(serverPreview);
    const onCommit = vi
      .fn<(body: DrivingCommandBody, streamVersion: number) => Promise<void>>()
      .mockResolvedValue();
    render(
      <DrivingForm
        horses={horses}
        today="2026-10-09"
        currency="EUR"
        savedRateMinorPerKm={30}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );
    await fillTrip();
    await userEvent.click(
      screen.getByRole("button", { name: "Preview driving expense" }),
    );
    const previewRegion = screen.getByRole("region", {
      name: "Driving expense preview",
    });
    expect(within(previewRegion).getByText(/€3.04/)).toBeInTheDocument();
    expect(
      within(previewRegion).getByText(/30.0000 minor units\/km/),
    ).toBeInTheDocument();
    expect(within(previewRegion).getByText(/Misty: €1.52/)).toBeInTheDocument();
    expect(within(previewRegion).getByText(/Comet: €1.52/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Retired horse")).not.toBeInTheDocument();
    const request = {
      expenseDate: "2026-10-09",
      kilometers: 10.125,
      description: "Arena trip",
      split: { mode: "Equal", horseIds: ["horse-a", "horse-b"] },
    };
    expect(onPreview).toHaveBeenCalledWith({
      kind: "Driving",
      values: request,
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Save driving expense" }),
    );
    expect(onCommit).toHaveBeenCalledWith(
      { ...request, rateMinorPerKm: 30 },
      4,
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Driving expense saved.",
    );
  });

  test("explicit rate is sent for preview and edits invalidate the old preview", async () => {
    const onPreview = vi
      .fn<
        (request: {
          kind: "Driving";
          values: Omit<DrivingCommandBody, "rateMinorPerKm"> & {
            rateMinorPerKm?: number;
          };
        }) => Promise<DrivingPreview>
      >()
      .mockResolvedValue(serverPreview);
    const onCommit = vi
      .fn<(body: DrivingCommandBody, streamVersion: number) => Promise<void>>()
      .mockResolvedValue();
    render(
      <DrivingForm
        horses={horses}
        today="2026-10-09"
        currency="EUR"
        savedRateMinorPerKm={25}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );
    await fillTrip();
    await userEvent.type(
      screen.getByLabelText("Rate per km (optional)"),
      "30.0001",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Preview driving expense" }),
    );
    expect(
      within(
        screen.getByRole("region", { name: "Driving expense preview" }),
      ).getByText(/€3.04/),
    ).toBeInTheDocument();
    expect(onPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.objectContaining({ rateMinorPerKm: 30.0001 }),
      }),
    );
    await userEvent.clear(screen.getByLabelText("Distance (km)"));
    await userEvent.type(screen.getByLabelText("Distance (km)"), "10.2");
    expect(
      screen.queryByText("30.0000 minor units/km"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save driving expense" }),
    ).not.toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("retry after an ambiguous save preserves the exact previewed command", async () => {
    const onPreview = vi.fn().mockResolvedValue(serverPreview);
    const onCommit = vi
      .fn<(body: DrivingCommandBody, streamVersion: number) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Connection interrupted."))
      .mockResolvedValueOnce();
    render(
      <DrivingForm
        horses={horses}
        today="2026-10-09"
        currency="EUR"
        savedRateMinorPerKm={30}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );
    await fillTrip();
    await userEvent.click(
      screen.getByRole("button", { name: "Preview driving expense" }),
    );
    await screen.findByRole("region", { name: "Driving expense preview" });
    await userEvent.click(
      screen.getByRole("button", { name: "Save driving expense" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connection interrupted.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Save driving expense" }),
    );
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit.mock.calls[0][0]).toEqual(onCommit.mock.calls[1][0]);
    expect(onCommit.mock.calls[0][1]).toBe(4);
    expect(onCommit.mock.calls[1][1]).toBe(4);
  });
});

test("driving rate settings save a positive server value and announce acknowledgment", async () => {
  const onSave = vi
    .fn<(rateMinorPerKm: number) => Promise<void>>()
    .mockResolvedValue();
  render(<DrivingRateForm savedRateMinorPerKm={null} onSave={onSave} />);
  expect(screen.getByText("No saved driving rate.")).toBeInTheDocument();
  await userEvent.type(
    screen.getByLabelText("Driving rate (minor units per km)"),
    "30.125",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save driving rate" }),
  );
  expect(onSave).toHaveBeenCalledWith(30.125);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Driving rate saved.",
  );
});
