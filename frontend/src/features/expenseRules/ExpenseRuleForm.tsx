import { useRef, useState } from "react";
import type {
  FinancialPreview,
  FinancialHorse,
  SplitValue,
} from "../finance/useFinancialForm";
import { SplitFields } from "../finance/SplitFields";
import {
  ScheduleFields,
  type ScheduleValue,
} from "../recurrence/ScheduleFields";

export interface ExpenseRuleDefaults {
  amountMinor: number;
  category: string;
  description: string;
  splitMode: "Equal" | "Custom" | string;
  allocations: { horseId: string; weight: number; amountMinor: number }[];
}

export interface ExpenseRuleInitialValue {
  ruleId: string;
  startDate: string;
  effectiveFrom: string;
  schedule: ScheduleValue;
  defaults: ExpenseRuleDefaults;
  revisions: {
    effectiveFrom: string;
    schedule: ScheduleValue;
    defaults: ExpenseRuleDefaults;
  }[];
  lastDate: string | null;
}

export interface ExpenseRuleCreateBody {
  schedule: ScheduleValue;
  amountMinor: number;
  category: string;
  description: string;
  split: SplitValue;
}

export interface ExpenseExampleValues {
  expenseDate: string;
  amountMinor: number;
  category: string;
  description: string;
  split: SplitValue;
}

export interface ExpenseRuleRevisionBody extends ExpenseRuleCreateBody {
  effectiveFrom: string;
}

export interface ExpenseRuleFormProps {
  today: string;
  currency: string;
  horses: FinancialHorse[];
  initialRule?: ExpenseRuleInitialValue;
  onPreview(values: ExpenseExampleValues): Promise<FinancialPreview>;
  onCreate(body: ExpenseRuleCreateBody): Promise<void>;
  onRevise?(body: ExpenseRuleRevisionBody): Promise<void>;
}

const emptySchedule = (startDate = ""): ScheduleValue => ({
  cadence: "Weekly",
  interval: 1,
  weekdays: [],
  dayOfMonth: null,
  startDate,
  endDate: null,
});

function toSplit(defaults: ExpenseRuleDefaults): SplitValue {
  if (defaults.splitMode === "Custom") {
    return {
      mode: "Custom",
      shares: defaults.allocations.map(({ horseId, weight }) => ({
        horseId,
        weight,
      })),
    };
  }
  return {
    mode: "Equal",
    horseIds: defaults.allocations.map(({ horseId }) => horseId),
  };
}

function parseMinor(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [units, cents = ""] = value.trim().split(".");
  return Number(units) * 100 + Number(cents.padEnd(2, "0"));
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

export function ExpenseRuleForm({
  today,
  currency,
  horses,
  initialRule,
  onPreview,
  onCreate,
  onRevise,
}: ExpenseRuleFormProps) {
  const [schedule, setSchedule] = useState<ScheduleValue>(
    initialRule?.schedule ?? emptySchedule(),
  );
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [amount, setAmount] = useState(() =>
    initialRule ? (initialRule.defaults.amountMinor / 100).toFixed(2) : "",
  );
  const [category, setCategory] = useState(
    initialRule?.defaults.category ?? "",
  );
  const [description, setDescription] = useState(
    initialRule?.defaults.description ?? "",
  );
  const [split, setSplit] = useState<SplitValue>(() =>
    initialRule
      ? toSplit(initialRule.defaults)
      : { mode: "Equal", horseIds: [] },
  );
  const [preview, setPreview] = useState<FinancialPreview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const pendingPreview = useRef(0);
  const amountMinor = parseMinor(amount);
  const exampleDate = initialRule
    ? effectiveFrom || schedule.startDate
    : schedule.startDate;
  const values: ExpenseExampleValues = {
    expenseDate: exampleDate,
    amountMinor: amountMinor ?? 0,
    category: category.trim(),
    description: description.trim(),
    split,
  };
  const fingerprint = JSON.stringify({ schedule, effectiveFrom, values });
  const previewCurrent = preview !== null && previewKey === fingerprint;
  const selectedCount =
    split.mode === "Equal" ? split.horseIds.length : split.shares.length;

  function invalidatePreview() {
    pendingPreview.current += 1;
    setPreview(null);
    setPreviewKey("");
    setStatus("");
    setError("");
  }

  function validFields(): boolean {
    if (amountMinor === null || amountMinor <= 0) {
      setError("Enter a positive amount with no more than two decimal places.");
      return false;
    }
    if (!category.trim() || !description.trim() || !schedule.startDate) {
      setError("Complete the amount, category, description, and start date.");
      return false;
    }
    if (schedule.endDate && schedule.endDate < schedule.startDate) {
      setError("The inclusive end date cannot be before the start date.");
      return false;
    }
    if (selectedCount === 0) {
      setError("Choose at least one horse for this expense.");
      return false;
    }
    if (initialRule && (!effectiveFrom || effectiveFrom <= today)) {
      setError("A rule revision must take effect after today.");
      return false;
    }
    return true;
  }

  async function previewExample() {
    setError("");
    setStatus("");
    if (!validFields()) return;
    const generation = ++pendingPreview.current;
    try {
      const result = await onPreview(values);
      if (generation !== pendingPreview.current) return;
      setPreview(result);
      setPreviewKey(fingerprint);
    } catch (reason) {
      if (generation === pendingPreview.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "The example occurrence could not be previewed.",
        );
    }
  }

  async function saveRule() {
    setError("");
    setStatus("");
    if (!validFields()) return;
    try {
      if (initialRule) {
        if (!onRevise)
          throw new Error("Rule revisions are not available here.");
        if (!previewCurrent) {
          setError(
            "Preview the example occurrence before saving the revision.",
          );
          return;
        }
        await onRevise({
          ...valuesWithoutDate(values),
          schedule,
          effectiveFrom,
        });
        setStatus("Expense rule revision saved.");
      } else {
        if (!previewCurrent) {
          setError("Preview the example occurrence before creating the rule.");
          return;
        }
        await onCreate({ schedule, ...valuesWithoutDate(values) });
        setStatus("Expense rule created.");
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The expense rule could not be saved.",
      );
    }
  }

  return (
    <form
      aria-label="Recurring expense rule form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void saveRule();
      }}
    >
      <ScheduleFields
        value={schedule}
        onChange={(next) => {
          invalidatePreview();
          setSchedule(next);
        }}
      />
      {initialRule && (
        <>
          <label htmlFor="rule-effective-from">
            Effective from (future date)
          </label>
          <input
            id="rule-effective-from"
            type="date"
            min={today}
            value={effectiveFrom}
            onChange={(event) => {
              invalidatePreview();
              setEffectiveFrom(event.currentTarget.value);
            }}
            required
          />
          <p>
            The revision keeps the original start date as its cadence anchor.
          </p>
        </>
      )}
      <label htmlFor="rule-amount">Amount</label>
      <input
        id="rule-amount"
        type="number"
        min="0.01"
        step="0.01"
        value={amount}
        onChange={(event) => {
          invalidatePreview();
          setAmount(event.currentTarget.value);
        }}
        required
      />
      <label htmlFor="rule-category">Category</label>
      <input
        id="rule-category"
        value={category}
        onChange={(event) => {
          invalidatePreview();
          setCategory(event.currentTarget.value);
        }}
        required
      />
      <label htmlFor="rule-description">Description</label>
      <input
        id="rule-description"
        value={description}
        onChange={(event) => {
          invalidatePreview();
          setDescription(event.currentTarget.value);
        }}
        required
      />
      <SplitFields
        horses={horses}
        value={split}
        onChange={(next) => {
          invalidatePreview();
          setSplit(next);
        }}
      />
      {error && <p role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {previewCurrent && (
        <section aria-label="Example occurrence">
          <h3>Example occurrence</h3>
          <p>
            {preview.date}:{" "}
            {money(preview.amountMinor, preview.currency ?? currency)}
          </p>
          <ul aria-label="Example occurrence allocations">
            {preview.allocations.map((allocation) => (
              <li key={allocation.horseId}>
                {horses.find((horse) => horse.horseId === allocation.horseId)
                  ?.name ?? allocation.horseId}
                : {money(allocation.amountMinor, preview.currency ?? currency)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <button type="button" onClick={() => void previewExample()}>
        Preview example occurrence
      </button>
      {!initialRule ? (
        <button type="submit">Create expense rule</button>
      ) : (
        <button type="submit">Save rule revision</button>
      )}
    </form>
  );
}

function valuesWithoutDate(values: ExpenseExampleValues) {
  return {
    amountMinor: values.amountMinor,
    category: values.category,
    description: values.description,
    split: values.split,
  };
}
