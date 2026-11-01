import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Modal } from "../../src/components/Modal";

function Example() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Add horse</button>
      {open && (
        <Modal labelledBy="title" onClose={() => setOpen(false)}>
          <h2 id="title">New horse</h2>
          <label>
            Name
            <input />
          </label>
          <button onClick={() => setOpen(false)}>Cancel</button>
        </Modal>
      )}
    </>
  );
}

test("a modal contains keyboard focus, closes with Escape, and restores the trigger", async () => {
  const user = userEvent.setup();
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Add horse" });
  await user.click(trigger);
  expect(screen.getByRole("dialog", { name: "New horse" })).toBeVisible();
  expect(screen.getByRole("textbox")).toHaveFocus();
  expect(document.body.style.overflow).toBe("hidden");
  await user.tab({ shift: true });
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("textbox")).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(document.body.style.overflow).toBe("");
});
