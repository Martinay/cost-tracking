# Tasks: Quick tasks
**Input**: [plan.md](plan.md), [spec.md](spec.md), research, data model and contracts.

## Phase 1: Setup
- [X] T001 Create specification and validated requirements checklist in `specs/004-quick-tasks/spec.md` and `checklists/requirements.md`.
- [X] T002 Create design and UI contracts in `specs/004-quick-tasks/plan.md`, `research.md`, `data-model.md`, `contracts/ui.md` and `quickstart.md`.

## Phase 2: Foundation
- [X] T003 Derive canonical task type choices in `frontend/src/features/tasks/taskTypes.ts` from generated request types.

## Phase 3: US1 — Simple entry (MVP)
Independent test: keyboard-save positive minutes without quantity controls; recover server failure.
- [X] T004 [US1] Add failing simple-entry tests in `frontend/tests/components/TaskForm.test.tsx`.
- [X] T005 [US1] Remove quantity controls, require positive safe integer minutes and guard pending submits in `frontend/src/features/tasks/TaskForm.tsx`.

## Phase 4: US2 — Reusable shortcuts
Independent test: create, apply, edit, delete, reload and isolate custom shortcuts; custom name persists in logged notes.
- [X] T006 [US2] Add failing shortcut lifecycle/storage/error tests in `frontend/tests/components/TaskForm.test.tsx`.
- [X] T007 [US2] Implement account-scoped validated library and modal CRUD in `frontend/src/features/tasks/QuickTasks.tsx`; names are trimmed, unique and 1–60 characters; minutes are positive safe integers.
- [X] T008 [US2] Integrate reviewable shortcuts and custom-name notes with `frontend/src/features/tasks/TaskForm.tsx` and subject-keyed remount in `frontend/src/routes/tasks.tsx`.

## Phase 5: Polish and validation
- [X] T009 Update responsive patterns in `frontend/src/styles.css` and `docs/design-system.md`.
- [X] T010 Update browser acceptance for simplified task entry and quick tasks in `frontend/tests/e2e/activities.spec.ts`.
- [X] T011 Run checks and desktop/mobile primary-task acceptance; record evidence in `specs/004-quick-tasks/validation.md`.
- [X] T012 Review scope and create the authorized local feature commit; record check results in `specs/004-quick-tasks/validation.md`.
- [ ] T013 Push `004-quick-tasks` to `https://github.com/Martinay/cost-tracking.git` after destination-specific approval; automatic approval review blocked the initial push.

## Dependencies and strategy
T001 → T002 → tests T004/T006 → T003/T005/T007/T008 → T009/T010 → T011 → T012. MVP is US1; extend the same form with US2. Independent documentation and style review may run in parallel; implementation is sequential in this run. No extension hooks configured.
