# Quickstart Validation Guide

**Status**: Local implementation and validation guide. Application projects, API contracts, frontend routes, tests, and local operational tooling are present. The evidence files below distinguish completed local checks from unverified release gates; no successful local check substitutes for an external gate.

Contracts: [HTTP](contracts/http-api.md), [authentication](contracts/auth.md), [events/model](data-model.md), [UI](contracts/ui.md), [storage](contracts/storage.md).

## Prerequisites

- .NET SDK 10.0.103; Node.js 24.19.0 and npm 11.17.0; Git. Use the versions pinned in `global.json`, `.nvmrc`, and lockfiles. This workstation's verified Node distribution is in the ignored `.local/toolchain/node-v24.19.0-darwin-arm64/bin`; add it to `PATH` if Node is not otherwise installed.
- Linux container runtime for native file-lock tests. The local Linux proof has passed; a local Linux filesystem is not Azure SMB evidence.
- Isolated test directories and two test users; fixed owner date 2026-09-21 for deterministic cases (another fixture sets later dates). Test harness supplies clock and RSA issuer/JWKS; no production clock/auth bypass.
- WorkOS staging environment, client ID and server-only API credential; template audience, registered callback/logout URLs and exact issuer/JWKS settings for real-auth smoke.
- App-owned sibling HTTPS frontend/API hostnames for cookie session smoke; no paid WorkOS authentication custom domain required. A provisioned Azure Key Vault key and managed identity access for protected shared Data Protection keys in deployed environments. Never commit credentials/session tokens.
- For release storage checks only: two test containers mounting the exact target Azure Files share and a separate backup destination. Use synthetic data in destructive fault tests.

## Configuration surface

| Setting | Purpose |
|---|---|
| `Storage__Root` | Dedicated local test path or `/data` mount |
| `WorkOS__ClientId`, `WorkOS__ApiKey` | Public client ID and backend-only exchange credential |
| `Auth__Issuer`, `Auth__Audience`, `Auth__JwksUrl` | Exact JWT validation configuration; HTTPS JWKS, not discovery URL |
| `Auth__FrontendOrigin`, `Auth__CallbackUrl` | Allowlisted return origin and server callback |
| `Auth__DataProtectionKeyPath` | Stable protected key-ring directory shared by API replicas |
| `Auth__DataProtectionKeyIdentifier` | Azure Key Vault key identifier used to wrap persisted Data Protection keys; deployed API authentication uses its attached managed identity |
| `Cors__AllowedOrigin` | Exact frontend origin; credentials only for auth endpoints |
| `VITE_API_BASE_URL` | API origin, no secret |

Supply server development secrets using .NET user-secrets or a secret-mounted local environment; supply frontend public URL in a gitignored local environment file. Planned examples/templates must contain dummy values only. Production startup rejects test auth and missing/insecure auth configuration.

The infrastructure deployment creates the Key Vault and key with soft delete and purge protection, then grants the API system-assigned identity the Key Vault Crypto Service Encryption User role at key scope. The deployment principal needs role-assignment write permission, and Key Vault RBAC propagation can delay the first successful key operation. The key-ring files remain on Azure Files. Use a versionless key identifier for automatic key rotation, and retain every old key version needed to unwrap existing key-ring entries. Local development defaults to a filesystem key ring without Azure credentials; to exercise Key Vault protection locally, configure a separate development key and use developer credentials.

## Build and automated validation

Run from the repository root. Use `--locked-mode` to enforce the checked-in NuGet lockfiles. In this environment, disabling build servers avoids IPC hangs, and VSTest needs permission to bind a local TCP socket for its test host.

```sh
dotnet restore backend/CostTracking.slnx --locked-mode
dotnet build backend/CostTracking.slnx --no-restore --disable-build-servers -m:1 -p:UseSharedCompilation=false
dotnet test backend/CostTracking.slnx --no-build --no-restore --disable-build-servers -m:1 -p:UseSharedCompilation=false --filter 'Category!=AzureSmb'
npm --prefix frontend ci
npm --prefix frontend run contracts:check
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run format:check
npm --prefix frontend run test -- --run
npm --prefix frontend run build
npm --prefix frontend exec playwright install chromium
npm --prefix frontend run test:e2e
scripts/verify-storage.sh --local
node --test scripts/backup-restore.test.mjs scripts/measure-journeys.test.mjs scripts/run-e2e.test.mjs scripts/verify-restore-replay.test.mjs
```

`contracts:check` generates API OpenAPI and TypeScript types, fails on committed contract drift and validates event compatibility fixtures against the JSON Schema. `test:e2e` starts isolated test API/frontend/issuer processes and cleans them up; it uses condition-based Playwright assertions and verifies auth boundary, keyboard paths and recovery. Tests must first be observed failing for the relevant missing behavior before production code is written.

For a manual interface run with valid local or staging auth configuration, start these in separate terminals:

```sh
dotnet run --project backend/src/CostTracking.Api
npm --prefix frontend run dev -- --host 127.0.0.1
```

Use the frontend URL printed by Vite. Local automated mode uses the isolated test host and synthetic identity issuer. Real WorkOS smoke requires configured HTTPS sibling domains and the registered staging callback; arbitrary cross-site localhost cookies do not prove this flow. Keep production credentials and tokens out of screenshots and test reports.

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

The local synthetic backup verifier now performs the event-stream backup/restore to a fresh root and compares authoritative monthly report totals and pending-approval keys after reauthentication without reseeding. See `validation/ops-backup-restore.md` and `validation/ops-restore-replay.json`. This does not establish a scheduled 24-hour recovery point, restore on an independent Azure share, Azure Files semantics, or measured recovery time; those target gates remain separate.

## Release evidence

- Automated local domain/contract/integration/browser checks pass, and test-only authentication is registered only in test hosting. Red/green evidence is retained for the fixes explicitly recorded in `validation/implementation.md`; older per-task tests-first history gaps remain open in `tasks.md`.
- The 2026-10-16 local application measurement is retained in `validation/performance-local-20261016.json` with its sanitized progress journal. It completed 400/400 journeys and all 2,200 proxied API requests returned HTTP 200, but warm p99 was 2,355.65 ms for the month ledger and 2,856.13 ms for the report, above the 2,000 ms criterion. It is a measured local threshold failure, not a T104 pass or target-region result. The earlier 2026-10-10 run with 76 failed journeys remains retained separately in `validation/performance-local-t072-20261010.json`; see `validation/performance.md` and `validation/release.md` for both runs and their limits.
- The 2026-10-17 direct HTTP baseline is in `validation/performance-http-local-20261017.json`. It ran 100 requests each for account, monthly P&L, and lifetime, plus 20 diagnostic requests for five list/activity/breakdown endpoints; every status, stream version, and checked item count passed. The three 100-sample p99 values were 734.07 ms, 772.89 ms, and 769.09 ms. This measures individual API requests, not browser-visible journeys; host load was uncontrolled, so it does not explain the earlier end-to-end p99 failure or justify a backend optimization by itself.
- User-story evidence indexes are in `validation/us1.md` through `validation/us5.md`; they summarize local behavior evidence and retain the open historical red-first and external release gates.
- Real WorkOS sign-in → session read → access-token validation → refresh → logout succeeds; invalid Origin/CSRF rejected, concurrent refresh safe, no persistent browser token. Server restart/revision retains or safely expires sessions.
- Actual two-client SMB/fault/restore proof passes with runtime/mount metadata, not just local file tests.
- Warm month ledger/report p99 ≤2 seconds at stated workload; cold starts reported separately. Measure enough warm runs to assess the 99% criterion; record methodology and raw anonymized measurements.
- 20-user study: at least 18 finish first horse/split expense in five minutes unaided and at least 18 distinguish all three financial statuses; resolve observed blockers.
- Dated Azure-region estimate plus observed usage includes compute, file capacity/operations, backup retention, logs, registry, egress, WorkOS entitlements and ordinary domain. Under-$5 target is met or a budget exception is explicitly accepted before deployment. Spending alerts are enabled but are not a spending cap.

No hosting resources or paid services are created by the planning workflow.
