# Tasks: Multilanguage support with German

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/ui.md
**Tests**: Required by FR-009 and constitution TDD.

## Phase 1: Setup

- [X] T001 Inspect existing frontend, design and validation guidance in README.md, docs/design-system.md and frontend/src/.

## Phase 2: Foundational

- [X] T002 Add failing language behavior tests in frontend/tests/components/I18n.test.tsx and observe expected failures.

## Phase 3: US1 - Choose the interface language (P1)

**Goal**: Immediate accessible selection with persistence and safe fallback.
**Independent test**: Keyboard selection, remount, corrupt/blocked storage, document language and unknown-message fallback.

- [X] T003 [US1] Implement context and preference boundary in frontend/src/i18n/I18nProvider.tsx; language is exactly `en` or `de`, default `en`.
- [X] T004 [US1] Add shared selector in frontend/src/components/LanguageSelector.tsx, wire frontend/src/main.tsx and frontend/src/components/AppShell.tsx, style in frontend/src/styles.css.

## Phase 4: US2 - Work with the German ledger (P1)

**Goal**: Complete German workspace with canonical data and preserved drafts.
**Independent test**: German task validation/submission, draft language switch, locale report values and existing suite.

- [X] T005 [US2] Add failing German task/report/draft tests in frontend/tests/components/I18n.test.tsx before translating the relevant components.
- [X] T006 [US2] Maintain complete German catalogue in frontend/src/i18n/messages.ts; translate frontend/src/auth/, frontend/src/routes/ and frontend/src/features/ at display boundaries.
- [X] T007 [US2] Pass selected locale to report currency/date presentation in frontend/src/routes/ and frontend/src/features/; retain canonical payloads and server previews.
- [X] T008 [US2] Localize known API recovery messages at presentation boundaries in frontend/src/i18n/I18nProvider.tsx and affected frontend/src/ components.

## Phase 5: Polish and validation

- [X] T009 Document reusable language pattern in docs/design-system.md and README.md.
- [X] T010 Run frontend build, lint and affected/existing tests; record evidence in specs/003-german-language/validation.md.
- [X] T011 Add and run browser language/draft/navigation checks at mobile and desktop in frontend/tests/e2e/language.spec.ts; record evidence and limits in specs/003-german-language/validation.md.

## Dependencies and execution

T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011.
US2 uses US1 context. All tasks use sequential execution because translations share the catalogue. Within US1 preference tests are independent of selector markup. Within US2 task/report tests are independent consumers; route translations can be reviewed independently after the catalogue exists. No agent delegation required.

## Implementation strategy

First deliver the selector/context MVP with its tests, then translate each route and shared form, then complete formatting, feedback and browser verification. Mark only completed tasks. No deployment or release-readiness claims.
