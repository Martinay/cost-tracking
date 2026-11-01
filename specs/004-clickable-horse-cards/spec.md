# Feature Specification: Clickable horse cards

**Feature Branch**: `codex/clickable-horse-cards`
**Created**: 2026-11-01
**Status**: Approved for implementation
**Input**: Each card of a horse should be clickable.

## User Scenarios & Testing

### User Story 1 - Open a horse from anywhere on its card (Priority: P1)

As an account owner, I can select any part of a horse card to open that horse without aiming for the small View link.

**Why this priority**: This is the primary task on the horse list.
**Independent Test**: Select the name, breed, status, View text and blank card padding; each opens the matching horse. Include a browser regression test before implementation.

**Acceptance Scenarios**:
1. **Given** several horses, **When** I click any card content or blank padding, **Then** the matching horse detail opens.
2. **Given** the horse list, **When** I tab to a horse link, **Then** its card has visible focus and Enter opens that horse with one tab stop per card.
3. **Given** English or German at desktop or mobile width, **When** cards render, **Then** the existing information and translated link names remain readable without horizontal overflow.
4. **Given** a horse card, **When** I use a modified click or the link context menu, **Then** normal browser link behavior remains available.

### Edge Cases

- Long horse names wrap within their cards.
- Missing breeds retain the existing fallback; all visible statuses remain clickable.
- Empty, loading and error lists retain their existing behavior.
- Each card targets its own horse, including when names repeat.

## Requirements

### Functional Requirements

- **FR-001**: Every horse card MUST open the matching existing detail page when any part of the card is selected.
- **FR-002**: Each card MUST expose one keyboard-focusable link with the existing translated View plus horse-name label.
- **FR-003**: Cards MUST visibly indicate hover and keyboard focus and preserve native link actions.
- **FR-004**: Existing horse information, responsive layout, languages and account access boundaries MUST remain intact.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All five tested regions (name, breed, status, View text, padding) open the correct horse in both 375px and 1440px layouts.
- **SC-002**: Each horse has exactly one navigation tab stop and can be opened using Enter.
- **SC-003**: Both supported languages preserve accessible horse link names and no page overflow at the tested widths.

## Assumptions

- Cards navigate to the same destination as their current View links.
- No new horse data or financial behavior is required.
- Existing authentication, routing and translations remain authoritative.
