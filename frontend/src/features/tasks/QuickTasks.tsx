import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Modal } from "../../components/Modal";
import { TASK_TYPES, taskTypeLabel, type TaskType } from "./taskTypes";

export interface QuickTask {
  id: string;
  name: string;
  taskType: TaskType;
  minutes: number;
}

function loadLibrary(key: string): { items: QuickTask[]; error: string } {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null) return { items: [], error: "" };
    const items: unknown = JSON.parse(stored);
    if (!Array.isArray(items)) throw new Error("Invalid shortcut library.");
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const item of items) {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.id !== "string" ||
        !item.id ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        item.name !== item.name.trim() ||
        item.name.length > 60 ||
        !TASK_TYPES.includes(item.taskType as TaskType) ||
        !Number.isSafeInteger(item.minutes) ||
        item.minutes <= 0 ||
        ids.has(item.id) ||
        names.has(item.name.toLowerCase())
      )
        throw new Error("Invalid shortcut library.");
      ids.add(item.id);
      names.add(item.name.toLowerCase());
    }
    return { items: items as QuickTask[], error: "" };
  } catch (error) {
    return {
      items: [],
      error: `Could not load quick tasks from this browser. ${error instanceof Error ? error.message : "Storage is unavailable."}`,
    };
  }
}

export function QuickTasks({
  subject,
  selectedId,
  onSelect,
}: {
  subject: string;
  selectedId?: string;
  onSelect(task: QuickTask | null): void;
}) {
  const storageKey = `horse-ledger:quick-tasks:v1:${subject}`;
  const [library, setLibrary] = useState(() => loadLibrary(storageKey));
  const [managing, setManaging] = useState(false);
  const [editor, setEditor] = useState<QuickTask | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const [writeError, setWriteError] = useState("");

  function persist(items: QuickTask[]): boolean {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(items));
      setLibrary({ items, error: "" });
      setWriteError("");
      return true;
    } catch (error) {
      setWriteError(
        `Could not save quick tasks in this browser. ${error instanceof Error ? error.message : "Storage is unavailable."}`,
      );
      return false;
    }
  }

  return (
    <section aria-labelledby="quick-tasks-heading" className="quick-tasks">
      <h2 id="quick-tasks-heading">Quick tasks</h2>
      <p>Choose a shortcut, review the details, then save your task.</p>
      <p className="quick-task-hint">
        Saved for your account in this browser only; shortcuts do not sync
        between devices.
      </p>
      {library.error && (
        <div role="alert">
          <p>{library.error}</p>
          <button
            type="button"
            onClick={() => setLibrary(loadLibrary(storageKey))}
          >
            Retry loading quick tasks
          </button>
          <button
            type="button"
            onClick={() => {
              if (persist([]))
                setNotice("Quick tasks reset. Recorded tasks are unchanged.");
            }}
          >
            Reset unreadable quick tasks
          </button>
        </div>
      )}
      {writeError && !editor && <p role="alert">{writeError}</p>}
      {!library.error && library.items.length === 0 && (
        <p>
          No quick tasks yet. Add your own, such as Putzen, Reiten or Longieren.
        </p>
      )}
      <ul className="quick-task-list" aria-label="Quick tasks">
        {library.items.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              className="quick-task-choice"
              aria-pressed={selectedId === task.id}
              onClick={() => onSelect(task)}
            >
              <span>{task.name}</span>
              <span>{task.minutes} min</span>
            </button>
            {managing && (
              <div className="quick-task-actions">
                <button
                  type="button"
                  aria-label={`Edit ${task.name}`}
                  onClick={() => {
                    setWriteError("");
                    setEditor(task);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${task.name}`}
                  onClick={() => {
                    if (
                      !persist(
                        library.items.filter((item) => item.id !== task.id),
                      )
                    )
                      return;
                    if (selectedId === task.id) onSelect(null);
                    setNotice(
                      `Quick task ${task.name} deleted. Recorded tasks are unchanged.`,
                    );
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="quick-task-actions">
        <button
          type="button"
          disabled={Boolean(library.error)}
          onClick={() => {
            setWriteError("");
            setEditor("new");
          }}
        >
          New quick task
        </button>
        {library.items.length > 0 && (
          <button
            type="button"
            aria-expanded={managing}
            onClick={() => setManaging(!managing)}
          >
            {managing ? "Done managing" : "Manage quick tasks"}
          </button>
        )}
        {selectedId && (
          <button type="button" onClick={() => onSelect(null)}>
            Clear shortcut
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {editor &&
        createPortal(
          <QuickTaskEditor
            task={editor === "new" ? undefined : editor}
            errorMessage={writeError}
            onClose={() => setEditor(null)}
            onSave={(draft) => {
              const name = draft.name.trim();
              if (
                library.items.some(
                  (item) =>
                    item.id !== draft.id &&
                    item.name.toLowerCase() === name.toLowerCase(),
                )
              )
                return "A quick task with this name already exists.";
              const value = { ...draft, name };
              const items =
                editor === "new"
                  ? [...library.items, value]
                  : library.items.map((item) =>
                      item.id === value.id ? value : item,
                    );
              if (!persist(items)) return null;
              if (selectedId === value.id) onSelect(value);
              setEditor(null);
              setNotice(`Quick task ${value.name} saved.`);
              return null;
            }}
          />,
          document.body,
        )}
    </section>
  );
}

function QuickTaskEditor({
  task,
  errorMessage,
  onClose,
  onSave,
}: {
  task?: QuickTask;
  errorMessage: string;
  onClose(): void;
  onSave(task: QuickTask): string | null;
}) {
  const [name, setName] = useState(task?.name ?? "");
  const [taskType, setTaskType] = useState<TaskType>(task?.taskType ?? "Other");
  const [minutes, setMinutes] = useState(task ? String(task.minutes) : "");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!name.trim() || name.trim().length > 60)
      return setError("Enter a name between 1 and 60 characters.");
    const value = Number(minutes);
    if (!Number.isSafeInteger(value) || value <= 0)
      return setError("Enter positive whole minutes.");
    setError(
      onSave({
        id: task?.id ?? crypto.randomUUID(),
        name,
        taskType,
        minutes: value,
      }) ?? "",
    );
  }
  return (
    <Modal labelledBy="quick-task-editor-heading" onClose={onClose}>
      <h2 id="quick-task-editor-heading">
        {task ? "Edit quick task" : "New quick task"}
      </h2>
      <p>Save a name and usual duration to reuse for any horse.</p>
      <form onSubmit={submit} noValidate>
        <label htmlFor="quick-task-name">Name</label>
        <input
          id="quick-task-name"
          value={name}
          maxLength={60}
          placeholder="e.g. Putzen"
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <label htmlFor="quick-task-type">Activity type</label>
        <select
          id="quick-task-type"
          value={taskType}
          onChange={(event) =>
            setTaskType(event.currentTarget.value as TaskType)
          }
        >
          {TASK_TYPES.map((type) => (
            <option key={type} value={type}>
              {taskTypeLabel(type)}
            </option>
          ))}
        </select>
        <label htmlFor="quick-task-minutes">Default minutes</label>
        <input
          id="quick-task-minutes"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          value={minutes}
          onChange={(event) => setMinutes(event.currentTarget.value)}
        />
        {(error || errorMessage) && <p role="alert">{error || errorMessage}</p>}
        <div className="form-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Save quick task</button>
        </div>
      </form>
    </Modal>
  );
}
