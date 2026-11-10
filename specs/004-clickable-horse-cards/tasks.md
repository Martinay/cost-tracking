# Tasks: Clickable horse cards

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/card-navigation.md

## Phase 1: Setup

- [X] T001 Read repository guidance, pinned toolchain and design system in README.md and docs/design-system.md.

## Phase 2: Foundation

- [X] T002 Define acceptance, native link contract and design in specs/004-clickable-horse-cards/spec.md and contracts/card-navigation.md.

## Phase 3: US1 - Open horse from anywhere on card (P1)

**Goal**: Each whole card opens its own horse with pointer and keyboard.
**Independent test**: Browser tests click five regions and press Enter with a focused link at desktop/mobile widths in both languages.

- [X] T003 [US1] Add browser regression in frontend/tests/e2e/horse-cards.spec.ts and observe expected padding-click failure.
- [X] T004 [US1] Extend existing links and add whole-card feedback in frontend/src/styles.css.
- [X] T005 [US1] Verify browser acceptance and inspect desktop/mobile screenshots from frontend/tests/e2e/horse-cards.spec.ts.

## Phase 4: Polish and validation

- [X] T006 Document linked-card pattern in docs/design-system.md.
- [X] T007 Run frontend tests, build, lint and format checks; record evidence in specs/004-clickable-horse-cards/validation.md.

## Dependencies and parallel opportunities

T001 → T002 → T003 → T004 → T005 → T007. T006 can run alongside T005 because it changes a separate document. All seven tasks have IDs, checkboxes and file paths; four belong to setup/polish and three to US1.

## Implementation strategy

Deliver US1 as one small vertical slice: specification and contract, failing browser regression, minimal CSS, browser and existing-suite validation. No additional stories or data changes are needed.
