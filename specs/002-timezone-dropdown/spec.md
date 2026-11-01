# Feature Specification: Settings time zone dropdown

**Feature Branch**: `main` (existing checkout)
**Created**: 2026-11-01
**Status**: Specified
**Input**: User description: "Use speckkit workflow. The timezone selection in the settings should be a drop down"

## User Scenarios & Testing

### User Story 1 - Choose a ledger time zone (Priority: P1)

As an account owner, I want to choose my ledger time zone from a dropdown so I do not need to know or type an identifier.

**Why this priority**: This is the requested settings improvement.
**Independent Test**: Open Settings, choose a different time zone, save, and reopen Settings to confirm the saved selection.

**Acceptance Scenarios**:

1. **Given** unlocked settings, **When** the owner opens Settings, **Then** a labeled time zone dropdown displays the saved zone and offers time zones from regions worldwide and UTC.
2. **Given** no saved zone, **When** Settings opens, **Then** a selection prompt appears and saving is unavailable until a zone is chosen.
3. **Given** unlocked settings, **When** the owner selects a zone and saves, **Then** the selected identifier is saved with the currency, success feedback appears, and reopening retains it.
4. **Given** locked settings or a pending save, **When** Settings is displayed, **Then** the dropdown is disabled while retaining its selection.
5. **Given** a failed save, **When** an error appears, **Then** the selected zone remains available for retry.
6. **Given** keyboard navigation, **When** the owner focuses the dropdown, **Then** they can choose a zone using the native keyboard interaction and save with the keyboard.

### Edge Cases

- A saved zone alias absent from the offered canonical list remains visible and selected without silently substituting another zone.
- UTC is explicitly offered even if absent from the region list.
- Loading, errors, financial locks, account isolation, and existing save concurrency behavior remain intact.

## Requirements

### Functional Requirements

- **FR-001**: Replace free-text time zone entry with a labeled dropdown, retaining adjacent helper text.
- **FR-002**: Offer alphabetically ordered IANA time zone identifiers across regions plus UTC, without requiring manual entry.
- **FR-003**: Preserve the exact saved identifier, including aliases missing from the offered list.
- **FR-004**: Require a nonempty selection and use the existing save and error recovery flow.
- **FR-005**: Preserve financial locking and disable the field during saves.
- **FR-006**: Retain keyboard operation, visible focus, and usable sizing on mobile and desktop.

### Key Entities

- **Account settings**: Existing currency, IANA time zone identifier, settings lock, and version; no data or financial rule changes.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Owners can choose and save a zone without typing an identifier in all acceptance scenarios.
- **SC-002**: Saved identifiers remain unchanged on opening Settings, including aliases and UTC.
- **SC-003**: The primary selection and save task is keyboard operable at 375px and desktop widths with no page overflow.

## Assumptions

- Existing supported modern browsers provide the time zone list.
- Zone identifiers match the existing settings terminology; searchable custom widgets and offset labels are outside scope.
- Existing backend IANA validation remains authoritative.
