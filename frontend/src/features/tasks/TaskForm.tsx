import { useRef, useState, type FormEvent } from "react";
import { QuickTasks, type QuickTask } from "./QuickTasks";
import { TASK_TYPES, taskTypeLabel, type TaskType } from "./taskTypes";

export type { TaskType } from "./taskTypes";
export interface TaskHorseOption {
  horseId: string;
  name: string;
}
export interface TaskCommandBody {
  horseId: string;
  taskDate: string;
  taskType: TaskType;
  minutes: number;
  notes: string;
}
export interface TaskFormProps {
  horses: TaskHorseOption[];
  today: string;
  subject: string;
  onSubmit: (value: TaskCommandBody) => Promise<void>;
  pending?: boolean;
  errorMessage?: string;
}

export function TaskForm({
  horses,
  today,
  subject,
  onSubmit,
  pending = false,
  errorMessage,
}: TaskFormProps) {
  const [horseId, setHorseId] = useState("");
  const [taskDate, setTaskDate] = useState(today);
  const [taskType, setTaskType] = useState<TaskType>("Riding");
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<QuickTask | null>(null);
  const [validationError, setValidationError] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const busy = pending || saving;
  const notesLimit = selected ? 1000 - selected.name.length - 1 : 1000;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submitting.current) return;
    setSaved(false);
    const parsedMinutes = Number(minutes);
    if (!horseId) return setValidationError("Choose a horse.");
    if (!taskDate || taskDate > today)
      return setValidationError("Choose a task date on or before today.");
    if (!Number.isSafeInteger(parsedMinutes) || parsedMinutes <= 0)
      return setValidationError("Enter positive whole minutes.");
    const savedNotes = selected
      ? [selected.name, notes].filter(Boolean).join("\n")
      : notes;
    if (savedNotes.length > 1000)
      return setValidationError(
        "Shorten the notes to fit with the quick task name (1000 characters total).",
      );
    setValidationError("");
    setSubmissionError("");
    submitting.current = true;
    setSaving(true);
    try {
      await onSubmit({
        horseId,
        taskDate,
        taskType,
        minutes: parsedMinutes,
        notes: savedNotes,
      });
      setSaved(true);
    } catch (error) {
      setSubmissionError(
        error instanceof Error ? error.message : "The task could not be saved.",
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <form
      className="task-form"
      noValidate
      onSubmit={(event) => void submit(event)}
      onChange={() => setSaved(false)}
    >
      <h2>Log a task</h2>
      <fieldset className="task-fields" disabled={busy}>
        <legend className="sr-only">Task details</legend>
        <div className="field-grid">
          <div>
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
            {horses.length === 0 && (
              <p>Add an active or leased horse before logging tasks.</p>
            )}
          </div>
          <div>
            <label htmlFor="task-date">Task date</label>
            <input
              id="task-date"
              type="date"
              value={taskDate}
              max={today}
              onChange={(event) => setTaskDate(event.currentTarget.value)}
              required
            />
          </div>
        </div>
        <QuickTasks
          subject={subject}
          selectedId={selected?.id}
          onSelect={(task) => {
            setSelected(task);
            setSaved(false);
            if (task) {
              setTaskType(task.taskType);
              setMinutes(String(task.minutes));
            }
          }}
        />
        {selected && (
          <p className="selected-quick-task">
            Using <strong>{selected.name}</strong>. Adjust the details for this
            task below.
          </p>
        )}
        <div className="field-grid">
          <div>
            <label htmlFor="task-type">Task type</label>
            <select
              id="task-type"
              value={taskType}
              onChange={(event) => {
                setTaskType(event.currentTarget.value as TaskType);
                setSelected(null);
              }}
            >
              {TASK_TYPES.map((type) => (
                <option key={type} value={type}>
                  {taskTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="task-minutes">Minutes</label>
            <input
              id="task-minutes"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={minutes}
              onChange={(event) => setMinutes(event.currentTarget.value)}
            />
          </div>
        </div>
        <label htmlFor="task-notes">Notes</label>
        <textarea
          id="task-notes"
          maxLength={notesLimit}
          value={notes}
          onChange={(event) => setNotes(event.currentTarget.value)}
        />
      </fieldset>
      {(validationError || submissionError || errorMessage) && (
        <p role="alert">{validationError || submissionError || errorMessage}</p>
      )}
      {saved && <p role="status">Task saved.</p>}
      <button type="submit" disabled={busy || horses.length === 0}>
        {busy ? "Saving task…" : "Save task"}
      </button>
    </form>
  );
}
