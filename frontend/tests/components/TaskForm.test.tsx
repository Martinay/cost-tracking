import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import {
  TaskForm,
  type TaskCommandBody,
} from "../../src/features/tasks/TaskForm";

beforeEach(() => window.localStorage.clear());
const horses = [
  { horseId: "horse-a", name: "Misty" },
  { horseId: "horse-b", name: "Comet" },
];
function setup(subject = "owner-a") {
  const onSubmit = vi
    .fn<(value: TaskCommandBody) => Promise<void>>()
    .mockResolvedValue();
  const props = { horses, today: "2026-10-09", subject, onSubmit };
  return { ...render(<TaskForm {...props} />), onSubmit, props };
}
async function createQuickTask(name = "Putzen", minutes = "15") {
  await userEvent.click(screen.getByRole("button", { name: "New quick task" }));
  const dialog = within(screen.getByRole("dialog"));
  await userEvent.type(dialog.getByLabelText("Name"), name);
  await userEvent.selectOptions(
    dialog.getByLabelText("Activity type"),
    "Grooming",
  );
  await userEvent.type(dialog.getByLabelText("Default minutes"), minutes);
  await userEvent.click(
    dialog.getByRole("button", { name: "Save quick task" }),
  );
}

test("keyboard-saves minutes without quantity controls", async () => {
  const { onSubmit } = setup();
  expect(screen.queryByLabelText("Quantity")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Quantity unit")).not.toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Horse"), "horse-a");
  await userEvent.type(screen.getByLabelText("Minutes"), "20");
  screen.getByRole("button", { name: "Save task" }).focus();
  await userEvent.keyboard("{Enter}");
  expect(await screen.findByText("Task saved.")).toBeInTheDocument();
  expect(onSubmit).toHaveBeenCalledWith({
    horseId: "horse-a",
    taskDate: "2026-10-09",
    taskType: "Riding",
    minutes: 20,
    notes: "",
  });
});

test("rejects missing duration without sending", async () => {
  const { onSubmit } = setup();
  await userEvent.selectOptions(screen.getByLabelText("Horse"), "horse-a");
  await userEvent.click(screen.getByRole("button", { name: "Save task" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /positive whole minutes/i,
  );
  expect(onSubmit).not.toHaveBeenCalled();
});

test("creates, applies and reuses a custom shortcut without submitting on selection", async () => {
  const { onSubmit } = setup();
  await userEvent.selectOptions(screen.getByLabelText("Horse"), "horse-a");
  await createQuickTask();
  await userEvent.click(screen.getByRole("button", { name: /Putzen.*15 min/ }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Horse")).toHaveValue("horse-a");
  expect(screen.getByLabelText("Minutes")).toHaveValue(15);
  expect(screen.getByLabelText("Task type")).toHaveValue("Grooming");
  await userEvent.type(screen.getByLabelText("Notes"), "After turnout");
  await userEvent.click(screen.getByRole("button", { name: "Save task" }));
  expect(onSubmit).toHaveBeenLastCalledWith(
    expect.objectContaining({
      horseId: "horse-a",
      minutes: 15,
      notes: "Putzen\nAfter turnout",
    }),
  );
  await userEvent.selectOptions(screen.getByLabelText("Horse"), "horse-b");
  await userEvent.click(screen.getByRole("button", { name: "Save task" }));
  expect(onSubmit).toHaveBeenLastCalledWith(
    expect.objectContaining({ horseId: "horse-b", minutes: 15 }),
  );
});

test("persists edits/deletion and isolates shortcut libraries by account", async () => {
  const first = setup();
  await createQuickTask();
  first.unmount();
  const other = setup("owner-b");
  expect(
    screen.queryByRole("button", { name: /Putzen.*15 min/ }),
  ).not.toBeInTheDocument();
  other.unmount();
  const restored = setup();
  await userEvent.click(
    screen.getByRole("button", { name: "Manage quick tasks" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Edit Putzen" }));
  const dialog = within(screen.getByRole("dialog"));
  await userEvent.clear(dialog.getByLabelText("Name"));
  await userEvent.type(dialog.getByLabelText("Name"), "Bürsten");
  await userEvent.clear(dialog.getByLabelText("Default minutes"));
  await userEvent.type(dialog.getByLabelText("Default minutes"), "25");
  await userEvent.click(
    dialog.getByRole("button", { name: "Save quick task" }),
  );
  expect(
    screen.getByRole("button", { name: /Bürsten.*25 min/ }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Delete Bürsten" }));
  restored.unmount();
  setup();
  expect(
    screen.queryByRole("button", { name: /Bürsten/ }),
  ).not.toBeInTheDocument();
});

test("rejects duplicate shortcut names and restores focus after Escape", async () => {
  setup();
  await createQuickTask();
  await createQuickTask(" putzen ");
  expect(
    within(screen.getByRole("dialog")).getByRole("alert"),
  ).toHaveTextContent(/already exists/i);
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New quick task" })).toHaveFocus();
});

test("reports storage write failure and retains the shortcut editor draft", async () => {
  setup();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  await createQuickTask();
  expect(
    within(screen.getByRole("dialog")).getByRole("alert"),
  ).toHaveTextContent(/could not.*save/i);
  expect(screen.getByLabelText("Name")).toHaveValue("Putzen");
});

test("reports corrupt stored shortcuts instead of overwriting them", () => {
  window.localStorage.setItem("horse-ledger:quick-tasks:v1:owner-a", "broken");
  setup();
  expect(screen.getByRole("alert")).toHaveTextContent(/could not.*load/i);
  expect(
    window.localStorage.getItem("horse-ledger:quick-tasks:v1:owner-a"),
  ).toBe("broken");
});

test("keeps task draft on server error and blocks pending submission", async () => {
  const { onSubmit, rerender, props } = setup();
  onSubmit.mockRejectedValue(new Error("The task could not be saved."));
  await userEvent.selectOptions(screen.getByLabelText("Horse"), "horse-a");
  await userEvent.type(screen.getByLabelText("Minutes"), "45");
  await userEvent.click(screen.getByRole("button", { name: "Save task" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The task could not be saved.",
  );
  expect(screen.getByLabelText("Minutes")).toHaveValue(45);
  rerender(<TaskForm {...props} pending />);
  expect(screen.getByRole("button", { name: "Saving task…" })).toBeDisabled();
  expect(screen.getByLabelText("Horse")).toBeDisabled();
});

test("recovers an unreadable library only after an explicit reset", async () => {
  window.localStorage.setItem("horse-ledger:quick-tasks:v1:owner-a", "broken");
  setup();
  await userEvent.click(
    screen.getByRole("button", { name: "Reset unreadable quick tasks" }),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New quick task" })).toBeEnabled();
  expect(
    window.localStorage.getItem("horse-ledger:quick-tasks:v1:owner-a"),
  ).toBe("[]");
});
