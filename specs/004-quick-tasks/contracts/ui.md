# UI contract

Tasks retains existing routes, account queries and task mutation/invalidation semantics. Form order: horse/date, Quick tasks section (hint, named buttons showing minutes, New quick task / Manage quick tasks), activity type/minutes, optional notes, Save task.
Shortcut button uses aria-pressed and never submits. New/edit modal has Name, Activity type and Default minutes, Save quick task and Cancel. Manage mode exposes named Edit and Delete buttons; deletion only removes a local reusable shortcut. No prepopulated user records; examples appear in helper text.
Positive whole minutes required; no quantity/unit controls. Show storage failures with role=alert and preserve drafts. Success only follows successful storage write or server acknowledgment. Disable task fields during mutation. Existing API schema unchanged; custom names persist in notes. Preferences remain local to the current account/browser with explicit disclosure.

Unreadable libraries offer Retry loading and an explicit Reset unreadable quick tasks action. Only that explicit action replaces unreadable preferences with an empty list; task history is unaffected.
