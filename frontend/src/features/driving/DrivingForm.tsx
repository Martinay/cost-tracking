import {
  parseRateMajor,
  formatRate,
  ratePrecision,
  currencySymbol,
} from "./rate";
import { useDraftState } from "../finance/useDraftState";
import { formatMoney as money } from "../../i18n/format";
import { useI18n } from "../../i18n/I18nProvider";
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
  draftScope?: string | null;
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
  draftScope,
  today,
  currency,
  savedRateMinorPerKm,
  onPreview,
  onCommit,
}: DrivingFormProps) {
  const { t, locale } = useI18n();
  const [expenseDate, setExpenseDate] = useDraftState(
    draftScope,
    "driving-expenseDate",
    today,
  );
  const [kilometers, setKilometers] = useDraftState(
    draftScope,
    "driving-kilometers",
    "",
  );
  const [rateMinorPerKm, setRateMinorPerKm] = useDraftState(
    draftScope,
    "driving-rateMinorPerKm",
    "",
  );
  const [description, setDescription] = useDraftState(
    draftScope,
    "driving-description",
    "",
  );
  const [split, setSplit] = useDraftState<SplitValue>(
    draftScope,
    "driving-split",
    {
      mode: "Equal",
      horseIds: [],
    },
  );
  const [preview, setPreview] = useState<DrivingPreview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [error, setError] = useState<string | Error>("");
  const [saved, setSaved] = useState(false);
  const [committed, setCommitted] = useState(false);
  const requestGeneration = useRef(0);
  const distance = Number(kilometers);
  const rate =
    rateMinorPerKm.trim() === ""
      ? undefined
      : parseRateMajor(rateMinorPerKm, currency);
  const draft: DrivingDraftBody = {
    expenseDate,
    kilometers: distance,
    ...(rate === undefined ? {} : { rateMinorPerKm: rate }),
    description,
    split,
  };
  const key = JSON.stringify({ draftScope, draft });
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
        (rateMinorPerKm.split(".")[1]?.length ?? 0) >
          ratePrecision(currency) + 4)
    ) {
      setError("Enter a positive rate within supported precision.");
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
    const capturedKey = key;
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
          reason instanceof Error ? reason : "The trip could not be previewed.",
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
      setKilometers("");
      setRateMinorPerKm("");
      setDescription("");
      setSplit({ mode: "Equal", horseIds: [] });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason
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
      <label htmlFor="driving-date">{t("Trip date")}</label>
      <input
        id="driving-date"
        type="date"
        max={today}
        value={expenseDate}
        onChange={(event) => update(setExpenseDate, event.currentTarget.value)}
        required
      />
      <label htmlFor="driving-distance">{t("Distance (km)")}</label>
      <input
        id="driving-distance"
        type="number"
        min="0.001"
        step="0.001"
        value={kilometers}
        onChange={(event) => update(setKilometers, event.currentTarget.value)}
        required
      />
      <label htmlFor="driving-rate">
        {t("Rate per km ({currency}/km, optional)", {
          currency: currencySymbol(currency, locale),
        })}
      </label>
      <input
        id="driving-rate"
        type="number"
        min={10 ** -(ratePrecision(currency) + 4)}
        max={1_000_000 / 10 ** ratePrecision(currency)}
        step={10 ** -(ratePrecision(currency) + 4)}
        value={rateMinorPerKm}
        onChange={(event) =>
          update(setRateMinorPerKm, event.currentTarget.value)
        }
      />
      <p>
        {savedRateMinorPerKm === null
          ? t(
              "No saved driving rate; enter one for this trip or save one in settings.",
            )
          : t("Saved rate: {value0}/km. Leave the rate blank to use it.", {
              value0: formatRate(savedRateMinorPerKm, currency, locale),
            })}
      </p>
      <label htmlFor="driving-description">{t("Description")}</label>
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
      {error && <p role="alert">{t(error)}</p>}
      {preview && isCurrentPreview && (
        <section aria-label={t("Driving expense preview")}>
          <h3>{t("Driving expense preview")}</h3>
          <p>
            {preview.driving!.kilometers} {t("km ·")}{" "}
            {formatRate(
              preview.driving!.rateMinorPerKm,
              displayCurrency,
              locale,
            )}{" "}
            {t("per km")}
          </p>
          <p>
            {t("Total: ")}
            {money(preview.amountMinor, displayCurrency, locale)}
          </p>
          <ul aria-label={t("Driving allocations")}>
            {preview.allocations.map((allocation) => (
              <li key={allocation.horseId}>
                {horseNames.get(allocation.horseId) ?? allocation.horseId}:{" "}
                {money(allocation.amountMinor, displayCurrency, locale)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {saved && <p role="status">{t("Driving expense saved.")}</p>}
      <button type="submit" disabled={!isPreviewDraftValid(draft)}>
        {preview && isCurrentPreview
          ? t("Refresh driving preview")
          : t("Preview driving expense")}
      </button>
      {preview && isCurrentPreview && (
        <button
          type="button"
          disabled={committed}
          onClick={() => void handleCommit()}
        >
          {committed ? t("Driving expense saved") : t("Save driving expense")}
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
