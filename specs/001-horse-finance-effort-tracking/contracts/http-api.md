# HTTP API Contract

Base `/api/v1`. The full method/path/request/response inventory in [architecture.md §4](../architecture.md#4-rest-api-contract) is incorporated here; the following refinements are part of that inventory and take precedence where the baseline is abbreviated. [Data model](../data-model.md) defines every cross-field rule. Implementation produces OpenAPI from typed request/response records and verifies this contract before generating frontend types.

## Common protocol

Authentication/session endpoints are defined in [auth.md](auth.md). All domain endpoints require a validated bearer access token. Derive the user subject on the server; accept no owner/tenant parameter. Check every referenced horse/rule in that subject's projection, including filters, previews, revisions and history. Return identical 404 for missing/foreign IDs. Valid authentication is required before storage access. Configure exact CORS origins and expose ETag and Retry-After to the frontend; no arbitrary-origin access.

Commit commands require `Idempotency-Key` UUID and quoted integer `If-Match`; missing or malformed headers produce 400. The exception is the read-only preview POST. All successful domain reads/commits include ETag at the returned streamVersion. A response with baseline Horse shape adds streamVersion; all paged lists return items, nextCursor (null at end), streamVersion. Account GET returns actual version even if currency/timeZone are still null. Rate is null until configured; driving with omitted rate then returns 422 `driving_rate_required`.

Amounts are safe integers, dates are calendar-date strings, and domain string enums are exact case. Reject unknown fields, invalid enums, duplicate keys/targets and invalid dates. Command request maximum is 64 KiB; 413 `request_too_large`. Bound each split to 100 targets, name/breed/source/description/notes to model limits. No cursor or page-size parameter bypasses the recurrence-work budget.

Successful commits return only after durable append/flush. Exact idempotent retries return the original status, body and ETag; changed payloads with reused keys conflict. If-Match is checked after idempotency lookup. Original ETag may be older than current account version; client refetches after success and never decreases its remembered latest version.

## Resource and list refinements

- Horse details/status commands return the full Horse plus streamVersion. PATCH accepts only nonempty subset of name/breed/dateOfBirth; registered status is mandatory. Lists sort horses/rules by UUID; dated lists sort calendar date then stable ID, ascending.
- Expense/income/rule defaults and returned allocations include parent `splitMode`. Rule GET items include the ordered `revisions:[{effectiveFrom,schedule,defaults}]` and optional lastDate; the baseline summary fields reflect the currently applicable revision (or earliest upcoming revision before start). Clients must not discard queued revisions.
- Expense occurrence rows add `occurrenceState: Virtual|Changed|Skipped` for recurring origin and `contributionMinor`; skipped rows preserve amountMinor/allocations for explanation, but contribute zero. Filtering to one horse does not change the stored full item; show its allocated contribution separately.
- Approve defaults are explicit UI values. When editing receivedDate/amount without changing a pending split, preserve its splitMode and targets, even if a target is now inactive. New split targets require current Active/Leased status. Approval realizes actual receivedDate ≤ today.
- Ordinary POST expenses and recurring expense rule commands reject category Driving; POST driving is the only driving-cost path. Driving output uses ExpenseRecorded with used distance/rate. Recurring driving costs are outside this version's supported rule inputs.
- `GET /income-approvals` accepts `from?,through?,limit?,cursor?`. Default from is earliest rule start, through is ownerToday; later through is clamped to today. Return resolved `from`, `through`, `asOfDate`. Excessive windows return 422 with a suggested narrower window; no silent truncation. UI offers historical windows so every due undecided occurrence remains reachable.
- `GET /reports/lifetime` adds `asOfDate` and uses all financial history through ownerToday. Internal batches obey the normal expansion bounds; capture one immutable version/date and continue internal bounded date windows across cursor batches. Return additive batches `{currency,asOfDate,items,streamVersion,complete,nextCursor}` with at most 10,000 generated candidates per request. Items are batch contributions, not final lifetime balances until complete; the UI accumulates each cursor batch once and only displays complete totals. Cursor binds owner/version/asOfDate and expansion progress; any version change restarts the full accumulation.
- Task command omission defaults: minutes to 0, notes to empty string, and quantity/unit to null; still require positive minutes or positive quantity with unit. Persist all payload fields explicitly.
- `GET /reports/activity` remains nonfinancial. Quantity-only tasks count once with zero minutes; do not sum unlike units.
- Snapshot consistency applies to all pages. Opaque server-validated cursors bind subject, filters, sort position, streamVersion and asOfDate; tampering returns 400, changed version/date context returns 409 `cursor_expired`. Do not expose another subject inside cursors. Reusing a cursor with new filters returns 400.

## Financial preview

`POST /previews/financial` is an authenticated, nonmutating query with no command headers and no event append. Request:

- `kind`: Expense, Income, Driving, ExpenseOccurrenceChange, or IncomeApproval.
- `values`: the exact corresponding command body from the endpoint inventory.
- For an occurrence operation, `ruleId` and `scheduledDate` are required; otherwise absent.

Response `200 {currency,date,amountMinor,splitMode,allocations,monthlyEffect:[{month,horseId,incomeDeltaMinor,expenseDeltaMinor,netDeltaMinor}],streamVersion}` plus ETag. An override subtracts the previous effective contribution and adds the proposed one. An approval adds actual realized income to received month. Driving returns the calculated amount and resolved rate as `driving:{kilometers,rateMinorPerKm}`. A plain new item has one monthly delta per target. Recurring rule forms preview split/default amount, while generated occurrence previews use the authoritative expenses endpoint after rule creation; no client-side recurrence engine.

Validation is identical to the corresponding command at the returned version; a preview is not a reservation. Bind the form draft to its version and invalidate the displayed preview after edits. Commit can still conflict and must rerun validation. This endpoint centralizes arithmetic required for exact before-confirmation UI.

## Auditable history

`GET /history?limit=50&cursor=...&horseId=...&ruleId=...` returns `200 {items:[{eventId,streamVersion,type,occurredAt,summary,changes}],nextCursor,streamVersion}`. Optional filters resolve within the account; history entries associate with referenced horses/rules including allocations. `changes` contains only owner-facing domain fields from the canonical event payload; no subject, commandHash, idempotency key or file path. `summary` is a stable event-type label, not freeform HTML. Ordering is streamVersion ascending. Read-only endpoint; rejected decisions and superseded overrides remain visible.

## Error contract and recovery

Body `{code,message,correlationId,details?:[{field,message}]}`; version conflict may add `streamVersion`. Messages expose no token, filesystem path or foreign resource existence.

| Status | Codes / examples | Client behavior |
|---|---|---|
| 400 | malformed_request, invalid_header, invalid_cursor | Focus field/form error; keep draft |
| 401 | unauthenticated | Resolve session; preserve safe draft in memory; show sign-in recovery |
| 404 | not_found | Show unavailable resource without ownership explanation |
| 409 | version_conflict, already_decided, idempotency_conflict, protected_occurrence, cursor_expired | Refetch version/resource; keep unsent draft; require explicit resubmit after review |
| 413 | request_too_large | Explain form/request limit |
| 422 | invalid_split, invalid_schedule, invalid_amount, inactive_horse, settings_locked, interval_limit, occurrence_limit, driving_rate_required | Field-specific recovery; no partial event |
| 429 | rate_limited | Honor Retry-After; keep draft |
| 503 | storage_unavailable, lock_timeout, stream_unreadable | No false success; safe retry guidance, same key for ambiguous commit |

Automatic network retry keeps the exact original body/key/If-Match. A user-edited or deliberately resubmitted command gets a new key after refreshing state. An already-decided response clears that inbox card only after refetch; it does not announce the losing action succeeded.

## Protocol examples to test

1. POST expense 1001 units, Equal two sorted horses → allocations 501/500 and exactly one next event. Repeating the request key returns the same response without advancing version.
2. Two distinct approvals at the same expected version → one accepted event, one conflict; refreshed inbox absent and income realized once.
3. POST expense for another owner's horse, GET that horse, all foreign filters/history targets → identical not_found class without another owner's content.
4. Preview then concurrent edit → commit 409, draft retained and preview refreshed, no partial success.
5. Begin paged ledger, append a task, request next cursor → cursor_expired because the account stream version changed, even if financial values did not.
