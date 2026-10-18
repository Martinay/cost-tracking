import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import {
  TaskForm,
  type TaskCommandBody,
} from "../../src/features/tasks/TaskForm";

describe("task form", () => {
  test("submits a quantity-only task with zero minutes by keyboard", async () => {
    const onSubmit = vi
      .fn<(value: TaskCommandBody) => Promise<void>>()
      .mockResolvedValue();
    render(
      <TaskForm
        horses={[{ horseId: "horse-a", name: "Misty" }]}
        today="2026-10-09"
        onSubmit={onSubmit}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("Horse"), "horse-a");
    await userEvent.selectOptions(
      screen.getByLabelText("Task type"),
      "PaddockDuty",
    );
    await userEvent.type(screen.getByLabelText("Quantity"), "2.5");
    await userEvent.type(screen.getByLabelText("Quantity unit"), "hours");
    const save = screen.getByRole("button", { name: "Save task" });
    save.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("status")).toHaveTextContent("Task saved.");
    expect(onSubmit).toHaveBeenCalledWith({
      horseId: "horse-a",
      taskDate: "2026-10-09",
      taskType: "PaddockDuty",
      minutes: 0,
      quantity: 2.5,
      quantityUnit: "hours",
      notes: "",
    });
  });

  test("announces invalid empty duration and quantity without sending", async () => {
    const onSubmit = vi
      .fn<(value: TaskCommandBody) => Promise<void>>()
      .mockResolvedValue();
    render(
      <TaskForm
        horses={[{ horseId: "horse-a", name: "Misty" }]}
        today="2026-10-09"
        onSubmit={onSubmit}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText("Horse"), "horse-a");
    await userEvent.click(screen.getByRole("button", { name: "Save task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /enter minutes or a quantity/i,
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

test("keeps an in-progress task draft and announces a server save error", async () => {
  const onSubmit = vi
    .fn<(value: TaskCommandBody) => Promise<void>>()
    .mockRejectedValue(new Error("The task could not be saved."));
  render(
    <TaskForm
      horses={[{ horseId: "horse-a", name: "Misty" }]}
      today="2026-10-09"
      onSubmit={onSubmit}
    />,
  );
  await userEvent.selectOptions(screen.getByLabelText("Horse"), "horse-a");
  await userEvent.type(screen.getByLabelText("Minutes"), "45");
  await userEvent.click(screen.getByRole("button", { name: "Save task" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The task could not be saved.",
  );
  expect(screen.getByLabelText("Minutes")).toHaveValue(45);
  expect(screen.getByLabelText("Horse")).toHaveValue("horse-a");
});
