import {
  parseRateMajor,
  formatRate,
  ratePrecision,
  currencySymbol,
} from "./rate";
import { useI18n } from "../../i18n/I18nProvider";
import { useState, type FormEvent } from "react";

export interface DrivingRateFormProps {
  savedRateMinorPerKm: number | null;
  currency?: string;
  pending?: boolean;
  errorMessage?: string;
  onSave(rateMinorPerKm: number): Promise<void>;
}

export function DrivingRateForm({
  savedRateMinorPerKm,
  currency = "EUR",
  pending = false,
  errorMessage,
  onSave,
}: DrivingRateFormProps) {
  const { t, locale } = useI18n();
  const [editedValue, setEditedValue] = useState<{
    savedRate: number | null;
    value: string;
  } | null>(null);
  const value =
    editedValue?.savedRate === savedRateMinorPerKm
      ? editedValue.value
      : ((savedRateMinorPerKm === null
          ? undefined
          : (savedRateMinorPerKm / 10 ** ratePrecision(currency)).toFixed(
              ratePrecision(currency) + 4,
            )) ?? "");
  const [validationError, setValidationError] = useState("");
  const [submissionError, setSubmissionError] = useState<string | Error>("");
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setSubmissionError("");
    const rate = parseRateMajor(value, currency);
    if (
      !value.trim() ||
      !Number.isFinite(rate) ||
      rate <= 0 ||
      rate > 1_000_000 ||
      (value.split(".")[1]?.length ?? 0) > ratePrecision(currency) + 4
    ) {
      setValidationError("Enter a positive rate within supported precision.");
      return;
    }
    setValidationError("");
    try {
      await onSave(rate);
      setSaved(true);
    } catch (reason) {
      setSubmissionError(
        reason instanceof Error
          ? reason
          : "The driving rate could not be saved.",
      );
    }
  }

  return (
    <section className="settings-card" aria-labelledby="driving-rate-heading">
      <div className="card-heading">
        <span className="section-number">01</span>
        <div>
          <h2 id="driving-rate-heading">{t("Driving rate")}</h2>
          <p>{t("Your default rate for journeys to and from the stable.")}</p>
        </div>
      </div>
      {savedRateMinorPerKm === null ? (
        <p className="inline-note">{t("No saved driving rate.")}</p>
      ) : (
        <p>
          {t("Current saved rate: ")}
          {formatRate(savedRateMinorPerKm, currency, locale)} {t("per km")}
        </p>
      )}
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="saved-driving-rate">
          {t("Driving rate ({currency}/km)", {
            currency: currencySymbol(currency, locale),
          })}
        </label>
        <input
          id="saved-driving-rate"
          type="number"
          min={10 ** -(ratePrecision(currency) + 4)}
          max={1_000_000 / 10 ** ratePrecision(currency)}
          step={10 ** -(ratePrecision(currency) + 4)}
          value={value}
          onChange={(event) => {
            setEditedValue({
              savedRate: savedRateMinorPerKm,
              value: event.currentTarget.value,
            });
            setSaved(false);
            setValidationError("");
            setSubmissionError("");
          }}
          required
        />
        {(validationError || submissionError || errorMessage) && (
          <p role="alert">
            {t(validationError) || t(submissionError) || t(errorMessage)}
          </p>
        )}
        {saved && <p role="status">{t("Driving rate saved.")}</p>}
        <p className="field-hint">
          {t("Enter a rate in {currency} per km, for example {example}/km.", {
            currency,
            example: formatRate(30, currency, locale),
          })}
        </p>
        <div className="form-footer">
          <button type="submit" disabled={pending}>
            {pending ? t("Saving driving rate…") : t("Save driving rate")}
          </button>
        </div>
      </form>
    </section>
  );
}
