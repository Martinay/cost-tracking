# Implementation Plan: Usability remediation

**Branch**: codex/usability-remediation | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)

## Summary
Implement 24 findings in three thin user-story slices. U05 and U07 remain excluded. Preserve server authority, immutable append-only audit events, subject-scoped state and all existing historic interpretation.

## Technical Context
**Language/Version**: C# 14/.NET 10.0.103; TypeScript/React 19; pinned Node 24.19.0.
**Primary Dependencies**: ASP.NET, System.Text.Json, JsonSchema.Net; TanStack Query/Router, Vite.
**Storage**: existing subject-isolated JSONL event store, one event per command.
**Testing**: xUnit HTTP/domain contracts; Vitest/Testing Library; Playwright isolated TestHost.
**Target Platform**: web desktop and phone, existing API deployment.
**Project Type**: frontend/backend application.
**Performance Goals**: retain existing scale criteria; no performance/release claim from local remediation.
**Constraints**: exact minor-unit arithmetic; strict event schema compatibility; mandatory preview and optimistic concurrency; no direct deployment or production data mutation; PR auto-merge authorized by the later user instruction.
**Scale/Scope**: 24 in-scope findings, seven existing destinations, English/German interfaces.

## Constitution Check
Pass before and after design: keep existing stack and shared components; no speculative abstractions. Add regression tests and observe red before implementation, then green. Append full replacement correction events because command pipeline supports one atomic event. Retain original summaries and supplement structured detail. No principle waiver is required. Scope exclusions override original request.

## Project Structure
- backend/src/CostTracking.Api/{Domain,Features,Storage}: projections, endpoints, semantic validation.
- specs/001-horse-finance-effort-tracking/contracts/events-v1.schema.json: additive persisted event variants.
- frontend/src/{api,features,routes,components,i18n}: typed transport, draft/preview forms, reports and history.
- backend/tests and frontend/tests: domain/HTTP/component/browser acceptance.
- specs/005-usability-remediation: spec, design, tasks, analysis, validation evidence.

## Implementation Slices
1. Entry correctness: ratio normalization at transport boundary; euro-rate conversion at form boundary; account version refresh and reset/recovery; Retired targeting; corrections with preview and atomic event replacement projections.
2. Reconciliation: scheduled occurrence examples and complete summaries; explicit partial receipt events and final-settlement compatibility; decision history; month browsing and report drilldowns.
3. Usability: subject-scoped draft retention without previews; quantity aggregation; wrapping navigation and table cues/totals; rich history; focused cancellable forms; unambiguous dates and familiar bilingual copy; safe explicit logout return.

Each slice follows contract → failing regression → implementation → affected checks. Finish with full backend/frontend/contracts/build/lint, isolated populated/error desktop/phone keyboard checks and convergence. Hosted logout configuration is recorded separately from repository completion.
