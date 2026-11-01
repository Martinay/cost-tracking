import { useI18n } from "../../i18n/I18nProvider";
import { useState, type FormEvent } from "react";

export interface DrivingRateFormProps {
  savedRateMinorPerKm: number | null;
  pending?: boolean;
  errorMessage?: string;
  onSave(rateMinorPerKm: number): Promise<void>;
}

export function DrivingRateForm({
  savedRateMinorPerKm,
  pending = false,
  errorMessage,
  onSave,
}: DrivingRateFormProps) {
  const { t } = useI18n();
  const [editedValue, setEditedValue] = useState<{
    savedRate: number | null;
    value: string;
  } | null>(null);
  const value =
    editedValue?.savedRate === savedRateMinorPerKm
      ? editedValue.value
      : (savedRateMinorPerKm?.toString() ?? "");
  const [validationError, setValidationError] = useState("");
  const [submissionError, setSubmissionError] = useState<string | Error>("");
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setSubmissionError("");
    const rate = Number(value);
    if (
      !value.trim() ||
      !Number.isFinite(rate) ||
      rate <= 0 ||
      rate > 1_000_000 ||
      (value.split(".")[1]?.length ?? 0) > 4
    ) {
      setValidationError(
        "Enter a positive rate with no more than four decimal places.",
      );
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
        <span className="section-number">02</span>
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
          {savedRateMinorPerKm.toFixed(4)} {t("minor units/km")}
        </p>
      )}
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="saved-driving-rate">
          {t("Driving rate (minor units per km)")}
        </label>
        <input
          id="saved-driving-rate"
          type="number"
          min="0.0001"
          max="1000000"
          step="0.0001"
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
          {t("Enter minor currency units per km. For EUR, 30 means €0.30/km.")}
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
