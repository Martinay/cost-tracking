# Implementation Plan: Quick tasks
**Branch**: `004-quick-tasks` | **Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)

## Summary
Remove quantity inputs from TaskForm. Add an account-keyed shortcut library using native browser storage, named preset buttons and the shared accessible Modal editor. Retain existing task POST and report categories; prepend the selected custom name to notes so it persists in server history without changing the event schema.

## Technical Context
TypeScript 5.9 / React 19.3 / TanStack Query. Existing Node 24.19.0, Vitest/Testing Library and Playwright. No new dependencies. Preferences only in localStorage; task records use the existing backend event store. Target modern desktop/mobile browsers. Scope is task entry and shortcut management; no financial or backend changes.

## Constitution Check
Pre-design: PASS. Thin frontend slice, canonical task types, spec-first contracts and TDD before implementation. Existing Modal and design tokens reused. Explicit storage boundary reports malformed/unavailable storage. Post-design: PASS; custom names fit existing notes with a combined 1000-character limit. No exceptions.

## Project Structure
- `frontend/src/features/tasks/TaskForm.tsx`: simplified task draft and shortcut integration.
- `frontend/src/features/tasks/QuickTasks.tsx`: library, storage validation and editor.
- `frontend/src/features/tasks/taskTypes.ts`: canonical frontend choices derived from generated API request type.
- `frontend/src/routes/tasks.tsx`: subject-scoped remount and storage key.
- `frontend/src/styles.css`: wrapping shortcut buttons/editor layout.
- `frontend/tests/components/TaskForm.test.tsx` and `frontend/tests/e2e/activities.spec.ts`: behavioral and browser acceptance.
- `specs/004-quick-tasks/`: spec, research, data model, UI contract, validation and tasks.
