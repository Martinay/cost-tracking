import { useRef, useState, type FormEvent } from "react";
import { SplitFields } from "../finance/SplitFields";
import type { SplitValue } from "../finance/useFinancialForm";

export interface DrivingHorse {
  horseId: string;
  name: string;
  status: "Active" | "Leased" | "Retired" | "Sold";
}
export interface DrivingDraftBody {
  expenseDate: string;
  kilometers: number;
  rateMinorPerKm?: number;
  description: string;
  split: SplitValue;
}
export interface DrivingCommandBody extends DrivingDraftBody {
  rateMinorPerKm: number;
}
export interface DrivingPreview {
  currency: string | null;
  amountMinor: number;
  splitMode: string;
  streamVersion: number;
  driving: { kilometers: number; rateMinorPerKm: number } | null;
  allocations: { horseId: string; amountMinor: number }[];
}
export interface DrivingFormProps {
  horses: DrivingHorse[];
  today: string;
  currency: string;
  savedRateMinorPerKm: number | null;
  onPreview(request: {
    kind: "Driving";
    values: DrivingDraftBody;
  }): Promise<DrivingPreview>;
  onCommit(body: DrivingCommandBody, streamVersion: number): Promise<void>;
}

export function DrivingForm({
  horses,
  today,
  currency,
  savedRateMinorPerKm,
  onPreview,
  onCommit,
}: DrivingFormProps) {
  const [expenseDate, setExpenseDate] = useState(today);
  const [kilometers, setKilometers] = useState("");
  const [rateMinorPerKm, setRateMinorPerKm] = useState("");
  const [description, setDescription] = useState("");
  const [split, setSplit] = useState<SplitValue>({
    mode: "Equal",
    horseIds: [],
  });
  const [preview, setPreview] = useState<DrivingPreview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [committed, setCommitted] = useState(false);
  const requestGeneration = useRef(0);
  const distance = Number(kilometers);
  const rate =
    rateMinorPerKm.trim() === "" ? undefined : Number(rateMinorPerKm);
  const draft: DrivingDraftBody = {
    expenseDate,
    kilometers: distance,
    ...(rate === undefined ? {} : { rateMinorPerKm: rate }),
    description,
    split,
  };
  const key = JSON.stringify(draft);
  const isCurrentPreview = preview !== null && key === previewKey;
  const selectedIds =
    split.mode === "Equal"
      ? split.horseIds
      : split.shares.map((share) => share.horseId);

  function update<T>(setter: (value: T) => void, value: T) {
    requestGeneration.current += 1;
    setter(value);
    setPreview(null);
    setPreviewKey("");
    setSaved(false);
    setCommitted(false);
    setError("");
  }

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved(false);
    if (
      !kilometers ||
      !Number.isFinite(distance) ||
      distance <= 0 ||
      (kilometers.split(".")[1]?.length ?? 0) > 3
    ) {
      setError(
        "Enter a positive distance with no more than three decimal places.",
      );
      return;
    }
    if (
      rate !== undefined &&
      (!Number.isFinite(rate) ||
        rate <= 0 ||
        rate > 1_000_000 ||
        (rateMinorPerKm.split(".")[1]?.length ?? 0) > 4)
    ) {
      setError("Enter a positive rate with no more than four decimal places.");
      return;
    }
    if (!description.trim()) {
      setError("Enter a trip description.");
      return;
    }
    if (selectedIds.length === 0) {
      setError("Choose at least one horse for this trip.");
      return;
    }
    const request = { kind: "Driving" as const, values: draft };
    const generation = ++requestGeneration.current;
    const capturedKey = JSON.stringify(draft);
    try {
      const result = await onPreview(request);
      if (generation !== requestGeneration.current) return;
      if (!result.driving || result.currency === null)
        throw new Error(
          "Driving preview did not include a resolved rate and currency.",
        );
      setPreview(result);
      setPreviewKey(capturedKey);
    } catch (reason) {
      if (generation === requestGeneration.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "The trip could not be previewed.",
        );
    }
  }

  async function handleCommit() {
    if (!preview || !isCurrentPreview || !preview.driving) return;
    setError("");
    const command: DrivingCommandBody = {
      ...draft,
      rateMinorPerKm: preview.driving.rateMinorPerKm,
    };
    try {
      await onCommit(command, preview.streamVersion);
      setSaved(true);
      setCommitted(true);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The driving expense could not be saved.",
      );
    }
  }

  const horseNames = new Map(
    horses.map((horse) => [horse.horseId, horse.name]),
  );
  const displayCurrency = preview?.currency ?? currency;

  return (
    <form onSubmit={(event) => void handlePreview(event)}>
      <label htmlFor="driving-date">Trip date</label>
      <input
        id="driving-date"
        type="date"
        max={today}
        value={expenseDate}
        onChange={(event) => update(setExpenseDate, event.currentTarget.value)}
        required
      />
      <label htmlFor="driving-distance">Distance (km)</label>
      <input
        id="driving-distance"
        type="number"
        min="0.001"
        step="0.001"
        value={kilometers}
        onChange={(event) => update(setKilometers, event.currentTarget.value)}
        required
      />
      <label htmlFor="driving-rate">Rate per km (optional)</label>
      <input
        id="driving-rate"
        type="number"
        min="0.0001"
        max="1000000"
        step="0.0001"
        value={rateMinorPerKm}
        onChange={(event) =>
          update(setRateMinorPerKm, event.currentTarget.value)
        }
      />
      <p>
        {savedRateMinorPerKm === null
          ? "No saved driving rate; enter one for this trip or save one in settings."
          : `Saved rate: ${savedRateMinorPerKm.toFixed(4)} minor units/km. Leave the rate blank to use it.`}
      </p>
      <label htmlFor="driving-description">Description</label>
      <input
        id="driving-description"
        maxLength={500}
        value={description}
        onChange={(event) => update(setDescription, event.currentTarget.value)}
        required
      />
      <SplitFields
        horses={horses}
        value={split}
        onChange={(value) => update(setSplit, value)}
      />
      {error && <p role="alert">{error}</p>}
      {preview && isCurrentPreview && (
        <section aria-label="Driving expense preview">
          <h3>Driving expense preview</h3>
          <p>
            {preview.driving!.kilometers} km ·{" "}
            {preview.driving!.rateMinorPerKm.toFixed(4)} minor units/km
          </p>
          <p>Total: {money(preview.amountMinor, displayCurrency)}</p>
          <ul aria-label="Driving allocations">
            {preview.allocations.map((allocation) => (
              <li key={allocation.horseId}>
                {horseNames.get(allocation.horseId) ?? allocation.horseId}:{" "}
                {money(allocation.amountMinor, displayCurrency)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {saved && <p role="status">Driving expense saved.</p>}
      <button type="submit" disabled={!isPreviewDraftValid(draft)}>
        {preview && isCurrentPreview
          ? "Refresh driving preview"
          : "Preview driving expense"}
      </button>
      {preview && isCurrentPreview && (
        <button
          type="button"
          disabled={committed}
          onClick={() => void handleCommit()}
        >
          {committed ? "Driving expense saved" : "Save driving expense"}
        </button>
      )}
    </form>
  );
}

function isPreviewDraftValid(draft: DrivingDraftBody): boolean {
  const ids =
    draft.split.mode === "Equal"
      ? draft.split.horseIds
      : draft.split.shares.map((share) => share.horseId);
  return (
    draft.expenseDate.length > 0 &&
    Number.isFinite(draft.kilometers) &&
    draft.kilometers > 0 &&
    draft.description.trim().length > 0 &&
    ids.length > 0
  );
}

function money(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amountMinor / 100);
}
