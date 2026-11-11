# Usability remediation validation

Date: 11 November 2026. Source: the original live report at local path `docs/usability/2026-11-10-horse-owner-usability-test.md` (retained locally, excluded from publication). Work completed in the existing fb29 worktree; the original report and 11 linked JPEGs were preserved. No production account or record was changed and no password was copied or stored.

## Scope and workflow

Spec Kit specify → plan/research → tasks → read-only artifact analysis → implement → converge → implement remaining tasks. Requirements checklist: 10/10 checked. All 26 finding IDs are traced in spec.md; 24 are authorized requirements, U05/U07 are excluded by the user's explicit follow-up. No blocking clarification was necessary; assumptions are documented in the spec. No extension hooks are configured.

Initial analysis: 24/24 in-scope requirements mapped to tasks, no unmapped implementation task, no blocking ambiguity or constitution conflict. Convergence identified payment-editor reset, explicit decision receipts, recurring draft recovery, remaining date/history details, correction-aware lifetime bounds, canonical upcoming schedule dates and readable saved split shares; these were appended as T027–T034 and implemented. Final convergence checked all 24 required findings, five success criteria, the plan decisions and all eight constitution principles. No buildable gap remains; all 34 tasks are checked.

## Resolution crosswalk

| Finding | Status | Implementation and evidence |
| --- | --- | --- |
| U01 | Resolved | Positive ratios and decimal percentage shares normalize deterministically to exact millionths at the transport boundary; saved editors show percentages rather than internal weights; €60 at 2:1 previews €40/€20. Unit and real-API browser checks. |
| U02 | Resolved | Major-currency/km entry and exact decimal shifting; 24 km at €0.30/km previews/saves €7.20. Saved rates and receipt provenance retain precision. |
| U03 | Resolved | Successful task mutation updates/refetches account version; real API accepts three consecutive saves without reload. Conflict recovery refreshes in place and retains draft. |
| U04 | Resolved | Expense/income correction commands append full replacement events plus reason; original history remains. Server preview subtracts old and adds new allocations across months. Driving corrections are calculated on the server. HTTP tests include owner isolation, income/expense replay, earlier-month lifetime inclusion and unchanged historical sold targets. |
| U05 | Excluded | No stable/ownership grouping added, per explicit user instruction. |
| U06 | Repository complete; external setting pending | Same-origin explicit signed-out return and confirmation; session deletion/CSRF/origin tests pass. Actual WorkOS redirect needs the setting below and hosted verification. |
| U07 | Excluded | Sign-in routing unchanged, per explicit user instruction. |
| U08 | Resolved | Summary uses saved inclusive schedule end separately from stop date; bounded-rule component regression. |
| U09 | Resolved | Server chooses first valid example occurrence from schedule/effective date and rejects bounded schedules without a candidate. Monthly day-10 and month-end tests. |
| U10 | Resolved | Repeat interval, weekday/month day, allocation, end and stop state are visible. Upcoming scheduled date is supplied by the canonical server calendar across queued revisions. Ended rules retain their latest effective revision; revisions remain separate. Upcoming date means the next scheduled day after today, not an unpaid-balance prediction. |
| U11 | Resolved | Explicit partial receipts realize actual money and leave exact balance pending. Final settlement remains default; legacy approvals stay final. Retry, over-receipt, receipt-race, balance reset and €140 + €10 checks pass. |
| U12 | Resolved | Named decision receipt links to read-only history with scheduled/received dates, expected/cumulative received/difference, horses and outcome. Final decisions remain irreversible; guidance identifies the separate one-off correction path. |
| U13 | Resolved | Retired horses accept ordinary care/finance/tasks; Sold prevents new targeting. Unchanged historical correction targets remain valid. Status form explains consequences before saving. |
| U14 | Resolved | Both ledgers browse selected months and filter horses; report links preserve selection. Real-API browser drilldown and earlier-month correction tests. |
| U15 | Resolved | Subject/workflow/rule-scoped session drafts cover one-off, trip, task and recurring entry; previews are never persisted. Corrupt structures recover empty; failed storage installs departure warning. Cross-identity and navigation/reload tests. |
| U16 | Resolved | Task entry resets after success; saved tasks have reasoned append-only corrections for all task fields. HTTP and keyboard/browser correction checks. |
| U17 | Resolved | Activity aggregates exact matching quantity units and marks missing duration; tasks stay financially neutral. API/component/browser checks. |
| U18 | Resolved | Mobile navigation wraps with all seven named destinations visible at 390px/680px. Browser viewport and no-page-overflow checks. |
| U19 | Resolved | Visible table-scroll guidance, semantic keyboard-scroll regions, and a separate readable monthly net overview. Phone screenshots inspected. |
| U20 | Resolved | Stored audit summaries retained; structured horse links, amounts, category, allocations, quantities, correction reason and previous values supplement them. |
| U21 | Resolved | Mutually exclusive entry panels, explicit cancellation, asynchronous initial focus and trigger restoration; unique split/task IDs. Browser keyboard checks and corrected separate horse-filter labels. |
| U22 | Resolved | Month-name date and month formatting used in ledgers, reports, previews and financial summaries; native inputs/storage stay canonical. English/German tests. |
| U23 | Resolved | Monthly overview and totals row; lifetime footer uses Total. Integer aggregation and money rendering retain exact cents beyond one entry's safe-integer range. |
| U24 | Resolved | Fresh-account guidance explains adding horses then recording/splitting a first bill and scoping income/tasks. |
| U25 | Resolved | Familiar repeat/split/payment-state/amount-counted copy, explanatory ratio help and major-unit rates; complete German equivalents. |
| U26 | Resolved | Optional horse details/descriptions/notes identified; task time/quantity alternatives and required units explained before submission. |

## Validation evidence

Pinned runtime: Node v24.19.0, npm 11.17.0, .NET SDK 10.0.103. Dependencies restored from existing local caches. Initial backend baseline was 290 passing tests. Before integration with the two newer main commits, backend 296/296, contracts 42/42, component 93/93 and browser 33/33 passed; typecheck/lint/format/build passed. Final integration includes main commits `05c5702` (session renewal) and `44f7ceb` (Settings panel removal), preserving both behaviors.

| Final command/check | Result |
| --- | --- |
| `dotnet test backend/CostTracking.slnx --no-restore` | 298 passed |
| `node scripts/check-contracts.mjs` | Build passed, 42 contract tests passed, no generated drift |
| `npm --prefix frontend test -- --run` | 107 passed, 21 files |
| `npm --prefix frontend run typecheck` | Passed |
| `npm --prefix frontend run lint` | Passed |
| `npm --prefix frontend run format:check` | Passed |
| `npm --prefix frontend run build` | Passed |
| `node scripts/run-e2e.mjs` | 34 passed, including same-subject session renewal, two-tab approval conflict and the remediation journey |
| Diff whitespace check excluding untouched original report | Passed; the original report retains its two intentional Markdown hard breaks |

Historical-currency driving precision (JPY/BHD as well as EUR), saved percentage-share round trips, and exact large totals have additional component regressions. The source report and its JPEG evidence remain byte-for-byte unchanged from their original retained artifacts.

Observed red-to-green regressions include ordinary 2:1 ratios, euro-rate transport, task reset, absent correction preview/API, retired care targeting, missing bounded end, invalid monthly example date, absent quantity summaries, missing explicit logout return, partial receipt handling, stale €140 editor after €10 balance, earlier-date lifetime omission, large exact totals, absent canonical upcoming date and stale summary after rule stop. Changed copy assertions were updated to the specified behavior; local results do not establish historic red-first evidence for unrelated prior features.

Real-API browser coverage records three consecutive tasks, retired care, task correction, financial draft leave/restore, exact ratio preview/commit, financial correction, €0.30 trip, partial then final receipt, report/ledger selection, and a recoverable 503. The existing suite also exercises two-tab decision conflict and owner isolation.

Visual evidence is retained locally under `specs/005-usability-remediation/validation/` and is excluded from the public PR. It includes populated `reports-1440.png`, `reports-680.png`, `reports-390.png`; recoverable `error-1440.png`/`error-390.png`; empty-month `empty-1440.png`/`empty-390.png`; and correction-dialog `correction-1440.png`/`correction-390.png` captures. These were visually inspected. Responsive screenshots use isolated synthetic fixture accounts with a fixed 21 September 2026 owner day, not the original production account. Keyboard focus, all menu destinations, editor cancel/restore, table arrow-key focus, Escape/trigger restoration and no viewport overflow were checked.

The original live report and its 11 JPEGs also remain unmodified locally under `docs/usability/`. The first publication attempt was blocked by automatic approval review because the branch included captured live-app evidence in a public repository. All original reports and captured images were removed from the publication commit without deleting local files; only code, specifications, test sources and this validation summary are published.

## Exact remaining WorkOS action for U06

In the WorkOS environment used by the deployed app, open Applications → the application matching WorkOS:ClientId → Redirects → Sign-out URIs. Add `https://app.cost-tracking.ayasse.cloud/?signedOut=1` and set it as the default Sign-out URI. Keep Auth:FrontendOrigin set to `https://app.cost-tracking.ayasse.cloud`. The repository sends that exact same-origin return_to and clears the operational app session first. Do not change the sign-in route for U07.

WorkOS now documents default Sign-out URIs; its App homepage URL is deprecated. References: [session sign-out configuration](https://workos.com/docs/authkit/sessions), [logout API](https://workos.com/docs/reference/authkit/logout). This setting was not inspected or changed in the hosted dashboard. After configuring it, verify with an authorized hosted test account that Sign out lands on the app's signed-out confirmation, protected data is unavailable, and returning to the app remains signed out. Local fixture tests cannot prove this hosted action.

## Limits and publication

No direct deployment, production-data mutation, real participant study, physical-phone test, screen-reader certification, target Azure SMB test or release-readiness claim is made. Existing external release gates under feature 001 remain. The user subsequently authorized a PR and auto-merge; the normal main workflow may deploy after GitHub's required gates permit that merge. U06 hosted verification remains explicitly external rather than being presented as fixed in production.
