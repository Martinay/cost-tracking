import { useI18n } from "../../i18n/I18nProvider";
import { useState, type FormEvent } from "react";

export type HorseStatus = "Active" | "Leased" | "Retired" | "Sold";

export interface HorseFormValue {
  name: string;
  breed: string;
  dateOfBirth: string | null;
  status: HorseStatus;
}

export interface HorseFormProps {
  mode: "create" | "edit";
  initialValue?: HorseFormValue;
  onSubmit(value: HorseFormValue): Promise<void> | void;
  onCancel?(): void;
  errorMessage?: string;
  isSaving?: boolean;
}

export function HorseForm({
  mode,
  initialValue,
  onSubmit,
  onCancel,
  errorMessage,
  isSaving = false,
}: HorseFormProps) {
  const { t } = useI18n();
  const [name, setName] = useState(initialValue?.name ?? "");
  const [breed, setBreed] = useState(initialValue?.breed ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(
    initialValue?.dateOfBirth ?? "",
  );
  const [status, setStatus] = useState<HorseStatus>(
    initialValue?.status ?? "Active",
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      await onSubmit({
        name: name.trim(),
        breed: breed.trim(),
        dateOfBirth: dateOfBirth || null,
        status,
      });
    } catch {
      // The route owns visible command errors; keep the controlled draft in place.
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <label htmlFor="horse-name">{t("Name")}</label>
      <input
        autoComplete="off"
        id="horse-name"
        maxLength={100}
        name="name"
        onChange={(event) => setName(event.currentTarget.value)}
        required
        value={name}
      />
      <label htmlFor="horse-breed">
        {t("Breed")} · {t("optional")}
      </label>
      <input
        autoComplete="off"
        id="horse-breed"
        maxLength={100}
        name="breed"
        onChange={(event) => setBreed(event.currentTarget.value)}
        value={breed}
      />
      <label htmlFor="horse-date-of-birth">
        {t("Date of birth")} · {t("optional")}
      </label>
      <input
        id="horse-date-of-birth"
        name="dateOfBirth"
        onChange={(event) => setDateOfBirth(event.currentTarget.value)}
        type="date"
        value={dateOfBirth}
      />
      {mode === "create" && (
        <>
          <label htmlFor="horse-status">{t("Status")}</label>
          <select
            id="horse-status"
            name="status"
            onChange={(event) =>
              setStatus(event.currentTarget.value as HorseStatus)
            }
            value={t(status)}
          >
            <option value="Active">{t("Active")}</option>
            <option value="Leased">{t("Leased")}</option>
          </select>
        </>
      )}
      {errorMessage && <p role="alert">{t(errorMessage)}</p>}
      <button disabled={isSaving} type="submit">
        {isSaving ? t("Saving horse…") : t("Save horse")}
      </button>
      {onCancel && (
        <button disabled={isSaving} onClick={onCancel} type="button">
          {t("Cancel")}
        </button>
      )}
    </form>
  );
}
