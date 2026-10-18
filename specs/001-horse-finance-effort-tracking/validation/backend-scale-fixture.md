# Local diversified scale fixture evidence

**Status: synthetic local input and API report verified; not a deployment performance or recovery gate.**

`backend/tests/CostTracking.Tests/Fixtures/ScaleAccount.cs` deterministically creates the `user_Fixture` event stream used only by the isolated `CostTracking.TestHost`. The manifest has 100 horses, 176 setup events (account, horses, and 75 recurring rules), and 5,000 accepted changes, for 5,176 total events. The accepted event mix is 1,500 `ExpenseRecorded` (1,000 ordinary and 500 with driving provenance), 1,500 `IncomeRecorded`, 1,000 `TaskLogged` (including quantity-only tasks), 500 `RecurringExpenseOccurrenceOverridden`, 250 `RecurringIncomeApproved`, and 250 `RecurringIncomeRejected`. Dates cover September 2026, with owner `asOfDate` September 21. No IDs or event payloads are included in the measurement manifest.

The first expanded fixture test ran red against the previous 5,101-event expense-only fixture (`expected 5,176; actual 5,101`). It is now green and validates event schema serialization/replay, contiguous event/account versions, unique idempotency keys, 100 horses, expense/income/activity projections, 500 persisted driving records, recurring event counts, and nonzero September income and expense report totals. Focused command:

```sh
DOTNET_CLI_HOME=/private/tmp/cost-tracking-dotnet NUGET_PACKAGES=/private/tmp/cost-tracking-nuget \
  dotnet test backend/tests/CostTracking.Tests/CostTracking.Tests.csproj --no-restore \
  --disable-build-servers -m:1 -p:UseSharedCompilation=false \
  --filter FullyQualifiedName~ScaleAccountTests
```

Result: **1/1 passed**. `backend/tests/CostTracking.TestHost` built with zero warnings and errors. The new `POST /__fixture/scale` route accepts only `{}`, is restricted to a loopback client, loopback Host, and exact configured loopback Origin, creates a missing stream without replacing existing content, returns the same manifest for a byte-identical retry, and conflicts on nonidentical existing content. `POST /__fixture/session` defaults to `user_Fixture` and allows only the additional fixed synthetic subject `user_FixtureB`; arbitrary subjects are rejected. Both routes exist only in the TestHost project, not the production API.

A live local TestHost smoke observed: unsupported subject **400**; `user_FixtureB` session **200**; scale seed **200** with the counts above; identical seed retry **200**; wrong Origin and non-loopback Host **403**. With the seeded owner session, `GET /api/v1/reports/monthly-pnl?month=2026-09` returned **200**, 100 horse rows, stream version 5,176, total allocated expense 692,750 minor units, and total realized income 406,250 minor units. This verifies fixture-backed API/report output, not browser-visible timing, cold service start, target share behavior, restart recovery, or restore equivalence.

Red-first evidence for the fixture's changed count/projections is recorded above. The TestHost endpoint's manual security/duplicate smoke did not have a separate endpoint-level failing test before implementation; no test-first claim is made for those endpoint checks. The source is frozen for the coordinated frontend and measurement runs. Snapshot/cache acceptance remains gated by T021's actual Azure Files locking/flush proof.
