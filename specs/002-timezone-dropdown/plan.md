# Implementation Plan: Settings time zone dropdown

**Branch**: existing `main` checkout | **Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)
**Input**: `specs/002-timezone-dropdown/spec.md`

## Summary

Replace the settings text field with a native select. Generate sorted unique options from Intl.supportedValuesOf("timeZone"), UTC, and the exact current saved identifier. Keep the existing mutation, authentication, locks, styling, and backend validation.

## Technical Context

**Language/Version**: TypeScript 5.9 / React 19, Node 24.19.0
**Primary Dependencies**: Existing React Query, native Intl and select; no additions
**Storage**: Existing account API; no schema changes
**Testing**: Vitest/Testing Library and Playwright
**Target Platform**: Existing modern web browsers
**Project Type**: Web application
**Performance Goals**: Synchronous local option generation; no additional network requests
**Constraints**: Preserve exact identifiers, financial locking, auth boundaries, subject-scoped caching, command retries, labels, and design tokens
**Scale/Scope**: One settings control, approximately 400 options

## Constitution Check

Pre-research: PASS. Small native control, no new dependencies, no domain or contract changes. Tests first as required by principle 6. Acceptance criteria define the primary task.
Post-design: PASS. Keep option generation local to settings; use existing styles and authenticated command flow. Validate the running interface and record local scope of evidence.

## Project Structure

```text
specs/002-timezone-dropdown/
  spec.md
  plan.md
  research.md
  data-model.md
  contracts/settings.md
  quickstart.md
  tasks.md
  checklists/requirements.md
frontend/src/routes/settings.tsx
frontend/tests/components/Settings.test.tsx
frontend/tests/e2e/settings.spec.ts
```

**Structure Decision**: Modify the existing route and add focused behavioral coverage; reuse canonical CSS and existing UI patterns.
