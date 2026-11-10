# Feature Specification: Automatic ledger defaults

**Feature Branch**: existing worktree (detached HEAD)
**Created**: 2026-11-10
**Status**: Implemented; local validation complete
**Input**: Skip timezone and currency setup after signup/signin; store UTC timestamps, view in browser local time; expenses and income use euro.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start immediately (Priority: P1)
A newly signed-in owner can add a horse and record euro income and expenses without setting account preferences.
**Why this priority**: Removes the blocking first-use step.
**Independent Test**: With an empty account, add a horse and preview/save a financial record without configuring settings.
**Acceptance Scenarios**:
1. **Given** a fresh account, **When** the owner signs in, **Then** adding horses and recording finances needs zero currency/timezone selections.
2. **Given** a fresh account, **When** an expense or income is recorded, **Then** amounts and reports use EUR.
3. **Given** settings, **When** viewed in either language, **Then** there are no editable currency or timezone controls and driving rates remain editable.

### User Story 2 - Read local time (Priority: P1)
Owners see recorded timestamps in the browser's timezone automatically.
**Why this priority**: Correct display without a preference.
**Independent Test**: View the same UTC history event in Berlin and New York browsers; both show their corresponding local time.
**Acceptance Scenarios**:
1. **Given** a stored UTC instant, **When** history is viewed, **Then** its display follows browser timezone and selected interface language.
2. **Given** a date-only ledger day or recurring date, **When** viewed in different timezones, **Then** its calendar day stays unchanged.

### Edge Cases
- Empty and previously unconfigured accounts receive defaults without writing a configuration event.
- Existing explicitly configured records retain their currency and recurring calendar semantics; no implicit conversion or relabeling.
- Daylight-saving and midnight boundaries use browser timestamp conversion; server financial dates for new accounts use UTC.
- Failed driving-rate saves keep their existing recovery path; authentication and subject isolation remain enforced.

## Requirements *(mandatory)*
### Functional Requirements
- **FR-001**: New/unconfigured accounts MUST use EUR and UTC without manual setup.
- **FR-002**: UI MUST remove currency/timezone choices and the prerequisite setup gate.
- **FR-003**: Newly requested account configuration MUST use EUR; new accounts default to UTC without user input. Historical configurations MUST remain readable.
- **FR-004**: Event timestamps MUST remain UTC and display in the browser's local timezone.
- **FR-005**: Date-only financial records MUST retain their calendar dates; defaults MUST NOT change stream versions or append events on reads.
- **FR-006**: Driving rates, financial previews, authentication and subject caches MUST retain their existing behavior.
### Key Entities
- Account: effective currency and calendar defaults, historical explicit configuration, stream version and optional driving rate.
- History event: immutable UTC occurrence instant.
- Financial record: euro minor amount and date-only ledger day.

## Success Criteria *(mandatory)*
### Measurable Outcomes
- **SC-001**: First-use journeys require zero currency/timezone interactions.
- **SC-002**: All fresh-account previews and reports use EUR.
- **SC-003**: The same UTC event displays correctly in two browser timezones, including across a midnight boundary.
- **SC-004**: Existing history and date-only financial days remain unchanged after the update.

## Assumptions
- Existing authentication is reused; hosted signup needs no new identity fields.
- No exchange-rate conversion or destructive migration of historic accounts is requested.
- UTC is the canonical financial calendar for new accounts; browser timezone affects timestamp presentation only.
- Automated regression tests and desktop/mobile browser checks are required by repository guidance.
