# Tasks: Settings time zone dropdown

**Input**: Design artifacts in `specs/002-timezone-dropdown/`

## Phase 1: Setup

- [x] T001 Review `docs/design-system.md`, `frontend/src/styles.css`, `README.md`, and existing feature validation guidance.

## Phase 2: Foundation

- [x] T002 Specify unchanged settings shape and interaction in `specs/002-timezone-dropdown/contracts/settings.md` and review the constitution in `.specify/memory/constitution.md`.

## Phase 3: User Story 1 - Choose a ledger time zone (P1)

**Goal / MVP**: Choose and save a zone using a native dropdown.
**Independent test**: Select another zone, save, reopen, and verify the selection. Preserve blank, alias, UTC, locked, pending, and failure behavior.

- [x] T003 [US1] Add regression coverage in `frontend/tests/components/Settings.test.tsx` and observe expected failure before implementation.
- [x] T004 [US1] Replace the input in `frontend/src/routes/settings.tsx` with a sorted native dropdown: "Nonempty IANA identifier; preserve the exact selected or saved value." and "Time zone selection is disabled after financial activity."
- [x] T005 [US1] Verify keyboard selection, save, reload, and no overflow at desktop and 375px in `frontend/tests/e2e/settings.spec.ts`.

## Phase 4: Polish and validation

- [x] T006 Run pinned-runtime build, lint, and affected tests from `frontend/package.json`; review the diff and record evidence in `specs/002-timezone-dropdown/quickstart.md`.

## Dependencies and execution

T001 → T002 → T003 (red) → T004 (green) → T005 → T006.
Single story is the full MVP. Browser test authoring and component test authoring may be performed independently after T002; execution remains tests-first. No shared abstractions or CSS changes are required.
