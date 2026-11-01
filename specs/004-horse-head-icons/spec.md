# Feature Specification: Horse-head icons

**Feature Branch**: `codex/horse-head-icons`
**Created**: 2026-11-01
**Status**: Approved for implementation
**Input**: Update the icon, favicon, and other app icons to symbolize a horse head. Commit, push, create a PR, enable auto-merge, and monitor CI.

## User Scenarios & Testing

### User Story 1 - Recognize the horse workspace (Priority: P1)

As a horse owner, I recognize Horse ledger by a clear horse-head mark in the workspace.

**Why this priority**: The primary brand and horse navigation should clearly represent the subject of the app.
**Independent Test**: Open the workspace on desktop and mobile and inspect the brand and Horses destination.

**Acceptance Scenarios**:
1. **Given** the workspace, **When** viewing the brand and Horses navigation, **Then** both show the same recognizable horse-head profile.
2. **Given** keyboard or screen-reader navigation, **When** locating home or Horses, **Then** existing translated labels and focus behavior remain available without duplicate icon announcements.

### User Story 2 - Recognize browser and device shortcuts (Priority: P2)

As a returning user, I recognize the same horse head on browser tabs and device shortcuts.

**Why this priority**: Consistent identity helps users locate their ledger outside the app.
**Independent Test**: Load the page and its declared browser, touch, and app icon resources.

**Acceptance Scenarios**:
1. **Given** a browser tab, **When** the page loads, **Then** the favicon uses the horse-head mark with a legacy browser fallback.
2. **Given** a device shortcut, **When** its icon is requested, **Then** a correctly sized horse-head icon is available on a solid forest-green background.

### Edge Cases

- At 16 pixels the profile remains recognizable through its ears, muzzle, and neck.
- Light and dark browser chrome retain contrast through a solid background.
- Static assets resolve directly rather than returning the app page.

## Requirements

### Functional Requirements

- **FR-001**: Brand and horse-related icons MUST depict one consistent horse-head profile.
- **FR-002**: Browser, legacy browser, touch, and device app icons MUST use that profile.
- **FR-003**: The mark MUST follow the existing forest-green visual identity.
- **FR-004**: Existing translated accessible navigation names and keyboard interactions MUST remain intact.
- **FR-005**: Icons for expenses, income, approvals, tasks, reports, settings, and sign-out MUST retain their functional meaning.
- **FR-006**: Icon delivery MUST work in the production build without external services.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All brand and horse-related icon surfaces display the same horse head.
- **SC-002**: Every declared icon resource loads successfully at its declared size.
- **SC-003**: The profile is recognizable at 16, 20, 27, 180, 192, and 512 pixels.
- **SC-004**: Home and Horses remain keyboard accessible with their existing names at desktop and 375-pixel mobile width.

## Assumptions

- Other icons means app identity assets and horse-related symbols; unrelated functional icons retain their meanings.
- No install/offline flow or backend behavior is introduced.
- Existing design tokens and local static asset delivery are dependencies.
