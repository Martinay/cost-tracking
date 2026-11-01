import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import { LanguageSelector } from "../../src/components/LanguageSelector";
import { ExpenseCategorySelect } from "../../src/features/expenses/ExpenseCategorySelect";

test("translates category labels and guidance while preserving canonical values", async () => {
  localStorage.clear();
  const onChange = vi.fn();
  render(
    <I18nProvider>
      <LanguageSelector />
      <ExpenseCategorySelect id="category" value="Feed" onChange={onChange} />
    </I18nProvider>,
  );
  await userEvent.selectOptions(screen.getByLabelText("Language"), "de");
  const category = screen.getByRole("combobox", { name: "Kategorie" });
  expect(category).toHaveValue("Feed");
  expect(screen.getByRole("option", { name: "Stallkosten" })).toHaveValue(
    "Stabling",
  );
  expect(category).toHaveAccessibleDescription(
    "Fahrtkosten separat anhand der gefahrenen Kilometer erfassen.",
  );
  await userEvent.selectOptions(category, "Stabling");
  expect(onChange).toHaveBeenCalledWith("Stabling");
  await userEvent.selectOptions(screen.getByLabelText("Sprache"), "en");
  expect(screen.getByLabelText("Category")).toHaveValue("Feed");
  localStorage.clear();
});
