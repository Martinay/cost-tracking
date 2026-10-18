import { useState } from "react";
import type {
  FinancialPreview,
  FinancialHorse,
  SplitValue,
} from "../finance/useFinancialForm";
import { SplitFields } from "../finance/SplitFields";

export interface ExpenseOccurrenceValues {
  amountMinor: number;
  category: string;
  description: string;
  split: SplitValue;
}

export type ExpenseOccurrenceAction = "Changed" | "Skipped";

export interface ExpenseOccurrenceRequest {
  kind: "ExpenseOccurrenceChange";
  ruleId: string;
  scheduledDate: string;
  values: {
    action: ExpenseOccurrenceAction;
    changed: ExpenseOccurrenceValues | null;
  };
}

export interface ExpenseOccurrenceEditorProps {
  ruleId: string;
  scheduledDate: string;
  currency: string;
  defaults: ExpenseOccurrenceValues;
  horses: FinancialHorse[];
  current: {
    action: ExpenseOccurrenceAction | null;
    changed: ExpenseOccurrenceValues | null;
  };
  onPreview(request: ExpenseOccurrenceRequest): Promise<FinancialPreview>;
  onSave(body: ExpenseOccurrenceRequest["values"]): Promise<void>;
  error?: string;
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}

export function ExpenseOccurrenceEditor({
  ruleId,
  scheduledDate,
  currency,
  defaults,
  horses,
  current,
  onPreview,
  onSave,
  error: externalError,
}: ExpenseOccurrenceEditorProps) {
  const initialAction: ExpenseOccurrenceAction =
    current.action === "Skipped" ? "Skipped" : "Changed";
  const [action, setAction] = useState<ExpenseOccurrenceAction>(initialAction);
  const [amount, setAmount] = useState<number | string>(
    () =>
      ((current.action === "Changed" ? current.changed : null)?.amountMinor ??
        defaults.amountMinor) / 100,
  );
  const [category, setCategory] = useState(
    (current.action === "Changed" ? current.changed : null)?.category ??
      defaults.category,
  );
  const [description, setDescription] = useState(
    (current.action === "Changed" ? current.changed : null)?.description ??
      defaults.description,
  );
  const [split, setSplit] = useState<SplitValue>(
    (current.action === "Changed" ? current.changed : null)?.split ??
      defaults.split,
  );
  const [preview, setPreview] = useState<FinancialPreview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [localError, setLocalError] = useState("");
  const [saved, setSaved] = useState(false);
  const amountMinor =
    typeof amount === "number"
      ? Math.round(amount * 100)
      : Math.round((Number(amount) || 0) * 100);
  const changed: ExpenseOccurrenceValues = {
    amountMinor,
    category: category.trim(),
    description: description.trim(),
    split,
  };
  const values = { action, changed: action === "Changed" ? changed : null };
  const fingerprint = JSON.stringify(values);
  const previewCurrent = preview !== null && previewKey === fingerprint;
  const error = localError || externalError;
  const displayedCurrency = preview?.currency ?? currency;

  function edited() {
    setPreview(null);
    setPreviewKey("");
    setSaved(false);
    setLocalError("");
  }

  async function previewValues(nextValues = values) {
    setLocalError("");
    setSaved(false);
    if (
      nextValues.action === "Changed" &&
      (!Number.isFinite(amountMinor) ||
        amountMinor <= 0 ||
        !category.trim() ||
        !description.trim() ||
        (split.mode === "Equal"
          ? split.horseIds.length
          : split.shares.length) === 0)
    ) {
      setLocalError(
        "Complete the changed amount, category, description, and horse split.",
      );
      return;
    }
    try {
      const request: ExpenseOccurrenceRequest = {
        kind: "ExpenseOccurrenceChange",
        ruleId,
        scheduledDate,
        values: nextValues,
      };
      const result = await onPreview(request);
      setAction(nextValues.action);
      if (nextValues.changed) {
        setAmount(nextValues.changed.amountMinor / 100);
        setCategory(nextValues.changed.category);
        setDescription(nextValues.changed.description);
        setSplit(nextValues.changed.split);
      }
      setPreview(result);
      setPreviewKey(JSON.stringify(nextValues));
    } catch (reason) {
      setLocalError(
        reason instanceof Error
          ? reason.message
          : "The occurrence change could not be previewed.",
      );
    }
  }

  async function skip() {
    if (!window.confirm(`Skip the scheduled expense for ${scheduledDate}?`))
      return;
    await previewValues({ action: "Skipped", changed: null });
  }

  async function restore() {
    await previewValues({ action: "Changed", changed: defaults });
  }

  async function save() {
    if (!previewCurrent) {
      setLocalError("Preview this occurrence change before saving.");
      return;
    }
    setLocalError("");
    setSaved(false);
    try {
      await onSave(values);
      setSaved(true);
    } catch (reason) {
      setLocalError(
        reason instanceof Error
          ? reason.message
          : "The occurrence change could not be saved.",
      );
    }
  }

  return (
    <form
      aria-label={`Occurrence on ${scheduledDate}`}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p>
        Scheduled date: <time dateTime={scheduledDate}>{scheduledDate}</time>
      </p>
      {current.action && <p>Current state: {current.action}</p>}
      {action === "Skipped" && (
        <p>
          Scheduled amount remains{" "}
          {money(defaults.amountMinor, displayedCurrency)}. Contribution:{" "}
          {money(0, displayedCurrency)}.
        </p>
      )}
      {action === "Changed" && (
        <>
          <label htmlFor="occurrence-amount">Amount</label>
          <input
            id="occurrence-amount"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => {
              edited();
              setAmount(
                event.currentTarget.value === ""
                  ? ""
                  : Number(event.currentTarget.value),
              );
            }}
            required
          />
          <label htmlFor="occurrence-category">Category</label>
          <input
            id="occurrence-category"
            value={category}
            onChange={(event) => {
              edited();
              setCategory(event.currentTarget.value);
            }}
            required
          />
          <label htmlFor="occurrence-description">Description</label>
          <input
            id="occurrence-description"
            value={description}
            onChange={(event) => {
              edited();
              setDescription(event.currentTarget.value);
            }}
            required
          />
          <SplitFields
            horses={horses}
            value={split}
            onChange={(next) => {
              edited();
              setSplit(next);
            }}
          />
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">Occurrence change saved.</p>}
      {previewCurrent && preview && (
        <section aria-label="Occurrence preview">
          <h3>Occurrence preview</h3>
          <p>
            Scheduled amount:{" "}
            {money(preview.amountMinor, preview.currency ?? "EUR")}
          </p>
          <ul aria-label="Occurrence preview monthly deltas">
            {preview.monthlyEffect.map((effect, index) => (
              <li key={`${effect.month}-${effect.horseId}-${index}`}>
                {effect.month} ·{" "}
                {horses.find((horse) => horse.horseId === effect.horseId)
                  ?.name ?? effect.horseId}{" "}
                · expense change {effect.expenseDeltaMinor < 0 ? "−" : "+"}
                {money(
                  Math.abs(effect.expenseDeltaMinor),
                  preview.currency ?? "EUR",
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {current.action === "Skipped" ? (
        <button type="button" onClick={() => void restore()}>
          Restore occurrence
        </button>
      ) : (
        <button type="button" onClick={() => void skip()}>
          Skip this occurrence
        </button>
      )}
      {action === "Changed" && (
        <button type="button" onClick={() => void previewValues()}>
          Preview change
        </button>
      )}
      {action === "Skipped" && !previewCurrent && (
        <button type="button" onClick={() => void previewValues()}>
          Preview skip
        </button>
      )}
      <button type="submit" disabled={!previewCurrent}>
        Save occurrence change
      </button>
    </form>
  );
}
