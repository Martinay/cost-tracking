# Data model

QuickTask: `id: string`, `name: string` (trimmed, 1–60 characters, case-insensitively unique), `taskType: TaskType` (existing generated request enum), `minutes: number` (positive safe integer).
Library: JSON array at `horse-ledger:quick-tasks:v1:<subject>`. No tokens, horse IDs or task history stored. Read validates the entire array; invalid data is reported, not silently overwritten. Failed writes keep the editor draft and existing library. Missing storage value means empty library.
TaskCommandBody: existing horseId, taskDate, taskType, positive integer minutes, notes; no quantity fields emitted. With a selected shortcut, notes are name + optional newline + user notes, maximum 1000 characters combined.
State: empty library → create → apply → optionally edit/delete. Apply changes only type/minutes/name; horse/date/user notes remain. Subject change remounts TaskForm. Historical quantity rendering and server validation are unchanged.
