# Quickstart Validation Guide

**Status**: Planned commands and scenarios for the implementation phase. The repository currently contains design artifacts only; application projects, package scripts and test fixtures below must be created by the planned slices before these commands can run. No application test or deployment pass is claimed by this guide.

Contracts: [HTTP](contracts/http-api.md), [authentication](contracts/auth.md), [events/model](data-model.md), [UI](contracts/ui.md), [storage](contracts/storage.md).

## Prerequisites

- .NET 10 SDK; Node.js 24 LTS and npm; Git. Commit SDK/package lockfiles during scaffolding. This planning session found .NET 10.0.103 but no Node/npm on PATH.
- Linux container runtime for native file-lock tests; a local macOS filesystem is not Azure SMB evidence.
- Isolated test directories and two test users; fixed owner date 2026-09-21 for deterministic cases (another fixture sets later dates). Test harness supplies clock and RSA issuer/JWKS; no production clock/auth bypass.
- WorkOS staging environment, client ID and server-only API credential; template audience, registered callback/logout URLs and exact issuer/JWKS settings for real-auth smoke.
- App-owned sibling HTTPS frontend/API hostnames for cookie session smoke; no paid WorkOS authentication custom domain required. Certificate secret for protected shared Data Protection keys. Never commit credentials/session tokens.
- For release storage checks only: two test containers mounting the exact target Azure Files share and a separate backup destination. Use synthetic data in destructive fault tests.

## Planned configuration surface

| Setting | Purpose |
|---|---|
| `Storage__Root` | Dedicated local test path or `/data` mount |
| `WorkOS__ClientId`, `WorkOS__ApiKey` | Public client ID and backend-only exchange credential |
| `Auth__Issuer`, `Auth__Audience`, `Auth__JwksUrl` | Exact JWT validation configuration; HTTPS JWKS, not discovery URL |
| `Auth__FrontendOrigin`, `Auth__CallbackUrl` | Allowlisted return origin and server callback |
| `Auth__CertificatePath`, `Auth__CertificatePassword` | Secret-mounted certificate protecting shared key ring |
| `Cors__AllowedOrigin` | Exact frontend origin; credentials only for auth endpoints |
| `VITE_API_BASE_URL` | API origin, no secret |

Supply server development secrets using .NET user-secrets or a secret-mounted local environment; supply frontend public URL in a gitignored local environment file. Planned examples/templates must contain dummy values only. Production startup rejects test auth and missing/insecure auth configuration.

## Build and automated validation

Run from repository root after scaffolding. The implementation must supply these script/test entry points; a missing entry point is incomplete setup, not a passing check.

```sh
dotnet restore backend/CostTracking.slnx
dotnet build backend/CostTracking.slnx --no-restore
dotnet test backend/CostTracking.slnx --no-build --filter 'Category!=AzureSmb'
npm --prefix frontend ci
npm --prefix frontend run contracts:check
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run
npm --prefix frontend run build
npm --prefix frontend exec playwright install chromium
npm --prefix frontend run test:e2e
```

`contracts:check` generates API OpenAPI and TypeScript types, fails on committed contract drift and validates event compatibility fixtures against the JSON Schema. `test:e2e` starts isolated test API/frontend/issuer processes and cleans them up; it uses condition-based Playwright assertions and verifies auth boundary, keyboard paths and recovery. Tests must first be observed failing for the relevant missing behavior before production code is written.

For a manual interface run after configuration, start these in separate terminals:

```sh
dotnet run --project backend/src/CostTracking.Api
npm --prefix frontend run dev -- --host 127.0.0.1
```

Use the frontend URL printed by Vite. Local automated mode uses the test host; real WorkOS smoke uses the configured HTTPS sibling domains and deployed/staging callback, not arbitrary cross-site localhost cookies. No production secrets in screenshots/test reports.

## End-to-end scenarios

Use fresh isolated accounts/streams for each scenario unless the steps explicitly continue one another. Preserve event counts and report values as evidence, without private real-user data.

| Scenario / requirement | Actions | Expected outcome |
|---|---|---|
| Account and exact private ledger (US1) | Configure EUR/Europe/Berlin, create two eligible horses, record €10.01 Equal expense and €20 Equal one-time income, open September 2026 ledger/P&L | Sorted horses receive 501/500 expense cents and 1000/1000 income cents; net 499/500, total 999. Inputs preview exact values. Restart retains entries. |
| Cross-owner boundary (FR-001, SC-004) | Sign in as second user; exercise every resource ID, target/filter, preview, report and history request using first user's identifiers | 404/no content for foreign and absent IDs; no owner path/name leaked; cache and late requests cannot reintroduce first-owner data |
| Recurring expense interval (US2) | Create Mon/Thu rule starting 2026-09-21; query through 2026-10-04; change Sep 24; skip Sep 28; reopen after sign-in | Exactly Sep 21/24/28 and Oct 1. Changed affects one date; skipped visible with zero contribution. Reads append no event. |
| Calendar/revision edges (FR-007–009) | Fixtures for monthly day31 in Feb 2027 and Feb 2028, selected weekdays across DST, inclusive end, future revision boundary, protected override and stop | Feb28/Feb29 respectively; no duplicated dates; old revision unchanged; rejected destructive revision/stop appends nothing |
| Income decisions (US3) | Set fixture today to 2026-09-22 with three due dates on Sep 19/20/21; approve first, edit second to €25 received 2026-09-22 and approve, reject third; refresh and inspect history | Only approved actual values realized on received dates; reject retained at zero; pending keys unique; later due dates independent |
| Concurrent/ambiguous decisions (FR-013/020) | Submit two different decisions at same version, retry winning command with same key, reuse key with changed body, simulate response loss after flush | Exactly one event; loser conflicts; exact retry returns original response; changed hash conflicts; no duplicate realization |
| Inactive horse history (FR-002) | Mark horse Sold with existing entries/rule; inspect history and new-target picker; settle existing pending receipt with unchanged split | History/rule obligation preserved; new entries cannot target Sold; unchanged existing obligation can be settled; new split target rejected |
| Driving (US4) | Set rate 30 minor units/km; enter 10.125 km, Equal two horses; preview and save; later change rate | 303.75 rounds once to 304 cents; shares 152/152; stored amount/rate unchanged by setting update |
| Effort (US4) | Log Riding 45 minutes and quantity-only Paddock Duty with a unit | Two activity records; duration sum 45; no finance event/report change |
| Complete reports (US5) | Fixture with two months, split categories/sources, inactive horse, >5 years history and >10,000 lifetime candidates | Monthly and breakdown allocations reconcile; lifetime cursor batches each respect cap; UI shows complete final totals only after all unique batches; no history truncation |
| Error/keyboard recovery (FR-021/022) | Keyboard-only forms/dialogs; invalid split, empty list, expired cursor, concurrent edit, disconnected storage | Accessible status/focus; field errors clear; drafts retained; retry available; no false success |
| Settings freeze (FR-023) | Configure account; change before finance; create recurring rule; try changing currency/time zone | Changes allowed before first financial event and rejected afterward; changing currency before finance clears saved driving rate |

Additional arithmetic fixture: 300,000,000 units Equal across three horses gives exactly 100,000,000 each, regardless of millionth weight residues. Custom tied remainders use canonical UUID ordering. Invalid duplicate targets, unsafe integers, zero/negative amounts, wrong sums, invalid cadence and out-of-range requests all fail with field-specific errors before append.

## Storage, restore and scale validation

Implementation supplies opt-in `Category=AzureSmb` tests following [storage proof matrix](contracts/storage.md#deployment-proof-gate), run only against designated synthetic test shares:

```sh
dotnet test backend/CostTracking.slnx --filter 'Category=AzureSmb'
```

The suite requires explicit test share/containers configured and fails or reports a clearly identified skip when absent; skipped tests never satisfy deployment readiness. Assert same-version races, first-file creation, lock failure, process kill around flush, network reconnect, snapshot replacement, corruption and cross-client freshness. Preserve original stream bytes before recovery tests. Never run faults against production data.

Seed 100 horses and 5,000 accepted events, restart, and compare event count/version, allocations, monthly/lifetime totals and pending keys. Add >5,000-event fixtures to trigger snapshots, corrupt the snapshot, and compare full versus assisted replay. Restore an independently retained backup to a fresh share with writers stopped and verify the backed-up prefix/checksum and totals; record backup age and any events outside that recovery point.

## Release evidence

- Automated domain/contract/integration/browser checks pass, with recorded red-green evidence per slice; no test-only authentication in production.
- Real WorkOS sign-in → session read → access-token validation → refresh → logout succeeds; invalid Origin/CSRF rejected, concurrent refresh safe, no persistent browser token. Server restart/revision retains or safely expires sessions.
- Actual two-client SMB/fault/restore proof passes with runtime/mount metadata, not just local file tests.
- Warm month ledger/report p99 ≤2 seconds at stated workload; cold starts reported separately. Measure enough warm runs to assess the 99% criterion; record methodology and raw anonymized measurements.
- 20-user study: at least 18 finish first horse/split expense in five minutes unaided and at least 18 distinguish all three financial statuses; resolve observed blockers.
- Dated Azure-region estimate plus observed usage includes compute, file capacity/operations, backup retention, logs, registry, egress, WorkOS entitlements and ordinary domain. Under-$5 target is met or a budget exception is explicitly accepted before deployment. Spending alerts are enabled but are not a spending cap.

No hosting resources or paid services are created by the planning workflow.
