# Data Model

**Feature**: Horse Finance and Effort Tracking | **Date**: 2026-09-21

Persisted shapes are canonical in [contracts/events-v1.schema.json](contracts/events-v1.schema.json). This document supplies semantic constraints that JSON Schema cannot express. API shapes are in [contracts/http-api.md](contracts/http-api.md). No database tables are introduced.

## Ownership and common value types

Every entity belongs to the authenticated WorkOS `sub`, implicitly through its enclosing stream. IDs supplied by the client are resolved only in that stream. Unknown and foreign resources produce indistinguishable 404 responses. UUID ordering means ascending lowercase hyphenated canonical strings with ordinal comparison, independent of .NET Guid byte order.

| Value | Representation and validation |
|---|---|
| Entity/event/idempotency IDs | UUID; server creates entity/event IDs at the I/O boundary; client creates command key |
| Calendar date | Valid ISO `YYYY-MM-DD`; use DateOnly, not UTC midnight; owner time zone defines today |
| Timestamp | UTC DateTimeOffset for audit ordering; streamVersion resolves timestamp ties |
| Money | Positive integer minor units for financial inputs; zero allowed for allocated share and skipped contribution; signed integer for net totals; safe JSON integer bound ±9,007,199,254,740,991 and checked arithmetic |
| Currency | Supported ISO 4217 code with known minor-unit precision; EUR default selected during setup; no conversion; reject unknown code |
| Time zone | Valid IANA identifier supported by runtime; validate before saving |
| Split request | Equal with distinct horseIds, or Custom with distinct horseId/positive integer weight pairs; 1–100 targets; weights sum exactly 1,000,000 |
| Allocation | horseId, weight, amountMinor; per-item sums equal original amount and 1,000,000; persist parent splitMode |
| Driving | Positive decimal kilometers (≤3 decimal places) and rateMinorPerKm (≤4); decimal multiplication with checked range; half-away-from-zero rounding once; reject rounded zero |
| Text | Trim outer whitespace for names/source/unit; name/source nonempty; preserve meaningful description/notes; lengths per event schema; never render as HTML |

Equal allocation uses integer quotient/remainder of amount divided by target count, independent of rounded display weights. Custom allocation uses exact weighted quotient/remainder; distribute largest remainder first, ties by canonical UUID. Preview and commit call the same function. Store results, not a future instruction to reallocate old money.

## Persisted and projected entities

| Entity | Fields / source | Relationships and constraints |
|---|---|---|
| Owner account | subject, currency, timeZone, drivingRateMinorPerKm, settingsLocked, streamVersion | Derived from AccountConfigured/DrivingRateChanged and first financial event. Initial settings null/version 0. Driving-rate changes alone are not financial entries; currency changes before the first financial event clear the saved rate. Horse/task changes alone do not freeze settings. Account setup required before finance. Before time-zone configuration, nonfinancial date validation uses the explicit UTC date supplied by the request boundary. |
| Horse | horseId, name, breed, nullable dateOfBirth, status | HorseRegistered, HorseDetailsUpdated, HorseStatusChanged. Name 1–100; breed ≤100; DOB not after today. Status Active/Leased/Retired/Sold. Detail patch cannot change status. No deletion. |
| Expense | expenseId, expenseDate, amountMinor, category, description, splitMode, allocations, nullable driving | ExpenseRecorded. Category from closed enum. One-time Driving category iff driving details present; ordinary expense endpoint excludes Driving, use driving command. Immutable committed record. |
| Recurring expense rule | ruleId, ordered revisions, optional lastDate | Each revision: effectiveFrom, schedule, defaults (amount/category/description/splitMode/allocations). No generated expense events. Generic recurring Driving defaults are disallowed because they lack distance/rate provenance. |
| Expense occurrence override | ruleId, scheduledDate, action, nullable changed defaults, eventId/version | Latest override wins per key. Date must be scheduled. Changed stores complete values; Skipped stores null. Nonfinancial skip retains original amount for display but contributes zero. |
| Income | incomeId, receivedDate, amountMinor, source, splitMode, allocations | IncomeRecorded is immediately realized. Source is trimmed owner label ≤100. Immutable committed record. |
| Recurring income rule | ruleId, ordered revisions, optional lastDate | Revision defaults: amount/source/splitMode/allocations. Schedules use same canonical expansion as expenses. |
| Income decision | ruleId, scheduledDate, decision, nextDueDate; approval adds receivedDate, amountMinor, splitMode, allocations | Exactly one approval/rejection per key. Rejection has no realized amount. Source resolved from rule revision at scheduled date. nextDueDate stored as traceability hint, not pending-state authority. |
| Task | taskId, horseId, taskDate, taskType, minutes, nullable quantity/unit, notes | TaskLogged; current horse Active/Leased; positive minutes or positive quantity required; quantity and nonempty unit appear together; minutes integer ≥0; notes ≤1000. Never enters finance projection. |
| Event envelope | eventId, streamVersion, schemaVersion, type, subject, occurredAt, idempotencyKey, commandHash, payload | One accepted command = one event. Versions contiguous starting at 1. Unique key per subject. Schema version is per event type. No balance fields. |
| Snapshot | subjectHash, streamVersion, snapshotSchemaVersion, prefixChecksum, projection | Optional cache only; corrupt/mismatched snapshot discarded. Original events remain authoritative. |

Expense categories: Stabling, Veterinary, Farrier, Feed, Equipment, Training, Driving, Other. Task types: Riding, Groundwork, Lunging, Grooming, MedicalCare, PaddockDuty, Transportation, Other. UI uses spaced labels for multiword task types.

## Horse lifecycle and historical eligibility

All four statuses can transition explicitly to another status; each accepted change is audited. Current Active/Leased status permits new one-time entries, tasks and new/revised splits. Sold/Retired remains readable/reportable. Status changes never recalculate past allocations or silently stop a rule.

An existing rule continues generating accepted obligations after a horse becomes inactive. The owner can stop it prospectively. Approving an existing obligation with its unchanged split remains allowed; editing the amount/date alone can keep that split. A changed split must use eligible horses. Expense amount/category edits can similarly preserve the original rule split; adding/replacing allocation targets requires eligibility. This exception settles or adjusts an existing obligation, not a new unrelated entry. All ownership checks still apply.

## Schedules and revisions

Schedule fields: cadence, interval, weekdays, nullable dayOfMonth, startDate, nullable endDate. Start/end inclusive; end ≥ start. Interval 1–366. Daily steps by interval calendar days from start. Weekly steps by interval weeks on start weekday. Weekdays uses interval 1 and distinct nonempty ISO weekdays 1–7. Monthly steps by interval months from start month, clamps dayOfMonth 1–31 to month end, then excludes candidates before start. Other cadences require dayOfMonth null and weekdays empty. Never advance by elapsed UTC hours.

Initial effectiveFrom equals startDate, which may be past. Every later effectiveFrom is strictly after ownerToday and after previously queued revisions. Keep startDate as the original cadence anchor; an effective date activates new defaults/cadence without moving the anchor. Revision i applies on `[effectiveFrom_i, effectiveFrom_next)` intersected with schedule and stop bounds. Generate a date at most once; no future revision rewrites an earlier date.

A revision cannot invalidate or change the applicable defaults for an existing overridden key in its future segment. Return 409 `protected_occurrence` and explain that the effective date must follow the protected override. Stopping sets terminal inclusive lastDate ≥ today and rule start; it cannot precede queued revision effective dates or any overridden/decided key. Return 409 rather than erase history. A previously stopped rule cannot be reopened or revised; create another rule if needed.

Date-window limit: `to >= from` and `to <= from.AddYears(5).AddDays(-1)`; a Feb-29 anniversary uses DateOnly's month-end clamp. At most 10,000 candidates across all matching rules before pagination and horse filtering. Lifetime aggregate uses bounded internal batches at one captured stream version, with additive cursor batches in the HTTP contract.

## Occurrence state transitions

| Current state | Action / condition | Result |
|---|---|---|
| Expense Virtual | Date generated from applicable rule | Visible computed cost, no event |
| Expense Virtual/Changed/Skipped | Changed override | Latest complete override visible; one event |
| Expense Virtual/Changed/Skipped | Skipped override | Visible skipped row, zero report contribution; one event |
| Income Scheduled | scheduledDate ≤ ownerToday and no decision | Pending, read-only derivation |
| Income Pending | Approve or Edit and approve | Final Approved; actual receivedDate ≤ ownerToday; one realized item |
| Income Pending | Reject | Final Rejected; zero realized income |
| Income Approved/Rejected | Another decision with another key | 409 already_decided; no event |
| Any accepted command | Same key + same commandHash | Original response/ETag; no event |
| Any accepted command | Same key + changed commandHash | 409 idempotency_conflict; no event |

Process decisions out of order without dropping earlier undecided dates. `nextDueDate` is the earliest undecided scheduled date strictly after the processed date, or null when there is none. Existing due dates remain pending after the rule stops. Future dates cannot be decided in advance.

## Read models and aggregation

- ExpenseLedgerItem: immutable one-time expense or computed occurrence keyed `expense-rule/{ruleId}/{scheduledDate}`, with origin, occurrenceState (Virtual/Changed/Skipped), skipped flag, original/display amount, splitMode, allocations and contributionMinor. Skipped contributions and allocated contributions are zero; display retains the skipped amount.
- RealizedIncomeItem: one-time receipt or approved item keyed `income-rule/{ruleId}/{scheduledDate}`. Use the rule revision's source and approved actual values. Pending/rejected dates never appear.
- PendingIncome: ruleId/date key, expected amount/source/splitMode/allocations and server asOfDate. No persisted due item.
- Monthly P&L/lifetime: sum per-horse allocated realized income minus effective expense allocations, with one currency. Include Sold/Retired horses. Lifetime includes dates through ownerToday; monthly uses the requested calendar month. Future one-time entries are excluded from as-of lifetime but visible in their selected interval.
- Breakdowns group expense category or exact normalized income source; horse filters use that horse's allocation only, never the full item amount. Task activity groups by type, counts tasks and sums minutes; do not sum incompatible quantity units.
- History: chronological accepted events ordered by streamVersion, including rejected income and superseded overrides; expose safe owner-facing event data, not subject, command hash, tokens or file paths.

No model persists derived balances, virtual occurrences, pending counts or task-derived monetary values. A pure replay plus explicit ownerToday produces the same totals/keys with or without a valid snapshot.
