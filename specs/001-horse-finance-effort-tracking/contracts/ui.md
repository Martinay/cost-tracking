# UI Contract and Acceptance

Routes: `/horses`, `/horses/$horseId`, `/expenses`, `/income`, `/approvals`, `/tasks`, `/reports`, `/settings`, plus authentication entry/callback. Use consistent primary labels: Add horse, Record expense, Record income, Record driving, Log activity, Approve, Edit and approve, Reject. A first-use account setup selects currency/time zone before finance; the interface explains when those settings become fixed.

## Tasks and observable results

| Primary task | Flow | Acceptance in the running interface |
|---|---|---|
| Keep private ledger | Sign in → settings → Add horse → Record expense/income → horse Ledger | New owner can enter €10.01 for two horses and see €5.01/€5.00 without instructions; confirmation follows server success; second account sees no first-account data |
| Maintain horse | Horse detail → Edit details / Change status | History remains visible after Sold/Retired; affected recurring rules are shown so owner can stop/revise obligations; inactive horses absent from new-target selectors |
| Plan costs | Expenses → Recurring → Add rule → interval ledger → Edit occurrence / Skip | Selected weekdays appear once; rule/date shown; computed, changed and skipped states have text labels; one date changes while another remains unchanged after sign-in |
| Confirm receipts | Approvals → select date → one of three named actions | Scheduled date, actual received date, Pending label and amount are distinct; approve/edit has authoritative preview; reject has explicit confirmation; accepted item disappears once and history records decision |
| Record driving | Record driving → distance/rate/targets → preview → confirm | Display used rate, rounded total and exact shares before commit; changing saved rate later does not change the receipt |
| Record effort | Log activity → horse/type/minutes or quantity/unit → save | Task appears in Activity, no financial amount or P&L change; quantity-only record accepted with zero minutes |
| Compare results | Reports → month/horse → P&L, lifetime, category/source, activity | Allocated totals reconcile; Sold/Retired included; pending/rejected excluded; lifetime clearly says “Through [date]”; no partial totals masquerade as complete |
| Inspect changes | Horse/rule history or account history link | Accepted changes/decisions chronological, including rejection and superseded overrides; no raw infrastructure metadata |

## Forms and preview state

Form states: idle → validating/previewing → ready → submitting → confirmed or recoverable error. All finance forms use the server preview; when values change, previous preview becomes stale and confirm waits for the current preview. Preserve typed values after validation, network failure and conflict. New commits retain a stable idempotency key across ambiguous retries. Do not claim saved status until server acknowledgment.

For recurring rule default split previews, use Expense/Income preview kind with schedule start as preview date and label its effect “Example occurrence”; creating the rule still validates schedule and all defaults. No browser recurrence calculation is authoritative. A skipped expense can be changed again through the occurrence editor. Inactive-horse obligations show an explanation that the existing split can be settled, while new targets must be eligible.

## State, cache and privacy

Auth boundary blocks all data loaders until the session is ready. Query keys include subject and normalized filters as listed in architecture §5. On any accepted event, update account version without decreasing it and invalidate history/account; invalidate feature lists and affected reports. Activity commands invalidate activity, not financial reports. Since cursors bind the whole stream version, discard stale pagination even for otherwise unchanged lists.

On 409, reload current account/resource and preview while retaining the draft for explicit resubmit. On sign-out or subject change, cancel requests, clear cached data and in-memory drafts, and ignore late responses belonging to the old subject. No financial data is placed in shared unscoped browser storage. Transient session/network failure preserves current draft in memory and offers retry; terminal authentication failure offers sign-in. Errors never expose tokens or account storage details.

Income inbox freezes server asOfDate during pagination and refreshes when the owner starts a new view. Provide date windows and “Earlier pending payments” navigation; show the window being viewed. Empty means none in that stated interval. If expansion exceeds limits, explain how to narrow dates; do not silently show a truncated backlog.

## Accessibility and recovery

Use semantic headings/tables/buttons, programmatically associated labels, visible keyboard focus, logical tab order, and status text in addition to color. Dialogs receive/contain focus and restore it to the initiating control; Escape closes an unsubmitted dialog. Validation summary receives focus and links to fields. Success, loading and failure have accessible status announcements; submitting actions disable repeat activation without obscuring progress. Text remains readable when zoomed; tables remain navigable on narrow screens.

Empty, loading, unauthenticated, conflict, unavailable and success states have distinct text and a usable next action. A storage failure keeps inputs and offers Retry; no generic blank screen. Concurrent income decisions announce that the item was already processed after refresh, not that the losing action succeeded.

## Usability and performance evidence

Use 20 new participants with the running interface. At least 18 register a horse and record a split expense without instructions within five minutes (SC-001); at least 18 distinguish pending income, realized income and skipped expenses from labels without help (SC-007). Record anonymized timings, outcomes and blocking/confusing defects. Resolve those defects before release.

Measure the month ledger/report journey from user action until meaningful values are visible. At least 99% of warm standard sessions finish within two seconds; report cold starts separately. Include dataset (100 horses/5,000 changes), browser, region and request timings. Automated keyboard journeys supplement, but do not replace, the human study.
