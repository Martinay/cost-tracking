import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { I18nProvider, useI18n } from "../../src/i18n/I18nProvider";
import { LanguageSelector } from "../../src/components/LanguageSelector";

function Example() {
  const { t } = useI18n();
  return (
    <>
      <LanguageSelector />
      <p>{t("Your horses")}</p>
      <p>{t("Unknown message")}</p>
    </>
  );
}
function renderExample() {
  return render(
    <I18nProvider>
      <Example />
    </I18nProvider>,
  );
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  document.documentElement.lang = "en";
});

test("switches by keyboard immediately, updates document language and persists across remount", async () => {
  renderExample();
  expect(screen.getByText("Your horses")).toBeInTheDocument();
  const select = screen.getByRole("combobox", { name: "Language" });
  select.focus();
  await userEvent.selectOptions(select, "de");
  expect(screen.getByText("Deine Pferde")).toBeInTheDocument();
  expect(document.documentElement.lang).toBe("de");
  expect(screen.getByText("Unknown message")).toBeInTheDocument();
  cleanup();
  renderExample();
  expect(screen.getByRole("combobox", { name: "Sprache" })).toHaveValue("de");
  await userEvent.selectOptions(screen.getByLabelText("Sprache"), "en");
  cleanup();
  renderExample();
  expect(screen.getByLabelText("Language")).toHaveValue("en");
});

test("invalid or blocked storage falls back safely and still allows language changes", async () => {
  localStorage.setItem("horse-ledger.language", "invalid");
  renderExample();
  expect(screen.getByLabelText("Language")).toHaveValue("en");
  cleanup();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  renderExample();
  await userEvent.selectOptions(screen.getByLabelText("Language"), "de");
  expect(screen.getByText("Deine Pferde")).toBeInTheDocument();
});

import { TaskForm } from "../../src/features/tasks/TaskForm";
import { PnlTable } from "../../src/features/reports/PnlTable";
import { ScheduleFields } from "../../src/features/recurrence/ScheduleFields";

function TaskExample({
  onSubmit,
}: {
  onSubmit: Parameters<typeof TaskForm>[0]["onSubmit"];
}) {
  return (
    <I18nProvider>
      <LanguageSelector />
      <TaskForm
        horses={[{ horseId: "horse-a", name: "Misty" }]}
        today="2026-11-01"
        onSubmit={onSubmit}
      />
    </I18nProvider>
  );
}

test("German task validation and success retain canonical command values and draft across switching", async () => {
  localStorage.setItem("horse-ledger.language", "de");
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<TaskExample onSubmit={onSubmit} />);
  await userEvent.selectOptions(screen.getByLabelText("Pferd"), "horse-a");
  await userEvent.click(
    screen.getByRole("button", { name: "Aufgabe speichern" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Gib Minuten oder eine Menge für die Aufgabe ein.",
  );
  expect(onSubmit).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText("Minuten"), "45");
  await userEvent.selectOptions(
    screen.getByLabelText("Aufgabenart"),
    "PaddockDuty",
  );
  await userEvent.selectOptions(screen.getByLabelText("Sprache"), "en");
  expect(screen.getByLabelText("Minutes")).toHaveValue(45);
  await userEvent.selectOptions(screen.getByLabelText("Language"), "de");
  await userEvent.click(
    screen.getByRole("button", { name: "Aufgabe speichern" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Aufgabe gespeichert.",
  );
  expect(onSubmit).toHaveBeenCalledWith({
    horseId: "horse-a",
    taskDate: "2026-11-01",
    taskType: "PaddockDuty",
    minutes: 45,
    notes: "",
  });
});

test("German report localizes currency while retaining amount and currency", () => {
  localStorage.setItem("horse-ledger.language", "de");
  render(
    <I18nProvider>
      <PnlTable
        month="2026-11"
        currency="EUR"
        items={[
          {
            horseId: "horse-a",
            horseName: "Income",
            incomeMinor: 123456,
            expenseMinor: 23456,
            netMinor: 100000,
          },
        ]}
      />
    </I18nProvider>,
  );
  expect(
    screen.getByRole("table", {
      name: "Monatliche Gewinn- und Verlustrechnung",
    }),
  ).toBeInTheDocument();
  expect(screen.getByText("1.234,56 €")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Income" })).toBeInTheDocument();
});

test("German schedule keeps canonical cadence and weekday values", async () => {
  localStorage.setItem("horse-ledger.language", "de");
  const onChange = vi.fn();
  render(
    <I18nProvider>
      <ScheduleFields
        value={{
          cadence: "Weekdays",
          interval: 1,
          weekdays: [],
          dayOfMonth: null,
          startDate: "2026-11-01",
          endDate: null,
        }}
        onChange={onChange}
      />
    </I18nProvider>,
  );
  await userEvent.click(screen.getByLabelText("Montag"));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ cadence: "Weekdays", weekdays: [1] }),
  );
});

import { ApiError } from "../../src/api/client";
import { formatDate } from "../../src/i18n/format";

function ErrorExample() {
  const { errorText } = useI18n();
  return (
    <>
      <LanguageSelector />
      <p role="alert">
        {errorText(
          new ApiError(412, {
            code: "version_conflict",
            message: "Server diagnostic",
            correlationId: "test",
          }),
        )}
      </p>
      <p>
        {errorText(
          new ApiError(400, {
            code: "future_code",
            message: "Keep this diagnostic",
            correlationId: "test",
          }),
        )}
      </p>
    </>
  );
}

test("known German API errors give recovery guidance and unknown diagnostics survive", async () => {
  localStorage.setItem("horse-ledger.language", "de");
  render(
    <I18nProvider>
      <ErrorExample />
    </I18nProvider>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Die Daten wurden geändert. Lade die Ansicht neu und prüfe deine Eingaben.",
  );
  expect(screen.getByText("Keep this diagnostic")).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Sprache"), "en");
  expect(screen.getByRole("alert")).toHaveTextContent("Server diagnostic");
});

test("date-only presentation follows language without changing the calendar day", () => {
  expect(formatDate("2026-11-01", "de-DE")).toBe("1.11.2026");
  expect(formatDate("2026-11-01", "en-US")).toBe("11/1/2026");
});

test("unknown prototype-like messages remain readable and route-specific recovery is preserved", () => {
  function Probe() {
    const { t, errorText } = useI18n();
    return (
      <>
        <p>{t("toString")}</p>
        <p role="alert">
          {errorText(
            new ApiError(404, {
              code: "not_found",
              message: "Resource unavailable.",
              correlationId: "test",
            }),
            "Horse not found.",
          )}
        </p>
      </>
    );
  }
  render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  expect(screen.getByText("toString")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Horse not found.");
});
