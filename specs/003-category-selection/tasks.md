# Tasks: Discoverable expense categories

## Setup
- [x] T001 Define acceptance criteria and reviewed design in specs/003-category-selection/spec.md and plan.md.

## US1 - Recurring selection
- [x] T002 [US1] Add and run failing selection and preview invalidation regressions in frontend/tests/components/ExpenseRuleForm.test.tsx.
- [x] T003 [US1] Add frontend/src/features/expenses/ExpenseCategorySelect.tsx and use it in frontend/src/features/expenseRules/ExpenseRuleForm.tsx; choices MUST be Stabling, Veterinary, Farrier, Feed, Equipment, Training, Other; empty draft MUST remain unselected.

## US2 - Consistent selection
- [x] T004 [US2] Add and run failing choice regressions in frontend/tests/components/ExpenseOccurrenceEditor.test.tsx and FinancialForm.test.tsx.
- [x] T005 [US2] Integrate the shared field in frontend/src/features/expenseRules/ExpenseOccurrenceEditor.tsx and frontend/src/features/expenses/ExpenseForm.tsx, preserving supported selections and change callbacks.
- [x] T006 [US2] Update category interactions and browser regressions in frontend/tests/e2e/recurring-expenses.spec.ts and shared guidance in docs/design-system.md.

## Validation
- [x] T007 Run frontend tests, lint, build, affected browser journeys and desktop/mobile category checks; record evidence in specs/003-category-selection/validation.md.

## Dependencies and implementation strategy
T001 precedes all tasks. T002 precedes T003; T004 precedes T005. T006 follows integrations; T007 follows all changes. US1 is the MVP, followed by US2. Independent test-file updates can run in parallel, but execution here is sequential. Tests assert user-visible choices and preview behavior, not component internals.

## Integration with main
- [x] T008 Add a failing localization regression in frontend/tests/components/ExpenseCategorySelect.test.tsx, resolve form conflicts, and localize the shared picker via frontend/src/i18n/messages.ts.
