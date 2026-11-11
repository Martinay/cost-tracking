import { useDraftState } from "../finance/useDraftState";
import { useI18n } from "../../i18n/I18nProvider";
import { useId, useState, type FormEvent } from "react";

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
  draftScope?: string | null;
  initial?: TaskCommandBody;
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
  draftScope,
  initial,
  today,
  onSubmit,
  pending = false,
  errorMessage,
}: TaskFormProps) {
  const { t } = useI18n();
  const fieldId = useId();
  const [horseId, setHorseId] = useDraftState(
    draftScope,
    "task-horseId",
    initial?.horseId ?? "",
  );
  const [taskDate, setTaskDate] = useDraftState(
    draftScope,
    "task-taskDate",
    initial?.taskDate ?? today,
  );
  const [taskType, setTaskType] = useDraftState<TaskType>(
    draftScope,
    "task-taskType",
    initial?.taskType ?? "Riding",
  );
  const [minutes, setMinutes] = useDraftState(
    draftScope,
    "task-minutes",
    initial?.minutes?.toString() ?? "",
  );
  const [quantity, setQuantity] = useDraftState(
    draftScope,
    "task-quantity",
    initial?.quantity?.toString() ?? "",
  );
  const [quantityUnit, setQuantityUnit] = useDraftState(
    draftScope,
    "task-quantityUnit",
    initial?.quantityUnit?.toString() ?? "",
  );
  const [notes, setNotes] = useDraftState(
    draftScope,
    "task-notes",
    initial?.notes ?? "",
  );
  const [validationError, setValidationError] = useState("");
  const [submissionError, setSubmissionError] = useState<string | Error>("");
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
      setHorseId("");
      setMinutes("");
      setQuantity("");
      setQuantityUnit("");
      setNotes("");
      setSaved(true);
    } catch (error) {
      setSubmissionError(
        error instanceof Error ? error : "The task could not be saved.",
      );
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <p>
        {t(
          "Record time, quantity, or both. Add a unit when recording a quantity. Notes are optional.",
        )}
      </p>
      <label htmlFor={`${fieldId}-horse`}>{t("Horse")}</label>
      <select
        id={`${fieldId}-horse`}
        value={horseId}
        onChange={(event) => setHorseId(event.currentTarget.value)}
        required
      >
        <option value="">{t("Choose a horse")}</option>
        {horses.map((horse) => (
          <option key={horse.horseId} value={horse.horseId}>
            {horse.name}
          </option>
        ))}
      </select>
      <label htmlFor={`${fieldId}-date`}>{t("Task date")}</label>
      <input
        id={`${fieldId}-date`}
        type="date"
        value={taskDate}
        max={today}
        onChange={(event) => setTaskDate(event.currentTarget.value)}
        required
      />
      <label htmlFor={`${fieldId}-type`}>{t("Task type")}</label>
      <select
        id={`${fieldId}-type`}
        value={taskType}
        onChange={(event) => setTaskType(event.currentTarget.value as TaskType)}
      >
        {TASK_TYPES.map((type) => (
          <option key={type} value={type}>
            {t(type)}
          </option>
        ))}
      </select>
      <label htmlFor={`${fieldId}-minutes`}>{t("Minutes")}</label>
      <input
        id={`${fieldId}-minutes`}
        type="number"
        inputMode="numeric"
        min="0"
        step="1"
        value={minutes}
        onChange={(event) => setMinutes(event.currentTarget.value)}
      />
      <label htmlFor={`${fieldId}-quantity`}>{t("Quantity")}</label>
      <input
        id={`${fieldId}-quantity`}
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        value={quantity}
        onChange={(event) => setQuantity(event.currentTarget.value)}
      />
      <label htmlFor={`${fieldId}-quantity-unit`}>{t("Quantity unit")}</label>
      <input
        id={`${fieldId}-quantity-unit`}
        maxLength={30}
        value={quantityUnit}
        onChange={(event) => setQuantityUnit(event.currentTarget.value)}
      />
      <label htmlFor={`${fieldId}-notes`}>{t("Notes")}</label>
      <textarea
        id={`${fieldId}-notes`}
        maxLength={1000}
        value={notes}
        onChange={(event) => setNotes(event.currentTarget.value)}
      />
      {(validationError || submissionError || errorMessage) && (
        <p role="alert">
          {t(validationError) || t(submissionError) || t(errorMessage)}
        </p>
      )}
      {saved && <p role="status">{t("Task saved.")}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t("Saving task…") : t("Save task")}
      </button>
    </form>
  );
}
