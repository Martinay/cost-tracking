# Implementation Plan: Discoverable expense categories
**Branch**: `003-category-selection` | **Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)

## Summary
Use one native ExpenseCategorySelect in all three category-bearing forms (recording, rules including revisions, and occurrences). Display the existing seven choices with a required empty prompt and associated driving guidance. Preserve existing change callbacks to invalidate previews.

## Technical Context
**Language/Version**: TypeScript 5.9, React 19.3, Node 24.19.0.
**Primary Dependencies**: Existing React and browser select; no new dependencies.
**Storage**: Existing API strings; unchanged.
**Testing**: Vitest/Testing Library and Playwright browser journeys.
**Target Platform**: Desktop and mobile web, keyboard and touch.
**Project Type**: React frontend with ASP.NET backend.
**Performance Goals**: Immediate local category selection; no network requests.
**Constraints**: Existing design tokens, backend validation, preview safeguards and subject-scoped caches.
**Scale/Scope**: Three form components covering four category journeys.

## Constitution Check
Pre-design PASS: smallest native control; three callers justify sharing; no backend business-rule change; regression tests before production edits; task-based acceptance criteria specified.
Post-design PASS: no dependencies, storage changes, abstractions beyond the concrete shared selector, or financial calculation changes. No unresolved questions. Spec and plan reviewed against the constitution and server validation.

## Project Structure
- `frontend/src/features/expenses/ExpenseCategorySelect.tsx`: shared field and allowed UI choices.
- `frontend/src/features/expenses/ExpenseForm.tsx`: one-off integration.
- `frontend/src/features/expenseRules/ExpenseRuleForm.tsx`: create/revise integration.
- `frontend/src/features/expenseRules/ExpenseOccurrenceEditor.tsx`: occurrence integration.
- `frontend/tests/components/`: behavior regressions.
- `frontend/tests/e2e/recurring-expenses.spec.ts`: real browser selection regression.
- `docs/design-system.md`: reusable selection guidance.
- `specs/003-category-selection/`: feature artifacts and validation evidence.
