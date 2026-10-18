# Architecture and contracts: Horse Finance and Effort Tracking

**Status**: Design contract refined by planning, 2026-09-21. [Feature requirements](spec.md) take precedence for user behavior.

Planning refinements are recorded in [research.md](research.md); canonical shapes and state rules are in [data-model.md](data-model.md) and [contracts/README.md](contracts/README.md). These clarify exact equal splits, verified locking, command hashes, JWT audience setup, and bounded complete queries.

## 1. System and deployment

```text
Browser / React 19 + TypeScript + Vite + Tailwind
  TanStack Router -> page routes; TanStack Query -> authenticated server state
       |
       | HTTPS + WorkOS access token
       v
Azure Static Web Apps (free)       WorkOS AuthKit
       |                                  |
       +---------> Azure Container Apps (.NET 10 Minimal API)
                         auth -> command validation -> event append
                              -> deterministic in-memory projections
                                      |
                             Azure Files SMB mount
                             append-only per-user JSONL
```

The backend verifies access-token signature, issuer, audience, expiry and user `sub` against the configured WorkOS environment. It rejects missing, malformed and non-user subjects before storage access. `sub` is the sole account key; `org_id` never broadens access. Every resource lookup begins with the authenticated subject, not a client-supplied tenant ID. Return 404 for a foreign or unknown resource ID. Cache keys include the subject and are discarded on sign-out. A server-managed WorkOS session broker handles code exchange and refresh, as defined in [contracts/auth.md](contracts/auth.md); no long-lived token is placed in local storage. WorkOS documents `sub` as the user ID and its signing JWKS in [AuthKit sessions](https://workos.com/docs/authkit/sessions).

Use Static Web Apps Free, Container Apps Consumption with HTTP ingress, `minReplicas: 0`, and initially `maxReplicas: 1`; mount a standard Azure Files SMB share at `/data`. The maximum of one is an operating default, not the integrity mechanism: verified file locking and version checks must remain correct across independent clients before deployment, even with the initial replica limit. The file share persists while the container scales to zero. Microsoft documents [Azure Files mounts in Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts-azure-files) and [zero-replica consumption billing](https://azure.microsoft.com/en-us/pricing/details/container-apps/). Cold starts must be measured separately from warm interactions. The **less than $5/month** objective is a budget gate, not a guaranteed price: price the chosen region's file capacity, operations, egress, logs, WorkOS plan and active container seconds, then set spending alerts. Azure Files incurs charges while compute is at zero.

No database, message broker, materialization worker, or recurring cron exists. Encrypted mutable authentication sessions and the Data Protection key ring are separate operational files on the share; the API's managed identity uses an Azure Key Vault key to wrap the persisted key ring. Financial truth remains exclusively the event streams. The event store is the source of truth. Snapshots and process caches are disposable accelerators. A bounded full replay must always recover the same state. Azure Files share snapshots or an independently retained backup are required for disaster recovery; a snapshot file inside the same share is only a projection accelerator, not a backup.

### Storage layout and file safety

```text
/data/
  users/
    <sha256-of-workos-sub>/
      events_<sha256-of-workos-sub>.jsonl
      snapshot_<sha256-of-workos-sub>.json
      snapshot_<sha256-of-workos-sub>.tmp
```

Only the server derives the path. Hashing the subject prevents path traversal and avoids plain identity in filenames; the raw subject remains in authenticated in-memory context and event envelope, never a URL parameter. Restrict share and mount access to the backend and authorized deployment operators; protect the storage-account mount credentials and never expose them to the browser. Disable arbitrary file serving. Avoid request-body and token logging; log correlation IDs and event types, not private financial content. Encrypt the storage account at rest and require encrypted transport. Backups must have restricted access and a tested restore path.

Use one process-local semaphore per subject plus an explicitly checked Linux exclusive lock on the event-file handle for the entire read-current-version, validate, append, durable-flush sequence. `FileShare.None` alone is insufficient: .NET's Unix implementation can silently continue after unsupported locking errors. Use the fail-closed protocol in [contracts/storage.md](contracts/storage.md), and verify actual cross-client SMB semantics before deployment. Lock failure returns a retryable error and never permits unlocked writes. The maximum replica count is not an integrity mechanism.

Each event is one UTF-8 JSON object followed by `\n`, with monotonically increasing `streamVersion` starting at 1. Never rewrite committed lines. A record is acknowledged only after the full line and newline are flushed to the durable file. At lock acquisition, a final unterminated line may be truncated to the last newline and reported as a recovery event; a corrupt terminated line fails closed and requires restore, never silent skipping. Keep an external backup of the original file before repair. A pre-append expected-version mismatch returns 409. The append operation includes a client-generated idempotency key: on an ambiguous retry, scan the existing stream for the same key and return the original result if payload hash matches; return 409 if the key was reused with different content.

### Event envelope and evolution

All events are immutable. A schema version is per event type, not the stream version. Timestamps are UTC instants; financial and due dates are ISO calendar dates in the owner's configured IANA zone. Persisted entity/event IDs are opaque UUIDs; virtual and approved recurring transaction IDs use the stable composite strings defined below. Event readers upcast older payloads to the current in-memory contract before projections; upcasters are pure, deterministic, and covered by historical fixtures. Unknown event types or newer unsupported schema versions fail startup for that stream rather than being dropped.

```json
{
  "eventId": "2a663553-5cf7-4238-8986-44476d57d84b",
  "streamVersion": 42,
  "schemaVersion": 1,
  "type": "RecurringIncomeApproved",
  "subject": "user_01JABC123",
  "occurredAt": "2026-09-21T10:02:41Z",
  "idempotencyKey": "7c3145e2-c6c5-4359-aebc-622a1962b5e8",
  "commandHash": "b1e603d80c4c3236b3e4fded5dd1d1a9f7c38908d16d116b7068404390ce9090",
  "payload": { "ruleId": "b15e7f50-36db-4edc-88c9-1a0195df4e9e", "scheduledDate": "2026-09-21", "receivedDate": "2026-09-21", "amountMinor": 5000, "splitMode": "Equal", "allocations": [{ "horseId": "85fe5c1a-15d4-4567-8792-4db515f1e104", "weight": 1000000, "amountMinor": 5000 }], "nextDueDate": "2026-10-21" }
}
```

Canonical monetary amount is an integer count of currency minor units, positive for expense/income; there are no floating-point monetary fields. `weight` is an integer millionth of the whole (sum exactly 1,000,000), allowing custom fractional splits. Equal splitting distributes residual weights in ascending horse-ID order. For Equal monetary amounts, divide directly by horse count and assign residual minor units by horse ID; do not derive equal money from rounded weights. For Custom amounts, compute floor of each exact weighted allocation, then distribute remaining minor units by largest fractional remainder, breaking ties by horse ID. Persist `splitMode` alongside allocations. This guarantees exact totals. Decimal driving `kilometers` (at most three decimal places) times `rateMinorPerKm` (at most four decimal places) is rounded half away from zero once to account minor units, then allocated. Expense category and task type strings are closed enums; income `source` is a nonempty owner-entered label. One account currency is fixed after the first financial event.

Schedule contract: `cadence` is `Daily`, `Weekly`, `Weekdays`, or `Monthly`; `interval` is a positive integer for Daily/Weekly/Monthly and 1 for Weekdays. `weekdays` is an array of distinct ISO weekday numbers 1-7 and is nonempty only for Weekdays. Weekly recurs every `interval` weeks on the start date's weekday; Monthly recurs every `interval` months on `dayOfMonth`, clamped to the month's final day. Start and optional end are inclusive. Each rule revision has an `effectiveFrom` calendar date; a revision may affect only dates after today and never rewrites existing decisions. An occurrence key is `(ruleId, scheduledDate)`. Expense overrides can set `Skipped` or `Changed`; the latest override event for a key wins, so a later correction is auditable. Income decisions are final and unique for a key; a rule cannot retroactively change a decided date. Stopping a rule closes it after an inclusive `lastDate` and preserves past items.

## 2. Domain event contract

The linked JSON Schema describes the persisted envelope and every payload. `additionalProperties: false` is intentional. Nullable fields are listed explicitly; optional fields are absent rather than null unless shown. The `kind` field is not duplicated in payload: `type` selects the corresponding payload definition via `oneOf`. Implementation records must satisfy this canonical contract through compatibility fixtures; do not maintain a second schema copy.

The canonical machine-readable schema is [contracts/events-v1.schema.json](contracts/events-v1.schema.json). It includes the planning refinements `commandHash` and `splitMode`; cross-field validation is defined in [data-model.md](data-model.md).

Additional cross-field validation is mandatory: allocation horse IDs are distinct, weights sum to 1,000,000, allocated amounts sum to the parent amount, and all horses belong to the subject. Current status controls eligibility for new splits; existing rule obligations retain their accepted allocations as detailed in [data-model.md](data-model.md). `HorseDetailsUpdated` preserves the current status; status changes use `HorseStatusChanged`. An `ExpenseRecorded` item has category Driving if and only if `driving` is present, and its amount must match the calculation. A Changed expense override requires `changed`; Skipped requires null. A rule update's effective date must be strictly after the account's current local date; initial rule creation may start in the past. The `nextDueDate` stored on decisions is the first undecided scheduled date after the processed date for traceability; the authoritative pending set is always derived from schedule revisions minus decisions, so out-of-order processing cannot hide older pending payments.

### C#/.NET 10 contract sketch

Use `decimal` for distances and rates and `long` for minor-unit amounts. Configure JSON polymorphism by the envelope `Type` discriminator, not dynamic type-name serialization. The code below is an illustrative typed representation of the canonical schema; validators enforce the cross-field rules above. `DateOnly` and `DateTimeOffset` serialize to ISO dates/instants. Enum values use the exact strings in the schema.

```csharp
public sealed record EventEnvelope<T>(
    Guid EventId, long StreamVersion, int SchemaVersion, string Type,
    string Subject, DateTimeOffset OccurredAt, Guid IdempotencyKey, string CommandHash, T Payload);

public sealed record Allocation(Guid HorseId, int Weight, long AmountMinor);
public enum SplitMode { Equal, Custom }
public sealed record Schedule(
    Cadence Cadence, int Interval, int[] Weekdays, int? DayOfMonth,
    DateOnly StartDate, DateOnly? EndDate);
public enum Cadence { Daily, Weekly, Weekdays, Monthly }
public enum HorseStatus { Active, Leased, Retired, Sold }
public enum ExpenseCategory { Stabling, Veterinary, Farrier, Feed, Equipment, Training, Driving, Other }
public enum TaskType { Riding, Groundwork, Lunging, Grooming, MedicalCare, PaddockDuty, Transportation, Other }
public enum OverrideAction { Changed, Skipped }

public sealed record AccountConfigured(string Currency, string TimeZone);
public sealed record HorseRegistered(Guid HorseId, string Name, string Breed, DateOnly? DateOfBirth, HorseStatus Status);
public sealed record HorseDetailsUpdated(Guid HorseId, string Name, string Breed, DateOnly? DateOfBirth, HorseStatus Status);
public sealed record HorseStatusChanged(Guid HorseId, HorseStatus Status);
public sealed record Driving(decimal Kilometers, decimal RateMinorPerKm);
public sealed record ExpenseRecorded(
    Guid ExpenseId, DateOnly ExpenseDate, long AmountMinor, ExpenseCategory Category,
    string Description, Allocation[] Allocations, SplitMode SplitMode, Driving? Driving);
public sealed record DrivingRateChanged(decimal RateMinorPerKm);
public sealed record ExpenseDefaults(long AmountMinor, ExpenseCategory Category,
    string Description, Allocation[] Allocations, SplitMode SplitMode);
public sealed record RecurringExpenseRuleCreated(Guid RuleId, DateOnly EffectiveFrom,
    Schedule Schedule, ExpenseDefaults Defaults);
public sealed record RecurringExpenseRuleUpdated(Guid RuleId, DateOnly EffectiveFrom,
    Schedule Schedule, ExpenseDefaults Defaults);
public sealed record RecurringExpenseRuleStopped(Guid RuleId, DateOnly LastDate);
public sealed record RecurringExpenseOccurrenceOverridden(Guid RuleId,
    DateOnly ScheduledDate, OverrideAction Action, ExpenseDefaults? Changed);
public sealed record IncomeRecorded(Guid IncomeId, DateOnly ReceivedDate,
    long AmountMinor, string Source, Allocation[] Allocations, SplitMode SplitMode);
public sealed record IncomeDefaults(long AmountMinor, string Source, Allocation[] Allocations, SplitMode SplitMode);
public sealed record RecurringIncomeRuleCreated(Guid RuleId, DateOnly EffectiveFrom,
    Schedule Schedule, IncomeDefaults Defaults);
public sealed record RecurringIncomeRuleUpdated(Guid RuleId, DateOnly EffectiveFrom,
    Schedule Schedule, IncomeDefaults Defaults);
public sealed record RecurringIncomeRuleStopped(Guid RuleId, DateOnly LastDate);
public sealed record RecurringIncomeApproved(Guid RuleId, DateOnly ScheduledDate,
    DateOnly ReceivedDate, long AmountMinor, Allocation[] Allocations, SplitMode SplitMode, DateOnly? NextDueDate);
public sealed record RecurringIncomeRejected(Guid RuleId, DateOnly ScheduledDate,
    DateOnly? NextDueDate);
public sealed record TaskLogged(Guid TaskId, Guid HorseId, DateOnly TaskDate,
    TaskType TaskType, int Minutes, decimal? Quantity, string? QuantityUnit, string Notes);
```

No event contains derived balances. A projected transaction ID for an ordinary recurring expense is the stable pair `expense-rule/{ruleId}/{scheduledDate}`. An approved income transaction ID is `income-rule/{ruleId}/{scheduledDate}`. Rule revisions and overrides retain their own event IDs; they do not duplicate ledger identity.

## 3. Projection, concurrency, and recovery

### Write pipeline

1. Verify JWT and derive the subject. Validate request syntax, idempotency key, and `If-Match` stream version; reject before accessing storage when possible.
2. Acquire the subject's process semaphore and exclusive SMB file lock with a short timeout. Fail with 503 and retry guidance if the share is unavailable; do not continue without the lock.
3. Read the committed stream tail/version and check the idempotency key. Return the prior response on an exact retry. Reject changed payload under a reused key.
4. Compare `If-Match` with current version. On mismatch return `409 version_conflict` with the latest version and a safe refresh instruction.
5. Rebuild or refresh the subject projection through that version; validate all domain invariants, including horse ownership, schedule membership, amount and split sums, and no prior income decision.
6. Construct a single event with the next version, serialize and append one JSONL line, flush to the durable share, then update the in-process projection and respond `201` or `200` with `streamVersion` and resource ID. For a multi-event command, either encode one atomic domain event or explicitly design a batch commit protocol before implementation; this version uses one event per command.
7. Release lock and semaphore. If a failure occurs after flush but before the response, the idempotency key makes a retry safe. Never report success before durable flush.

All committing command handlers use the same pipeline. Financial preview requests are authenticated reads and append nothing. A duplicate approval with a different key conflicts even if the values match. No account may write to another subject's stream. One-time writes from a stale client version are rejected and must be refreshed; the UI preserves the unsent form.

### Read and cache pipeline

For each subject, cache an immutable projection together with its stream version and file fingerprint. On read, check the file's current committed version under a safe read of the mount; if the cache is current, use it. Otherwise replay missing events or rebuild from the most recent valid snapshot. Never trust an in-memory cache solely because this process handled the last write: another replica or deployment may have appended. An interval query expands schedules only within the requested inclusive dates and merges the latest per-date expense override. Pending income expands each active income-rule revision from its effective date through `min(today, queryEnd)`, then subtracts approved and rejected keys. It is read-only, has no persisted due item, and is stable across refreshes. Revisions split a date range at their effective dates so no date is generated twice.

Snapshots are considered only after 5,000 events and at a bounded later interval. Snapshot data includes the account subject hash, stream version, snapshot schema version, projection payload, and a checksum of the corresponding committed event prefix. Write a temporary snapshot, flush it, then atomically replace the old snapshot within the same share. If any check fails, ignore the snapshot and replay. Never delete events after snapshotting. A full replay of known events must produce byte-equivalent financial totals and pending keys to a snapshot-assisted replay.

Pure projection functions accept `(priorState, event)` and return a new state. Their only inputs are events and an explicit calendar date for virtual occurrences; no implicit wall clock or I/O. Reporting filters by owner-local calendar date: expenses use expense date or occurrence date; one-time and approved recurring income use actual received date. For each horse, `netMinor = sum(allocated realized income) - sum(allocated expenses)`. Pending and rejected income are excluded. Skipped expense occurrences are visible with zero contribution. Task reports read only TaskLogged events. The UI's owner-visible ledger can show virtual recurring expenses; downloadable accounting exports must label them as computed, not paid facts, because there is no expense payment approval workflow.

### Operational checks

- Test concurrent writers from two processes against the mounted SMB share, including same-version appends and duplicate idempotency keys. Exactly one divergent command may commit for a version.
- Kill a process during append and during snapshot replacement. Restart must either recover an unacknowledged partial final line or replay every acknowledged event. Never skip a corrupt complete line.
- Restore from an external backup into a fresh share and compare stream counts, versions, checksums, monthly totals, and pending keys.
- Alert on append/replay errors, lock timeouts, nonterminal corruption, snapshot failures, increasing replay time, and storage capacity; omit event payloads and user financial values from telemetry.
- Rate-limit authenticated requests and cap date intervals, generated occurrences, request sizes, and per-account task/horse lists. Validate strings before event serialization.

## 4. REST API contract

The endpoint inventory below is the baseline. [contracts/http-api.md](contracts/http-api.md) specifies planned refinements, authoritative preview requests, audit reads, and precise validation/response semantics.

Base path `/api/v1`; session endpoints are separately defined in [contracts/auth.md](contracts/auth.md). Every domain endpoint requires a valid WorkOS access token; the client never sends a tenant ID. Dates are `YYYY-MM-DD`. Financial amounts are integer minor units in the account currency. Lists use `limit` (default 50, maximum 200) and opaque `cursor`; date-range report endpoints accept `from` and `to`, inclusive, with the five-year and 10,000-generated-occurrence limits. Committing write requests require `Idempotency-Key: <UUID>` and `If-Match: "<streamVersion>"` (new account uses `"0"`); responses include `ETag: "<newVersion>"`. `GET /account` supplies current version for the first form. Request shapes below omit these common headers.

| Method and path | Request JSON / query | Success JSON and status |
|---|---|---|
| `GET /account` | None | `200 {currency,timeZone,streamVersion,drivingRateMinorPerKm}`; unconfigured account returns null settings and actual stream version (0 only for a new stream) |
| `PUT /account` | `{currency,timeZone}` | `200 {currency,timeZone,streamVersion}`; only before first financial entry |
| `GET /horses` | `status?,limit?,cursor?` | `200 {items:[Horse],nextCursor,streamVersion}` |
| `POST /horses` | `{name,breed,dateOfBirth,status}` | `201 {horseId,streamVersion}` |
| `GET /horses/{horseId}` | None | `200 Horse` |
| `PATCH /horses/{horseId}` | `{name?,breed?,dateOfBirth?}` with at least one field | `200 Horse`; details only |
| `PUT /horses/{horseId}/status` | `{status}` | `200 Horse` |
| `GET /expenses` | `from,to,horseId?,category?,limit?,cursor?` | `200 {items:[ExpenseLedgerItem],nextCursor,streamVersion}`; includes virtual occurrences and skipped flags |
| `POST /expenses` | `{expenseDate,amountMinor,category,description,split}` | `201 {expenseId,allocations,streamVersion}` |
| `PUT /driving-rate` | `{rateMinorPerKm}` | `200 {rateMinorPerKm,streamVersion}` |
| `POST /driving` | `{expenseDate,kilometers,rateMinorPerKm?,description,split}` | `201 {expenseId,amountMinor,allocations,streamVersion}`; omitted rate uses current account rate |
| `GET /expense-rules` | `limit?,cursor?` | `200 {items:[ExpenseRule],nextCursor,streamVersion}` |
| `POST /expense-rules` | `{schedule,amountMinor,category,description,split}` | `201 {ruleId,streamVersion}` |
| `PATCH /expense-rules/{ruleId}` | `{effectiveFrom,schedule,amountMinor,category,description,split}` | `200 {ruleId,streamVersion}` |
| `POST /expense-rules/{ruleId}/stop` | `{lastDate}` | `200 {ruleId,lastDate,streamVersion}` |
| `PUT /expense-rules/{ruleId}/occurrences/{scheduledDate}` | `{action:"Changed"|"Skipped",changed?:{amountMinor,category,description,split}}` | `200 {ruleId,scheduledDate,action,streamVersion}` |
| `GET /income` | `from,to,horseId?,source?,limit?,cursor?` | `200 {items:[RealizedIncomeItem],nextCursor,streamVersion}` |
| `POST /income` | `{receivedDate,amountMinor,source,split}` | `201 {incomeId,allocations,streamVersion}` |
| `GET /income-rules` | `limit?,cursor?` | `200 {items:[IncomeRule],nextCursor,streamVersion}` |
| `POST /income-rules` | `{schedule,amountMinor,source,split}` | `201 {ruleId,streamVersion}` |
| `PATCH /income-rules/{ruleId}` | `{effectiveFrom,schedule,amountMinor,source,split}` | `200 {ruleId,streamVersion}` |
| `POST /income-rules/{ruleId}/stop` | `{lastDate}` | `200 {ruleId,lastDate,streamVersion}` |
| `GET /income-approvals` | `from?,through?,limit?,cursor?` | `200 {items:[PendingIncome],nextCursor,asOfDate,streamVersion}` |
| `POST /income-rules/{ruleId}/occurrences/{scheduledDate}/approve` | `{receivedDate,amountMinor,split}`; defaults supplied explicitly by UI from pending item | `200 {ruleId,scheduledDate,realizedIncomeId,allocations,nextDueDate,streamVersion}` |
| `POST /income-rules/{ruleId}/occurrences/{scheduledDate}/reject` | `{}` | `200 {ruleId,scheduledDate,nextDueDate,streamVersion}` |
| `GET /tasks` | `from,to,horseId?,taskType?,limit?,cursor?` | `200 {items:[Task],nextCursor,streamVersion}` |
| `POST /tasks` | `{horseId,taskDate,taskType,minutes,quantity?,quantityUnit?,notes}` | `201 {taskId,streamVersion}` |
| `GET /reports/monthly-pnl` | `month=YYYY-MM,horseId?` | `200 {currency,month,items:[{horseId,incomeMinor,expenseMinor,netMinor}],streamVersion}` |
| `GET /reports/lifetime` | `horseId?,cursor?` | `200 {currency,asOfDate,items:[{horseId,incomeMinor,expenseMinor,netMinor}],streamVersion,complete,nextCursor}`; additive batches, display final totals only when complete |
| `GET /reports/breakdown` | `from,to,horseId?,kind=expense|income` | `200 {currency,items:[{label,amountMinor}],totalMinor,streamVersion}` |
| `GET /reports/activity` | `from,to,horseId?` | `200 {items:[{taskType,count,minutes}],streamVersion}` |

`split` is `{mode:"Equal",horseIds:[UUID...]}` or `{mode:"Custom",shares:[{horseId,weight}]}`. The server calculates `allocations` and never trusts client-calculated cents. A `Horse` response is `{horseId,name,breed,dateOfBirth,status}`. `ExpenseLedgerItem` is `{id,expenseDate,amountMinor,category,description,allocations,origin:"OneTime"|"Recurring",ruleId?,scheduledDate?,skipped}`. `RealizedIncomeItem` is `{id,receivedDate,amountMinor,source,allocations,origin:"OneTime"|"Recurring",ruleId?,scheduledDate?}`. `PendingIncome` is `{ruleId,scheduledDate,amountMinor,source,allocations}`. `ExpenseRule` and `IncomeRule` echo `{ruleId,schedule,defaults,effectiveFrom,lastDate?}`. `Task` matches the TaskLogged payload. All list ordering is deterministic by date then ID. Cursor binds filters and stream version; a version change invalidates an old cursor with 409 so pagination cannot silently skip new entries.

Example create and response:

```http
POST /api/v1/expenses
Authorization: Bearer <access-token>
Idempotency-Key: 04e2e3a2-6892-4d3b-a918-1a3147553196
If-Match: "7"
Content-Type: application/json

{"expenseDate":"2026-09-21","amountMinor":1001,"category":"Feed","description":"Hay","split":{"mode":"Equal","horseIds":["85fe5c1a-15d4-4567-8792-4db515f1e104","e093ba45-bfc7-4e35-9328-2c86cf8250cb"]}}
```

```json
{"expenseId":"6bbfd11e-7e31-44d3-859c-b33713611efc","allocations":[{"horseId":"85fe5c1a-15d4-4567-8792-4db515f1e104","weight":500000,"amountMinor":501},{"horseId":"e093ba45-bfc7-4e35-9328-2c86cf8250cb","weight":500000,"amountMinor":500}],"streamVersion":8}
```

Errors use `{code,message,correlationId,details?}`. `400` handles malformed input, `401` invalid/expired auth, `404` unknown or foreign ID, `409` stale version or already-decided occurrence, `422` valid JSON that violates domain rules, `429` throttling, and `503` share/lock failure with `Retry-After` when useful. Field errors use `details:[{field,message}]`. Never echo a foreign subject, path, or event payload in an error.

## 5. Frontend information architecture and state machines

```text
AppShell / AuthBoundary
├── HorsesPage -> HorseList, HorseForm, HorseDetailTabs
│   └── HorseDetailTabs -> Ledger, P&L, Activity
├── ExpensesPage -> ExpenseList, ExpenseForm, DrivingForm, ExpenseRuleList, RuleForm, OccurrenceEditor
├── IncomePage -> IncomeList, IncomeForm, IncomeRuleList, RuleForm
├── ApprovalInboxPage -> PendingPaymentCard, ApproveDialog, EditAndApproveDialog, RejectDialog
├── ReportsPage -> MonthPicker, PnlTable, Breakdown, LifetimeTable, ActivitySummary
├── TasksPage -> TaskList, TaskForm
└── SettingsPage -> CurrencyTimeZoneForm, DrivingRateForm
```

TanStack Router routes: `/horses`, `/horses/$horseId`, `/expenses`, `/income`, `/approvals`, `/tasks`, `/reports`, `/settings`. AuthBoundary blocks data loaders until an access token is ready. Forms show a preview of exact allocations, a human-readable currency amount, and the resulting monthly effect before submit. Keyboard focus moves to confirmation or field error after a result. An approval card clearly distinguishes scheduled due date, actual received date, pending status, and realized status. Any error leaves form values intact.

TanStack Query keys include the authenticated subject and stable normalized filters: `['account',sub]`, `['horses',sub,filters]`, `['horse',sub,id]`, `['expenses',sub,from,to,filters]`, `['expenseRules',sub]`, `['income',sub,from,to,filters]`, `['incomeRules',sub]`, `['approvals',sub,through]`, `['tasks',sub,filters]`, `['report',sub,kind,normalizedParameters]`. On successful mutation, store the new stream version and invalidate affected lists/reports; approvals invalidate income, inbox and reports, while tasks invalidate activity only. On 409, fetch current account version and affected queries, show a conflict message, and keep the draft for resubmission. On sign-out, cancel requests and clear all subject-keyed cache data. Do not cache another owner's data under a shared key.

Expense occurrence states:

```text
Rule active -> Virtual (computed on interval read)
Virtual -> Changed (override event) -> Changed again (new override event)
Virtual or Changed -> Skipped (override event)
Skipped -> Changed (new override event)
Rule stopped -> no occurrences after lastDate; prior states remain visible
```

The editor submits the scheduled date and full changed values, never a pre-materialized expense ID. The ledger marks virtual, changed, and skipped rows. Date filter changes recompute occurrences from rules plus overrides. No background task creates rows.

Income occurrence states:

```text
Scheduled (future) -> Pending (due and no decision)
Pending -> Approved (actual values persisted; realized ledger row)
Pending -> Rejected (decision persisted; zero realized value)
Approved / Rejected -> final; later due dates are separate keys
```

Inbox actions optimistically disable the card while submitting but do not claim success until the server confirms. A second tab's competing decision returns 409 and refreshes the card. Pending count is derived from the same as-of date and schedule logic as the list. The user can reach all three actions by keyboard, and status changes are announced accessibly.

## 6. Delivery and acceptance gates

Build in thin vertical slices: authentication and account/horse, one-time ledger and reports, recurring expenses, recurring income approvals, driving, then tasks and deeper analytics. For each slice, define the contract and a failing behavior test before production code as the project constitution requires. Pure recurrence, allocation, and projection tests use fixed dates and historical event fixtures. Integration tests exercise JWT isolation, real JSONL replay, idempotent retry, stale versions, and multi-process file locking on the target SMB mount. A running-interface check must demonstrate the primary owner task, keyboard use, feedback, and error recovery before release.

Release gates: all reported totals reconcile with event-derived ledger entries; no cross-owner access; accepted data survives restart and restore; exact duplicate approvals do not realize twice; backups can be restored; the chosen Azure region and realistic traffic forecast meet the budget target or the budget exception is explicitly accepted. The requested under-$5 target and SMB lock semantics are deployment validation gates, not assumptions proven by this document.
