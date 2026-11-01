# Feature Specification: Discoverable expense categories

**Feature Branch**: `003-category-selection`
**Created**: 2026-11-01
**Status**: Reviewed
**Input**: Make selectable recurring expense categories understandable and fix the same problem everywhere categories are chosen.

## User Scenarios & Testing

### User Story 1 - Choose a recurring expense category (Priority: P1)
As an owner, I can see the available categories rather than guessing what to type.
**Why this priority**: Free text currently hides the allowed choices and permits rejected values.
**Independent Test**: Open a new recurring expense and select Feed without typing a category.
**Acceptance Scenarios**:
1. Given a new recurring expense, when I open Category, then I see Stabling, Veterinary, Farrier, Feed, Equipment, Training, and Other and an initial Choose a category prompt.
2. Given a selection and reviewed preview, when I change category, then I must preview again before saving and the new preview receives the selected category.

### User Story 2 - Choose categories consistently (Priority: P2)
As an owner, I use the same category choices for one-off expenses, rule revisions, and occurrence changes.
**Why this priority**: The same discovery problem affects occurrence changes; one-off expenses already expose choices.
**Independent Test**: Open each category field and verify the same choices; revise an existing Feed expense to Veterinary.
**Acceptance Scenarios**:
1. Given an existing supported category, when I open its editor, then it remains selected.
2. Given any expense category picker, when I use the keyboard, then I can choose a supported category with an accessible label and visible focus.
3. Given any picker, then adjacent help explains that driving costs are recorded separately using mileage.

### Edge Cases
- Empty category remains empty until explicitly selected; no default silently replaces it.
- Driving is excluded because its amount requires mileage calculation.
- Category edits invalidate existing financial previews; failed saves retain drafts.
- Long labels and helper text fit a 375px viewport without page overflow.

## Requirements
### Functional Requirements
- **FR-001**: Every editable expense category field MUST visibly offer the seven supported non-driving categories.
- **FR-002**: New forms MUST start with an explicit unselected prompt and MUST require a category.
- **FR-003**: Existing supported selections MUST remain selected during edits.
- **FR-004**: Category controls MUST have persistent labels, keyboard operation, visible focus, and associated help explaining the separate driving flow.
- **FR-005**: Category changes MUST preserve preview-before-save safeguards, server allocations, validation, and draft retention.
- **FR-007**: Category labels, the empty prompt, and driving guidance MUST follow the selected English/German interface language while stored category values and selections remain unchanged.
- **FR-006**: Automated regression tests MUST verify recurring selection, consistent choices, initial selection, and preview invalidation before implementation under the repository TDD rule.
### Key Entities
- Expense category: Existing classification shared by one-off expenses, rule defaults, and changed occurrences. No persistence changes.

## Success Criteria
### Measurable Outcomes
- **SC-001**: All four category journeys (record, create rule, revise rule, change occurrence) expose the same seven valid choices.
- **SC-002**: A user can select any category without entering text or consulting documentation.
- **SC-003**: Category edits require a fresh preview before saving in all affected recurring flows.
- **SC-004**: The primary category selection task works with keyboard input and at desktop and 375px widths.

## Assumptions
- Existing backend category validation defines available choices; category management and income sources are outside this fix.
- Driving remains in its existing mileage flow. No new category values or financial behavior are introduced.
