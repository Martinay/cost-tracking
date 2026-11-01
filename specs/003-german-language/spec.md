# Feature Specification: Multilanguage support with German

**Feature Branch**: `codex/add-german-language`
**Created**: 2026-11-01
**Status**: Ready for implementation
**Input**: User description: "Use speckkit workflow. Add multilanguage support. Add german language"

## User Scenarios & Testing

### User Story 1 - Choose the interface language (Priority: P1)

A user selects English or Deutsch through an accessible language control, including before signing in. The interface changes immediately and remembers the choice in this browser.

**Why this priority**: The primary task is choosing a comprehensible interface without instructions.
**Independent Test**: Select Deutsch by keyboard, reload, and select English again.

**Acceptance Scenarios**:
1. **Given** no preference, **When** opening the application, **Then** English is shown.
2. **Given** English, **When** selecting Deutsch, **Then** navigation and sign-in text change immediately and the document language is German.
3. **Given** German selected, **When** reloading or navigating, **Then** German remains selected.
4. **Given** unavailable browser storage or an invalid preference, **When** using the selector, **Then** the interface remains usable with English as fallback.

### User Story 2 - Work with the German ledger (Priority: P1)

A German-speaking user can manage horses, financial entries, recurring schedules, income approvals, driving and tasks, and read reports with German interface labels and feedback.

**Why this priority**: Selection is only useful if the complete workspace is understandable.
**Independent Test**: Complete a German task form, exercise validation, inspect a financial preview and report, and switch languages with an unfinished draft.

**Acceptance Scenarios**:
1. **Given** German, **When** visiting each existing route, **Then** app-owned headings, controls, empty/loading states, statuses and validation are German.
2. **Given** an unfinished draft or financial preview, **When** changing language, **Then** values and server-calculated allocations remain intact.
3. **Given** German, **When** reading reports, **Then** currency and dates use German presentation while underlying amounts, dates, currency and account time zone remain unchanged.
4. **Given** German, **When** submitting a task, **Then** its canonical task type and values are unchanged and success is announced in German.

### Edge Cases

- Unknown translation messages fall back to the original message, never a missing-key token.
- Names, descriptions, categories, sources, notes, units and historical server summaries remain original user/server data.
- Known server error codes receive German recovery messages; unrecognized server details retain original text.
- Financial settings locks do not disable language selection.
- Long German labels must wrap at 375px and desktop widths; keyboard labels and status announcements remain accessible.

## Requirements

### Functional Requirements

- **FR-001**: Offer English and German through a visible, labelled language selector on every application screen, including signed-out states.
- **FR-002**: Use English by default; persist explicit language choices locally in the browser and tolerate unavailable or invalid storage.
- **FR-003**: Update visible interface text and document language immediately without navigation or lost drafts.
- **FR-004**: Translate application-owned text throughout all existing routes and shared forms, reports and dialogs, including accessible names and feedback.
- **FR-005**: Format displayed currencies and dates for the selected language without changing financial calculations, persisted payloads, ISO input values or owner-date rules.
- **FR-006**: Preserve authentication boundaries, subject-scoped caches, settings freezes and server previews.
- **FR-007**: Preserve user-entered content, server historical summaries and unknown server error details; provide English fallback for unknown messages.
- **FR-008**: Keep language selection keyboard accessible and layouts usable at 375px and desktop widths.
- **FR-009**: Verify language selection, persistence, fallback, German form validation/canonical submission and locale formatting with automated tests and the running interface.

### Key Entities

- **Interface language preference**: Browser-local choice of English or German, independent of account financial settings.
- **Interface message**: App-owned English text paired with its German equivalent and optional named values.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A user can choose either language in one selector interaction and see it immediately.
- **SC-002**: Every existing workspace route offers German app-owned text and language selection.
- **SC-003**: Reload retains either explicit language choice; corrupt or blocked storage never blocks access.
- **SC-004**: Language switching preserves 100% of draft values and financial preview amounts in tested flows.
- **SC-005**: German task submission retains canonical values, and report formatting preserves amounts in both languages.

## Assumptions

- English remains the default for compatibility; browser language does not override an explicit choice.
- Preference is per browser, not synchronized between accounts or devices.
- Translation applies to the application interface. WorkOS-hosted pages, user content, stored historical summaries and arbitrary backend diagnostic text are outside translation scope.
- Existing account currency, precision rules and time-zone semantics remain authoritative.
