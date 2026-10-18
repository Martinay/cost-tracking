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
  const [editedValue, setEditedValue] = useState<{
    savedRate: number | null;
    value: string;
  } | null>(null);
  const value =
    editedValue?.savedRate === savedRateMinorPerKm
      ? editedValue.value
      : (savedRateMinorPerKm?.toString() ?? "");
  const [validationError, setValidationError] = useState("");
  const [submissionError, setSubmissionError] = useState("");
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
          ? reason.message
          : "The driving rate could not be saved.",
      );
    }
  }

  return (
    <section aria-labelledby="driving-rate-heading">
      <h2 id="driving-rate-heading">Driving rate</h2>
      {savedRateMinorPerKm === null ? (
        <p>No saved driving rate.</p>
      ) : (
        <p>
          Current saved rate: {savedRateMinorPerKm.toFixed(4)} minor units/km
        </p>
      )}
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="saved-driving-rate">
          Driving rate (minor units per km)
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
            {validationError || submissionError || errorMessage}
          </p>
        )}
        {saved && <p role="status">Driving rate saved.</p>}
        <button type="submit" disabled={pending}>
          {pending ? "Saving driving rate…" : "Save driving rate"}
        </button>
      </form>
    </section>
  );
}
