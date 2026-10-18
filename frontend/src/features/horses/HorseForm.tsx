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
      <label htmlFor="horse-name">Name</label>
      <input
        autoComplete="off"
        id="horse-name"
        maxLength={100}
        name="name"
        onChange={(event) => setName(event.currentTarget.value)}
        required
        value={name}
      />
      <label htmlFor="horse-breed">Breed</label>
      <input
        autoComplete="off"
        id="horse-breed"
        maxLength={100}
        name="breed"
        onChange={(event) => setBreed(event.currentTarget.value)}
        value={breed}
      />
      <label htmlFor="horse-date-of-birth">Date of birth</label>
      <input
        id="horse-date-of-birth"
        name="dateOfBirth"
        onChange={(event) => setDateOfBirth(event.currentTarget.value)}
        type="date"
        value={dateOfBirth}
      />
      {mode === "create" && (
        <>
          <label htmlFor="horse-status">Status</label>
          <select
            id="horse-status"
            name="status"
            onChange={(event) =>
              setStatus(event.currentTarget.value as HorseStatus)
            }
            value={status}
          >
            <option value="Active">Active</option>
            <option value="Leased">Leased</option>
          </select>
        </>
      )}
      {errorMessage && <p role="alert">{errorMessage}</p>}
      <button disabled={isSaving} type="submit">
        {isSaving ? "Saving horse…" : "Save horse"}
      </button>
      {onCancel && (
        <button disabled={isSaving} onClick={onCancel} type="button">
          Cancel
        </button>
      )}
    </form>
  );
}
