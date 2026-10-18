# Frontend journey validation

This report records frontend checks and local browser evidence. Mocked browser
tests validate presentation and recovery behavior. HTTP-backed journeys use the
isolated TestHost; they exercise the real local API and event store through a
Playwright route proxy. The proxy exists because the TestHost's CORS origin is
`https://app.test` while Vite uses a loopback HTTP origin. It handles test
preflight and forwards API requests and responses unchanged apart from local
CORS response headers.

## Commands and results

| Check | Result |
| --- | --- |
| `npm test -- --run` | 68 tests passed, 14 files passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run build` | Passed; Vite production bundle generated (105 modules) |
| `npm run format:check` | Passed; all matched files use Prettier style |
| `npm run test:e2e` | 21 browser tests passed with one worker in 12.2 seconds against the released TestHost build; storage root retained at `/var/folders/85/vq4prfkd0fj2c4fh8y27c3dw0000gn/T/cost-tracking-e2e/final-20261010-t072-luna02` |

The TestHost automated browser budget is 600 requests per minute to prevent
synthetic multi-journey traffic from hitting the product limiter. Production
and ordinary TestApplication settings remain at the 120-request default.

The browser suite is configured with one worker because its TestHost is a shared
mutable event store and the fixture restart journey replaces the host.

## Journey evidence

The existing mocked browser journeys cover account onboarding and exact split
expenses (`tests/e2e/private-ledger.spec.ts`), driving retry and provenance
(`tests/e2e/driving.spec.ts`), recurring expense create/revise/change/skip/restore/
stop (`tests/e2e/recurring-expenses.spec.ts`), approval keyboard flow and inbox
pagination/window recovery (`tests/e2e/income-approvals.spec.ts`), activity
logging (`tests/e2e/activities.spec.ts`), and report filters and allocated
breakdowns (`tests/e2e/reports.spec.ts`). These mocked journeys do not claim
backend integration by themselves.

HTTP-backed browser journeys are implemented in the same specs using
`tests/e2e/localBackend.ts` to establish a fixture session, prepare an account
and horse, and route browser API requests to the isolated TestHost:

- Income approvals create a recurring income rule, approve an unchanged payment,
  edit and approve a second payment, reject a third, then revise and stop the
  rule. The test reads the realized ledger and rule revisions directly from the
  backend to confirm the rejected occurrence contributed no income.
- Expense recurrence previews and creates a rule, changes one date, skips and
  restores another, queues a future revision, and stops inclusively. It checks
  the persisted rule and virtual occurrence rows through HTTP.
- Private ledger records an exact one-time expense and checks the backend
  allocation plus monthly P&L, expense category, income source, activity, and
  complete lifetime reports.
- Activity logging stores a quantity-only task and checks the task and activity
  report projections; duration remains zero.
- Driving saves a rate, previews and records a trip, then checks persisted
  distance, rate provenance, amount, and horse allocation.

The final 21-test browser run exercised the expanded stories above. Each of the
five HTTP-backed journeys uses the real isolated TestHost API/event store through
the local CORS proxy; mocked journeys remain presentation/recovery evidence.
The browser run is functional evidence only and is separate from the T104
application p99 measurement.

The first final-suite attempt passed 17/20 and exposed a TestHost-only stream
failure after its restart journey: the restarted test application reset its
deterministic event-ID source while retaining the same event stream. The income
rule create and expense occurrence write returned `503 stream_unreadable`, and
the subsequent horse setup write returned `409`. The backend fixture now uses
a shared GUID source across restart; the repeated full run passed all 21 tests.
This failure and fix are retained as integration evidence, not hidden by retry
logic or weakened assertions.

The income rejection path asserts an accepted `200` decision, a cursor-free
fresh approval GET without the rejected occurrence, and the UI's empty-window
message. A QueryClient test confirms that decision removal updates matching
occurrences across cached pages while preserving unrelated rows and page
parameters. Foreign-horse coverage checks both API `404` and the same generic UI
not-found view as an unknown horse. Narrow-layout coverage uses a 320 CSS-pixel
viewport and 200% CSS zoom emulation; it verifies horizontal containment and a
scrollable report table without shrinking text. It does not claim operating
system or browser-level zoom testing. Keyboard journeys exercise sign-in
handoff, onboarding, expense entry, and approval actions.

## Task crosswalk

These entries describe frontend scope; they do not mark `tasks.md` checkboxes.

- **T019** — Fully verified for local scope: API consumers use generated
  `ApiResponse`/`ApiPath` types without duplicated response DTOs; query keys,
  retry payload/key handling, auth bootstrap, and subject-cache clearing are
  covered. Fixture-session bootstrap/restart passes.
  Real hosted identity and external session recovery remain separate gates.
- **T041, T044** — Fully verified for local scope: financial form tests cover authoritative previews and exact
  splits. Reports include monthly P&L, horse drill-down, breakdowns, activity,
  and complete-only lifetime accumulation with cursor restart coverage. The
  local browser report story checks backend reconciliation.
- **T045** — Fully verified for local scope: the HTTP-backed private-ledger journey verifies a real expense,
  allocation, and reports. User-hosted sign-in and external restart/storage
  gates are not inferred from the local TestHost.
- **T048, T056–T058** — Fully verified for local scope: the expense rule form/editor/list and browser journeys
  cover example preview, date-specific change/skip/restore, revisions, stop,
  virtual occurrence projections, and neighbor dates. The final HTTP-backed
  journey persisted and verified the changed/skipped/restored dates, revision,
  and inclusive stop.
- **T060** — Fully verified for local scope; the final HTTP-backed recurring-expense browser journey passed.
- **T063, T069–T071** — Fully verified for local scope: approval dialogs cover
  approve, edit and approve, reject confirmation, keyboard focus, and recoverable
  conflicts. The inbox covers earlier windows, paging, oversized-window
  recovery, and cursor expiry/restart. An HTTP-backed journey exercises all
  final income decisions plus rule revision and stop.
- **T074** — Fully verified for local scope; the final HTTP-backed income approval/reconciliation journey passed
  and confirmed the rejected occurrence is absent from a fresh inbox response.
- **T072** — Fully verified for local scope by the final two-context TestHost
  race: both tabs loaded the same pending key, one approval returned `200`, the
  other returned `409 version_conflict`, and the losing tab's inbox refetched
  before it announced that the payment was already processed. The backend
  showed zero pending occurrences and exactly one realized income row.
- **T076, T079** — Fully verified for local scope: driving form tests cover saved-rate resolution, currency
  changes, retry keys, and recorded provenance. The HTTP-backed trip journey is
  implemented and passed in the final suite.
- **T081, T084, T086** — Fully verified for local scope: task form and activity report have component/browser
  coverage for minutes and quantity-only tasks. An HTTP-backed task journey
  verifies the persisted activity projection and passed in the final suite.
- **T088, T091–T095** — Fully verified for local scope: report tables, filters, inactive horses, lifetime
  completeness, cursor restart, and retry behavior have component and browser
  coverage. The HTTP-backed expense journey verifies reports against local
  event-store data; the final suite passed.
- **T098 browser scope** — Locally verified: two fixture identities were exercised in isolated
  browser contexts. The second identity could not list or fetch the first
  owner's horse, and the protected detail route rendered the same generic
  not-found response for a foreign and unknown horse. This does not validate
  WorkOS production identity.
- **T099** — Locally verified: `data-testid="ledger-ready"` and `data-testid="report-ready"` are
  rendered only after the corresponding monthly query succeeds; browser checks
  assert those markers. The final local browser run exercised both routes.

No Azure, SMB, WorkOS, human usability, target performance, paid-resource, or
production identity claim is made here.
