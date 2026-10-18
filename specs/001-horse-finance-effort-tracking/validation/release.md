# Release acceptance and readiness

**Readiness: NOT READY FOR DEPLOYMENT.** Local backend (256/256), generated-contract (42/42), frontend (68/68 plus typecheck/lint/format/build), local operational scripts (42/42), and HTTP-backed browser acceptance (21/21) pass; TestHost restart and browser-budget regressions are fixed in test hosting only. The 2026-10-16 400-journey local performance run completed without request or journey failures, but both warm p99 values exceeded the 2,000 ms limit, so T104 remains open. The 2026-10-17 direct HTTP baseline passed all 400 status/version/count checks but had uncontrolled host load and does not replace the browser-visible criterion. The earlier 2026-10-10 run with 76 failed journeys remains historical evidence. WorkOS staging, target Azure Files locking/restore, participant study, and measured cost evidence are also incomplete. No infrastructure was provisioned and no release gate is waived by a local test.

## Functional requirement reconciliation

| Requirement | Local evidence | Acceptance remaining |
|---|---|---|
| FR-001 Owner authentication and isolation | `AuthenticationTests`, `SessionBrokerTests`, `OwnerIsolationMatrixTests`, `ProtocolWiringTests`; frontend tokens are memory-only. | Local browser cross-account journey passes; actual WorkOS staging flow and sibling HTTPS hosts remain open. |
| FR-002 Horse lifecycle/history | `AccountHorseTests`, horse projections, history tests, recurring rule/approval tests and all-variant replay fixture. | Local browser setup, history, account-isolation, and horse not-found journeys pass; external auth/storage gates remain. |
| FR-003 Dated one-time expense entries | `OneTimeLedgerTests`, `FinancialPreviewTests`, serializer/schema tests. | Local private-ledger browser journey verifies preview, commit, allocation, and reports. |
| FR-004 Expense categories | `OneTimeLedgerTests.Every_ordinary_expense_category_is_accepted_and_driving_is_separate`. | Local browser expense/recurrence forms and report category view pass. |
| FR-005 Exact allocation of expenses and income | Allocation domain tests, ledger/report reconciliation fixtures, 1001-cent split and selected-horse breakdown integration tests. | Local browser income/expense journeys reconcile server allocations and reports. |
| FR-006 Driving calculations/provenance | `DrivingTests` and driving event schema/replay fixture; exact rate and rounded amount are persisted. | Local HTTP-backed driving browser journey passes and verifies stored provenance. |
| FR-007 Recurring expense rules/calendars | `ScheduleTests`, `RuleRevisionTests`, `RecurringExpenseTests`. | Local HTTP-backed recurring-expense journey passes; older red-first coverage gaps remain documented. |
| FR-008 Virtual expense occurrences | Occurrence expansion, report/history projection and read-only/event-count integration tests; lifetime test crosses 10,000 dates. | Local browser recurrence/report journeys pass; target SMB behavior remains unverified. |
| FR-009 Single-date expense change/skip | Expense override and preview integration tests cover changed/skipped/re-change semantics and deltas. | Local browser changed/skipped/restored occurrence journey passes. |
| FR-010 One-time realized income | One-time ledger, allocation, event schema and report tests. | Local UI and HTTP-backed ledger/report journey pass. |
| FR-011 Recurring income rules | Recurring-income domain and HTTP tests cover revisions/stops and immutable schedule anchors. | Local browser rule creation, revision, and stop journey passes. |
| FR-012 Pending income derivation | `RecurringIncomeTests` covers due-only, unique undecided occurrences, date windows and read-only behavior. | Local browser inbox paging/window journey passes. |
| FR-013 Exactly one final income decision | Decision/approval integration and restart/retry tests cover approve/reject and idempotent replay. | Local browser decision, cache invalidation, exact retry, and two-context losing-tab flows pass; exactly one decision was realized. Real WorkOS concurrency remains external. |
| FR-014 Realized values/rejection | Approval/report/history tests cover actual-date realization, rejected zero value, and subsequent due dates. | Local browser approval/edit/reject journey and fresh inbox/ledger checks pass. |
| FR-015 Horse activity tasks | `TaskTests`, `HorseTask` projection and schema/replay fixture cover minutes/quantity and task types. | Local keyboard/activity browser journeys and HTTP projection checks pass. |
| FR-016 Tasks excluded from finance | Task tests compare unchanged monthly P&L and financial stream behavior. | Local browser task journey confirms quantity-only activity and financial neutrality. |
| FR-017 Reports and activity summaries | `ReportTests`, `LifetimeReportTests`, breakdown/activity/P&L API and generated schema. | Local browser report routes, filters, activity, and drilldown pass. |
| FR-018 Allocated realized reporting | `ReportReconciliationTests` and `ReportTests` verify allocated totals and pending/rejected exclusion. | Local HTTP-backed browser reconciliation passes. |
| FR-019 Chronological audit history | History tests and event version replay cover owner-safe accepted changes; 17-variant fixture replays every event. | Local browser displays and reconciles accepted records; production auth/storage gates remain separate. |
| FR-020 Recoverable conflicts | Command-pipeline/idempotency and integration tests cover same-key replay, changed-body conflicts, version conflicts and races. | Local browser retries and conflict/error recovery pass; full historical red-first gaps remain explicit. |
| FR-021 Accessible feedback and recovery | Component and Playwright suites cover keyboard forms, labels, statuses, previews and retry paths; frontend full suite **21/21**, unit **68/68**, typecheck/lint/format/build pass. | Local functional accessibility and narrow-layout checks pass; 20-person success measures remain T105. |
| FR-022 Durability and truthful storage failures | Backend lock/append/recovery tests, safe telemetry tests, Linux proof, local backup/restore tests. | Actual Azure SMB fault/restore, service restart at scale, and independent backup recovery (T021/T103). |
| FR-023 Account currency/time zone setup | Account and finance integration tests cover validation, setup requirements, currency precision, time-zone dates and settings freeze. | Local settings UI tests and final browser run pass. |

## Success criteria

| Criterion | Status |
|---|---|
| SC-001 First horse and split expense unaided within five minutes | NOT MEASURED: 20 new participants required. |
| SC-002 Warm requested-month ledger/report p99 ≤2 seconds, cold starts separate | NOT MEASURED against the application. Synthetic harness execution is preparation only; see `ops-release-gates.md`. |
| SC-003 Allocation and net reconciliation | Backend/domain fixtures and local browser report/ledger comparisons pass. |
| SC-004 Cross-account isolation | Backend authenticated-owner matrix and local browser two-owner isolation pass. |
| SC-005 Schedule dates/no ordinary materialization | Backend schedule, event-count, and >10,000-date tests plus final recurring browser journey pass. |
| SC-006 Pending income excluded and one final decision | Backend pending/decision/report tests and local approval plus two-context losing-tab browser workflows pass. |
| SC-007 Correct pending/realized/skipped interpretation | NOT MEASURED: 20-person study required. |
| SC-008 100 horses/5,000 changes survive restart/recovery | The TestHost verifies a diversified 5,176-event input, replay, and 100-horse report; local no-reseed backup restore preserves report and pending projections. The actual 100-horse/5,000-change application restart on target storage remains unverified, and snapshots remain gated by T021. |

## Local validation and operating instructions

Use the pinned commands and synthetic test-host setup in [quickstart.md](../quickstart.md). Read [README.md](../../../README.md) for toolchain and implementation status, [infra/README.md](../../../infra/README.md) for non-deploying infrastructure validation, and [ops-backup-restore.md](ops-backup-restore.md) for synthetic backup/restore dry-runs. Current backend full-suite and generated-contract results are recorded in [implementation.md](implementation.md), [backend-acceptance.md](backend-acceptance.md), and [ops-infra-ci.md](ops-infra-ci.md). These reports retain the exact command scope and the latest owner-run results.

User-story acceptance indexes are [US1](us1.md), [US2](us2.md), [US3](us3.md), [US4](us4.md), and [US5](us5.md). They summarize supported local outcomes without replacing the open historical red-first evidence or external release gates.

Do not use production credentials in local files, test output, or screenshots. The WorkOS test identity and fixture session routes exist only in `backend/tests/CostTracking.TestHost`; production does not register them. The test host uses isolated temporary storage. Container and Bicep checks do not deploy resources. The verified Linux proof uses a disposable local filesystem, not Azure Files.

## Unresolved release gates

- T021/T103: designated Azure Files Standard share, effective SMB mount metadata, multi-client locking/freshness/durable flush and fault/restore matrix; local Linux success is not a substitute.
- T097: projection snapshots remain unimplemented until T021's actual target proof passes; the task list explicitly makes that proof a prerequisite.
- T102: WorkOS staging credentials, exact issuer/audience/JWKS, sibling HTTPS domains, refresh/logout, and Key Vault key/session rotation evidence.
- T104: the 2026-10-16 local application run at [performance-local-20261016.json](performance-local-20261016.json) completed 100 fresh-context and 100 reused-context journeys for both ledger and report (400 total); all journeys passed, and all 2,200 proxied API requests returned HTTP 200. The verified data set contains 100 horses, 5,000 accepted changes, and 5,176 stream events. Warm ledger p99 was 2,355.65 ms and report p99 was 2,856.13 ms, both above the 2,000 ms criterion. Its progress journal records safe per-request timings. This is a measured local threshold failure; it does not establish which backend stage is responsible. A separate direct HTTP baseline at [performance-http-local-20261017.json](performance-http-local-20261017.json) measured 100 requests each for account, monthly P&L, and lifetime; all response status/version/item-count checks passed. Their p99 values were 734.07 ms, 772.89 ms, and 769.09 ms respectively. Five other list/activity/breakdown endpoints passed 20 diagnostic samples each. The baseline is per-request API latency, not browser-visible journey timing, and records uncontrolled host load (load average rose from 2.11 to 3.28; free memory was initially 74 MB). These measurements do not attribute the end-to-end tail to replay or another backend stage and do not support a focused backend optimization. Both local artifacts are ineligible as release evidence; deployed-region runtime and service cold starts remain unverified. The 2026-10-10 run at [performance-local-t072-20261010.json](performance-local-t072-20261010.json) remains preserved as distinct history: 76 journeys failed under uncontrolled host load, with insufficient retained diagnostics to identify the cause. Its p99 values are not application-latency evidence.
- T105: 20 new-user study with the thresholds in `contracts/ui.md` and anonymized results.
- T106: dated region-specific cost estimate with measured usage, actual WorkOS/domain/storage inputs and spending-alert validation; under-$5 result or owner-approved budget exception.
- T107: FR/SC crosswalk, run/restore instructions, and unresolved gates are reconciled in README, quickstart, and this report; task complete. T108 remains open for the final shared diff/check review and task-marker reconciliation.

## Task marker reconciliation

The current task list has **86 checked and 22 unchecked task markers** (recounted directly from `tasks.md`). The open markers are grouped by the reason they remain open:

- **Historical red-first evidence (12)**: T041, T046–T048, T061–T063, T075–T076, T081, T087–T088. Their relevant tests and behaviors pass in the final suites, but the task requires observing the pre-implementation failure and that per-task history was not retained. A later pass is not presented as proof of an earlier red.
- **Storage/snapshot preparation (4)**: T021 awaits a designated Azure Files share; T096/T097 cover optional snapshots and remain behind the explicit target-locking proof prerequisite; T100's snapshot alert definition cannot be actionable until snapshot code emits a tested failure class. Local Linux proof, templates, image, and other telemetry are documented separately.
- **External execution (4)**: T102 WorkOS staging, T103 Azure Files fault/restore, T105 human study, and T106 measured regional billing need credentials, target resources, participants, or actual account usage.
- **Application performance (1)**: T104 has a complete local 100-horse/5,000-change browser measurement, but the warm p99 threshold fails for both measured views. The direct-HTTP baseline is complete and does not identify a backend bottleneck or justify a focused optimization; target-region scale-to-zero behavior is a separate external measure.
- **Closeout (1)**: T108 requires the final shared diff/check review and task-marker reconciliation. T107's documentation and crosswalk are complete and record both the October 10 failed diagnostic and the October 16 measured threshold failure.

No other locally executable acceptance criterion is currently unassigned. T022, T059, T072, T085, T098, T099, and T101 are checked against their recorded implementation and journey evidence.
