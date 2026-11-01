# Feature Specification: Simple task entry and quick tasks

**Feature Branch**: `004-quick-tasks`
**Created**: 2026-11-01
**Status**: Accepted for implementation
**Input**: Remove Quantity and Quantity unit from task creation; let owners define quick tasks such as Putzen, Reiten and Longieren and quickly assign them to a horse. Commit and push when done.

## User Scenarios & Testing

### User Story 1 - Log a task without quantity fields (Priority: P1)
An owner selects a horse, date, activity type and minutes, optionally adds notes and saves.
**Why this priority**: Removes two irrelevant fields from every task entry.
**Independent Test**: Save a 20-minute grooming task using only the keyboard.
**Acceptance Scenarios**:
1. Given an active or leased horse, when the owner enters a positive whole duration and saves, then the task and activity summary update after acknowledgment.
2. Given invalid minutes or a failed save, when submitting, then a clear error appears and the draft remains.
3. Given historical quantity-based tasks, when reviewing activity, then their original quantities remain readable.

### User Story 2 - Define and reuse quick tasks (Priority: P1)
An owner creates named shortcuts with an activity type and default duration, then chooses a horse and taps a shortcut to prepare a task.
**Why this priority**: Repeated care activities should not require repetitive typing.
**Independent Test**: Create Putzen, reuse it for two horses, reload and reuse it again.
**Acceptance Scenarios**:
1. Given no saved shortcuts, when the owner opens Tasks, then an explanation and New quick task action are visible; examples are suggestions, not saved records.
2. Given a valid custom name, type and positive whole duration, when saving a shortcut, then it appears as a named button showing minutes.
3. Given a selected horse and date, when tapping a shortcut, then its type and minutes fill the task draft while the horse and date stay selected; no task is created until Save task.
4. Given a selected shortcut, when saving a task with additional notes, then the custom name and notes are preserved in the activity record.
5. Given a saved shortcut, when editing or deleting it through Manage quick tasks, then the library updates without changing existing task records.
6. Given another signed-in account, when visiting Tasks, then shortcuts from the previous account are not shown.

### Edge Cases
- Blank/duplicate names, names over 60 characters, invalid/fractional/nonpositive durations, unknown types, empty horse lists, long names, storage unavailable or malformed.
- Deleting the last shortcut keeps the empty library empty after reload; cancel/Escape discards editor changes.
- Pending task submission disables the draft and prevents duplicate submission.

## Requirements
### Functional Requirements
- **FR-001**: Task creation MUST omit both quantity controls and require positive whole minutes.
- **FR-002**: Owners MUST create, edit and remove quick tasks with trimmed unique names (1–60 characters), an existing activity type and positive whole default minutes.
- **FR-003**: Shortcut buttons MUST show the custom name and duration, expose selection accessibly and fill a reviewable draft without submitting.
- **FR-004**: Horse and date MUST remain selected when applying shortcuts or saving tasks; a custom name MUST remain visible in recorded activity.
- **FR-005**: Quick tasks MUST survive reload for the same account in this browser; the interface MUST clearly explain that they do not sync between devices.
- **FR-006**: Storage or server failures MUST be visible and preserve drafts without claiming success.
- **FR-007**: Keyboard and 375px mobile use MUST support all primary actions; modal focus MUST restore to its trigger.
- **FR-008**: Existing activity history, account isolation and financial calculations MUST remain intact.

### Key Entities
- Quick task: local shortcut with stable identity, owner scope, custom name, activity type and default duration.
- Logged task: existing permanent care record belonging to one horse; custom shortcut name is retained with notes.

## Success Criteria
### Measurable Outcomes
- **SC-001**: No quantity controls occur in task creation.
- **SC-002**: Once a horse is selected, a saved shortcut can be assigned with two button activations (shortcut, Save task).
- **SC-003**: Create, rename, change duration, reuse, delete and reload scenarios pass keyboard-based acceptance checks.
- **SC-004**: At 375px and desktop width, the task form and shortcut editor have no horizontal page overflow.

## Assumptions
- Tasks record completed effort, as in the existing application; this feature does not introduce scheduling.
- Positive minutes remain required by the existing effort model.
- Shortcut preferences are account-scoped on this browser, explicitly disclosed; logged tasks retain existing server durability.
- Existing activity types remain the reporting categories; custom shortcut names appear in task notes.
