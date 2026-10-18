import { useState, type FormEvent } from "react";

export type TaskType =
  | "Riding"
  | "Groundwork"
  | "Lunging"
  | "Grooming"
  | "MedicalCare"
  | "PaddockDuty"
  | "Transportation"
  | "Other";
export interface TaskHorseOption {
  horseId: string;
  name: string;
}
export interface TaskCommandBody {
  horseId: string;
  taskDate: string;
  taskType: TaskType;
  minutes: number;
  quantity?: number;
  quantityUnit?: string;
  notes: string;
}
export interface TaskFormProps {
  horses: TaskHorseOption[];
  today: string;
  onSubmit: (value: TaskCommandBody) => Promise<void>;
  pending?: boolean;
  errorMessage?: string;
}

const TASK_TYPES: TaskType[] = [
  "Riding",
  "Groundwork",
  "Lunging",
  "Grooming",
  "MedicalCare",
  "PaddockDuty",
  "Transportation",
  "Other",
];

export function TaskForm({
  horses,
  today,
  onSubmit,
  pending = false,
  errorMessage,
}: TaskFormProps) {
  const [horseId, setHorseId] = useState("");
  const [taskDate, setTaskDate] = useState(today);
  const [taskType, setTaskType] = useState<TaskType>("Riding");
  const [minutes, setMinutes] = useState("");
  const [quantity, setQuantity] = useState("");
  const [quantityUnit, setQuantityUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [validationError, setValidationError] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const parsedMinutes = minutes.trim() === "" ? 0 : Number(minutes);
    const parsedQuantity =
      quantity.trim() === "" ? undefined : Number(quantity);
    if (!horseId) return setValidationError("Choose a horse.");
    if (!taskDate) return setValidationError("Choose a task date.");
    if (!Number.isSafeInteger(parsedMinutes) || parsedMinutes < 0)
      return setValidationError("Enter whole, nonnegative minutes.");
    if (
      parsedQuantity !== undefined &&
      (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0)
    )
      return setValidationError("Enter a positive quantity.");
    if (parsedQuantity !== undefined && !quantityUnit.trim())
      return setValidationError("Enter a quantity unit.");
    if (parsedQuantity === undefined && quantityUnit.trim())
      return setValidationError("Enter a quantity with its unit.");
    if (parsedMinutes === 0 && parsedQuantity === undefined)
      return setValidationError("Enter minutes or a quantity for the task.");
    setValidationError("");
    setSubmissionError("");
    const body: TaskCommandBody = {
      horseId,
      taskDate,
      taskType,
      minutes: parsedMinutes,
      ...(parsedQuantity === undefined
        ? {}
        : { quantity: parsedQuantity, quantityUnit: quantityUnit.trim() }),
      notes,
    };
    try {
      await onSubmit(body);
      setSaved(true);
    } catch (error) {
      setSubmissionError(
        error instanceof Error ? error.message : "The task could not be saved.",
      );
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <label htmlFor="task-horse">Horse</label>
      <select
        id="task-horse"
        value={horseId}
        onChange={(event) => setHorseId(event.currentTarget.value)}
        required
      >
        <option value="">Choose a horse</option>
        {horses.map((horse) => (
          <option key={horse.horseId} value={horse.horseId}>
            {horse.name}
          </option>
        ))}
      </select>
      <label htmlFor="task-date">Task date</label>
      <input
        id="task-date"
        type="date"
        value={taskDate}
        max={today}
        onChange={(event) => setTaskDate(event.currentTarget.value)}
        required
      />
      <label htmlFor="task-type">Task type</label>
      <select
        id="task-type"
        value={taskType}
        onChange={(event) => setTaskType(event.currentTarget.value as TaskType)}
      >
        {TASK_TYPES.map((type) => (
          <option key={type} value={type}>
            {type.replace(/([a-z])([A-Z])/g, "$1 $2")}
          </option>
        ))}
      </select>
      <label htmlFor="task-minutes">Minutes</label>
      <input
        id="task-minutes"
        type="number"
        inputMode="numeric"
        min="0"
        step="1"
        value={minutes}
        onChange={(event) => setMinutes(event.currentTarget.value)}
      />
      <label htmlFor="task-quantity">Quantity</label>
      <input
        id="task-quantity"
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={quantity}
        onChange={(event) => setQuantity(event.currentTarget.value)}
      />
      <label htmlFor="task-quantity-unit">Quantity unit</label>
      <input
        id="task-quantity-unit"
        maxLength={30}
        value={quantityUnit}
        onChange={(event) => setQuantityUnit(event.currentTarget.value)}
      />
      <label htmlFor="task-notes">Notes</label>
      <textarea
        id="task-notes"
        maxLength={1000}
        value={notes}
        onChange={(event) => setNotes(event.currentTarget.value)}
      />
      {(validationError || submissionError || errorMessage) && (
        <p role="alert">{validationError || submissionError || errorMessage}</p>
      )}
      {saved && <p role="status">Task saved.</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Saving task…" : "Save task"}
      </button>
    </form>
  );
}
