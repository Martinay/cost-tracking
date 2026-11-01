# Implementation Plan: Clickable horse cards

**Branch**: `codex/clickable-horse-cards` | **Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)

## Summary

Extend each existing horse link over its card with a positioned pseudo-element. Retain semantic links, translated accessible names, content and layout. Use existing border, radius and focus tokens for whole-card feedback.

## Technical Context

**Language/Version**: TypeScript 5.9.3, CSS; Node 24.19.0 / npm 11.17.0.
**Primary Dependencies**: Existing React 19.3, Vite 7.3.7, Playwright 1.64.0.
**Storage**: Unchanged.
**Testing**: Browser regression, existing Vitest suite, build, lint, format.
**Target Platform**: Desktop and mobile browsers.
**Project Type**: Web application.
**Performance Goals**: Native navigation with no extra network requests or event handlers.
**Constraints**: Preserve account-scoped queries, encoded destinations and English/German labels.
**Scale/Scope**: Horse collection cards only.

## Constitution Check

Pass before research and after design: smallest native approach, no dependencies or abstractions, no domain duplication, observable browser regression before production changes, acceptance criteria checked in running UI. No exceptions.

## Project Structure

- `frontend/src/routes/horses.tsx`: existing list markup retained.
- `frontend/src/styles.css`: stretched link, hover and focus styles.
- `frontend/tests/e2e/horse-cards.spec.ts`: pointer, keyboard, language and responsive regression.
- `docs/design-system.md`: document reusable linked-card constraints.
- `specs/004-clickable-horse-cards/`: specification, research, data model, contracts, quickstart, tasks and validation.

**Structure Decision**: Reuse existing web application structure; no new component required.
