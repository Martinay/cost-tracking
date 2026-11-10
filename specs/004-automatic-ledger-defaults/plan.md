# Implementation Plan: Automatic ledger defaults

**Branch**: existing worktree | **Date**: 2026-11-10 | **Spec**: [spec.md](spec.md)

## Summary
Default absent AccountConfigured settings to EUR/UTC in AccountProjection, with no read-time writes. Restrict new configuration commands to EUR separately from historical serializer validation. Remove preferences form and horse setup gate. Keep existing browser-local history timestamp rendering and date-only formatting.

## Technical Context
**Language/Version**: C# 14/.NET 10.0.103, TypeScript/React 19, Node 24.19.0.
**Primary Dependencies**: Existing ASP.NET, TanStack Query/Router, Intl, Vite; no new dependencies.
**Storage**: Existing append-only JSONL event store.
**Testing**: xUnit, Vitest/Testing Library, Playwright.
**Target Platform**: Linux API and desktop/mobile browsers.
**Project Type**: Web application.
**Performance Goals**: No extra onboarding requests or read-time writes; original performance gates remain unchanged.
**Constraints**: Preserve historical financial meaning, idempotency, stream versions, UTC event storage, accessible feedback and subject caches.
**Scale/Scope**: Account projection/command boundary, settings, horses, translations, regression journeys.

## Constitution Check
Pass before and after design: canonical defaults in projection; no dependency or architecture additions; contract before tests; observe regression failure before production changes; verify independent account and browser slices. Existing legacy configurations must replay unchanged. Actual hosted identity/Azure release gates remain separate.

## Project Structure
Documentation lives in specs/004-automatic-ledger-defaults/ (spec, plan, research, data-model, contracts, quickstart, tasks).
Backend changes: backend/src/CostTracking.Api/Domain/AccountProjection.cs and Features/Account/AccountEndpoints.cs, with domain/integration tests.
Frontend changes: frontend/src/routes/settings.tsx, horses.tsx, i18n/messages.ts and component/e2e tests.

**Structure Decision**: Extend existing web application boundaries; no new service or migration.
