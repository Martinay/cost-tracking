# Implementation Plan: Horse Finance and Effort Tracking

**Branch**: `main` | **Date**: 2026-09-21 | **Spec**: [spec.md](spec.md)

**Input**: `specs/001-horse-finance-effort-tracking/spec.md` and [architecture.md](architecture.md).
**Feature identifier returned by setup**: `001-horse-finance-effort-tracking`. The setup script resolves that directory name as `BRANCH`; the actual Git branch is `main`, consistent with the specification. Planning does not create a branch.

## Summary

Build a private horse ledger with exact allocations, virtual recurring expenses, explicit recurring-income decisions, driving costs, nonfinancial activity, and reconciled reports. Use the specified React application and .NET Minimal API, with one append-only JSONL stream per WorkOS user on Azure Files. Keep calculations pure, serialize accepted changes under a verified cross-process lock, and derive reports from replayable events.

The repository currently contains specifications and Spec Kit tooling only. This plan defines implementation work; it does not claim that the application, test harness, Azure deployment, or performance checks already exist. Phase 0 decisions are in [research.md](research.md); Phase 1 defines [data-model.md](data-model.md), [contracts](contracts/README.md), and [quickstart.md](quickstart.md). Planning ends before task generation.

## Technical Context

**Language/Version**: C# 14 / .NET 10; TypeScript with strict checking; React 19; Node.js 24 LTS with npm. Pin exact compatible package versions and SDK/container patches during scaffolding and commit lockfiles. The current workstation has .NET SDK 10.0.103; Node/npm are not on this session's PATH.

**Primary Dependencies**: ASP.NET Core Minimal APIs, JwtBearer, System.Text.Json, and built-in OpenAPI support; React, Vite, Tailwind, TanStack Router and Query, a small server-managed WorkOS session broker. Build-time openapi-typescript generates client transport types. xUnit, Microsoft.AspNetCore.Mvc.Testing, Vitest, Testing Library, and Playwright provide behavior, protocol, and browser validation. Each dependency has a concrete purpose in research; no ORM, message broker, scheduler, generic repository framework, or client business-rule engine.

**Storage**: Per-subject JSONL event streams on standard Azure Files SMB; SHA-256 subject directory; checked native Linux exclusive lock plus process semaphore; durable flush before acknowledgment. Optional validated projection snapshots after 5,000 events; retained event history and independent backup. Encrypted mutable auth sessions and the Data Protection key ring are operational files on the same share; the API's system-assigned managed identity uses a key-scoped Azure Key Vault role to wrap the persisted Data Protection keys. Local tests use isolated temporary streams; production semantics must be proven on the target share.

**Testing**: Red-green-refactor for every production slice. Pure domain tests cover integer allocations, calendar expansion, projections, and state transitions. HTTP integration tests cover JWT isolation, validation, replay, retries, and concurrency. Browser tests and running-interface checks cover primary tasks, keyboard interaction, announcements, and preserved drafts. Dedicated Linux/SMB fault and restore tests gate deployment.

**Target Platform**: Modern desktop/mobile browsers; Linux .NET container in Azure Container Apps Consumption; Azure Static Web Apps Free for static assets; WorkOS hosted authentication.

**Project Type**: Web application with one backend deployable and one static frontend.

**Performance Goals**: A month of ledger and reports visible within two seconds in at least 99% of warm standard sessions (SC-002). Cold starts measured separately. Test scale: 100 horses and 5,000 accepted changes per owner; additional snapshot boundary fixtures. Report end-to-end percentiles and dataset/region/runtime rather than extrapolating from unit-test speed.

**Constraints**: Owner isolation on every access; no binary floating-point money; one currency/time zone fixed after first financial event; date queries at most five years and 10,000 generated occurrences; no materialized ordinary recurring expenses or pending income. Exactly one final income decision per occurrence. Under-$5/month is an unverified deployment target that includes storage, backups, authentication/domain costs, operations, logs, and active compute.

**Scale/Scope**: Eight primary routes plus authentication/callback; five user stories and 23 functional requirements. No sharing, currency conversion, tax accounting, entry correction workflow, payment integration, or export implementation is added.

## Constitution Check

Gate evaluated against constitution v1.1.0 before research and re-evaluated after design.

| Principle / constraint | Before research | After design and required evidence |
|---|---|---|
| 1. KISS / YAGNI | Pass: retain required stack, one API and frontend | Pass: feature folders and direct functions; storage lock is a concrete I/O boundary, no speculative framework |
| 2. Canonical domain rules | Pass with allocation/preview design to resolve | Pass: server owns arithmetic and schedule expansion; preview and commit use identical functions; canonical event schema, generated API types, compatibility tests |
| 3. Self-documenting code | Pass | Pass: precise domain names; comments only for business constraints and platform behavior; public contracts describe side effects |
| 4. Explicit dependencies and errors | Pass | Pass: injected file store, clock, subject and ID sources at boundaries; typed errors; storage fails closed |
| 5. Deterministic isolation | Pass | Pass: pure functions accept dates/events; fixed fixtures; test identity issuer isolated from production configuration |
| 6. Strict TDD | Pass: planning changes only | Pass: each slice begins with a failing observable behavior test; no implementation added during planning |
| 7. Spec-first vertical slices | Pass | Pass: contracts/data shapes precede tests; independently demonstrable slice order below |
| 8. Effortless UX | Pass with explicit UI acceptance design | Pass: primary tasks and accessible recovery in UI contract; real interface checks and 20-user study gate release |
| Dependency justification | Pass | Pass: dependency purposes in research; platform libraries handle primitives |
| No unresolved design clarification | Research required for technical details | Pass: decisions captured in research and contracts; empirical release checks explicitly remain unperformed |

No constitution exception is requested. The WorkOS session broker is a justified refinement of the auth integration to avoid the documented $99/month custom-domain dependency; its separate encrypted session files are operational state, not an additional domain store. A failed integrity, privacy, or durability test is a release blocker. Failure of the budget target requires a revised deployment choice or explicit budget exception; it is not reported as a passed gate.

## Project Structure

### Documentation (this feature)

```text
specs/001-horse-finance-effort-tracking/
├── spec.md
├── architecture.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── README.md
│   ├── events-v1.schema.json
│   ├── auth.md
│   ├── http-api.md
│   ├── ui.md
│   └── storage.md
└── tasks.md                    # later speckit-tasks output, not created here
```

### Source Code (planned repository layout)

```text
backend/
├── CostTracking.slnx
├── src/CostTracking.Api/
│   ├── Program.cs
│   ├── Domain/                 # event records, money, schedules, projections
│   ├── Features/               # account, horses, expenses, income, tasks, reports
│   ├── Auth/                   # WorkOS session broker, JWT and subject boundary
│   ├── Storage/                # JSONL append/replay, checked lock, snapshots
│   └── Contracts/              # request/response records, OpenAPI metadata
└── tests/CostTracking.Tests/
    ├── Domain/
    ├── Contracts/
    ├── Integration/
    ├── Storage/
    └── Fixtures/
frontend/
├── src/
│   ├── routes/
│   ├── features/
│   ├── components/
│   ├── api/                   # generated types, fetch boundary, query keys
│   └── auth/
└── tests/
    ├── components/
    └── e2e/
infra/                         # Container Apps, Files, static hosting, alerts
scripts/                       # contract checks and opt-in deployment validation
```

**Structure Decision**: One backend project keeps deployment and domain ownership simple; pure domain folders have no network/filesystem dependencies. One categorized backend test project is sufficient initially. Frontend feature components consume generated transport types. Native locking remains a small explicit Linux function inside storage. Infrastructure artifacts are added only for the specified deployment.

## Phase 0: Research outcome

Research resolves authentication claim configuration, browser session storage, lock guarantees, canonical allocation arithmetic, idempotency evidence, recurrence history, lifetime query limits, and the toolchain. See [research.md](research.md) for decisions, alternatives, sources, and deployment evidence still required. The architecture is synchronized with these refinements to avoid leaving contradictory contracts.

## Phase 1: Design outcome

- [data-model.md](data-model.md) defines persisted and projected entities, validation, ownership, revisions, and transitions.
- [contracts/README.md](contracts/README.md) identifies canonical schema ownership and HTTP/UI/storage contracts.
- [quickstart.md](quickstart.md) defines runnable validation entry points to implement, end-to-end scenarios, and expected evidence.
- No production code, task list, infrastructure provisioning, or deployment occurs in this phase.

## Implementation sequence for later task generation

Each slice follows contract → failing test observed → minimal domain behavior → real integration → green refactor → running-interface acceptance. The listed acceptance criteria supplement the feature's existing scenarios; each slice must remain independently testable.

1. **Account and first horse (US1; FR-001/002/019–023)**: JWT subject boundary, account setup, one durable event per command, replay, conflict/idempotency behavior, horse creation/update/status. Demonstrate a second owner cannot infer another's horse; restart retains the first horse. Run the Linux/SMB lock proof early before building on the storage assumption.
2. **One-time private ledger (US1; FR-003–005/010/017–018)**: authoritative previews, exact split expense/income, horse ledger and minimal monthly/lifetime totals. €10.01 across two horses produces €5.01/€5.00; income counts immediately; status changes preserve history. Exercise failure feedback and draft preservation.
3. **Recurring expenses (US2; FR-007–009)**: all four cadences, bounded expansion, future revisions/stops, individual override/skip, report composition. Interval reads append nothing. Month-end, leap-year and revision-boundary fixtures precede implementation.
4. **Income decisions (US3; FR-011–014)**: derived inbox, approve/edit-and-approve/reject, final decision uniqueness, actual received date, out-of-order processing. Concurrent tabs accept one outcome; pending/rejected amounts never enter realized totals.
5. **Driving (US4; FR-006)**: saved rate, exact decimal multiplication, one rounding step, preview and allocated expense. Persist used rate so subsequent setting changes cannot alter history.
6. **Activities and reporting (US4/US5; FR-015–018)**: task logging, counts/durations, category/source reports, accessible comparison views. A task changes activity only; every report reconciles to allocations including inactive horses.
7. **Release evidence across slices (SC-001–008)**: 100-horse/5,000-event restart/restore exercise, snapshot equivalence, measured warm/cold latency, two-container SMB concurrency/fault exercise, 20-user usability study, regional cost estimate and measured usage. These are release acceptance checks, not claimed planning results.

## Complexity Tracking

No constitution violations or speculative abstractions require justification. Event storage is an explicit input architecture requirement, with its operational cost and empirical integrity gates preserved.
