# Operations release-gate preparation

This file records local preparation and the evidence still required. It does not mark performance, usability, cost, security, or external-storage acceptance complete.

## Performance tooling (T104)

`scripts/measure-journeys.mjs` waits for a visible ledger/report selector, waits two animation frames, and records navigation-to-visible time plus configured API-origin fetch/XHR duration and HTTP status. Failed navigation/render samples stay in the denominator and are counted as failures; any warm failure makes the threshold assessment fail. Its `cold` sample means a fresh browser context for each page navigation; the browser process and target app/server remain running and may be warm. It is not a Container Apps scale-to-zero cold-start measurement. It also reports reused-context samples, nearest-rank p50/p99/max, browser/runtime, OS/CPU/memory context, operator-supplied region, and a redacted endpoint/method timing list. Query strings, tokens, cookies, headers, and request/response bodies are not recorded. A minimum of 100 runs is required before p99 is shown. Dataset size is explicitly labeled as an operator claim in target mode; the harness does not verify the live application's underlying event count.

Before a large application run, `--smoke true` defaults to one iteration and exercises cold and warm ledger/report journeys. It writes no p99 and is never gate eligible. Progress events identify only mode, journey, index, outcome, duration, and API-failure count; fixture/auth failures stop the smoke immediately. Start the 100-run-per-mode application run only after all four smoke journeys pass.

The deterministic harness check passed locally with 100 horses and 5,000 synthetic changes represented in embedded fixture pages, 100 fresh-context and 100 reused-context iterations for each page, and no application API. The browser process and fixture server stayed running; fresh contexts are not service cold starts. It produced fresh-context p99 values of 41.39 ms (ledger) and 40.90 ms (report), and reused-context p99 values of 55.48 ms (ledger) and 40.91 ms (report). Sanitized raw JSON is at `validation/performance-synthetic.json`. Its mode is `synthetic-harness-check`, `gateEligible` is false, and `releaseGatePassed` is false. These numbers only verify that the measurement runner executes; they say nothing about app performance.

The TestHost-only fixture hook and frontend's meaningful selectors are available. After the frontend's current source fixes are frozen, run the local application fixture on dedicated ports and an isolated TestHost storage root, for example:

Start Vite with `VITE_API_BASE_URL` set to the same TestHost URL supplied as `--fixture-api-url` and `--api-origin`, and configure TestHost's `E2E_WEB_URL` to the Vite origin. This is required so requests reach the API while the browser proxy adapts CORS.

```sh
node scripts/measure-journeys.mjs \
  --ledger-url http://127.0.0.1:5173/income \
  --report-url http://127.0.0.1:5173/reports?month=2026-09 \
  --ledger-selector '[data-testid="ledger-ready"]' \
  --report-selector '[data-testid="report-ready"]' \
  --fixture-api-url 'http://127.0.0.1:<api-port>' \
  --api-origin 'http://127.0.0.1:<api-port>' \
  --dataset-description 'Synthetic isolated account; record the exact seed command and verification' \
  --runs 100 --region 'local TestHost' \
  --output specs/001-horse-finance-effort-tracking/validation/performance-local.json
```

The TestHost response must report exactly 100 horses and 5,000 accepted changes, a fixed aggregate event mix summing to 5,000, September 2026 date semantics, and its actual setup count and total stream event count; the harness checks `streamEvents = setupEvents + acceptedChanges` and bootstraps the test-only session outside timed page visits. Its Playwright route forwards real `/api/v1/**` calls to the isolated TestHost, handles preflight, and adapts CORS response headers for Vite's local origin. This verifies local end-to-end behavior but remains `gateEligible: false`. A target app run must independently verify its seed, record target region/runtime, inspect request timings, and fix measured bottlenecks under regression coverage. Warm p99 must be at most 2,000 ms for both ledger and report visibility. If claiming service cold-start behavior, separately time the first request after a verified scale-to-zero interval in the target hosting environment; a fresh browser context cannot establish that value.

For API diagnosis without the browser query waterfall, use `scripts/measure-http.mjs`. Launch a fresh isolated TestHost with `E2E_STORAGE_ROOT` under `$TMPDIR/cost-tracking-e2e/` and set `E2E_WEB_URL` to the same loopback origin passed to `--api-origin`; this direct runner uses that origin for fixture-session and scale-seed requests. For example:

```sh
api_origin=http://127.0.0.1:51941
run_id=$(date -u +%Y%m%dT%H%M%SZ)
storage_root="${TMPDIR%/}/cost-tracking-e2e/performance-http-$run_id"
mkdir -p "$storage_root"
caffeinate -dimsu env \
  E2E_STORAGE_ROOT="$storage_root" \
  E2E_WEB_URL="$api_origin" \
  dotnet backend/tests/CostTracking.TestHost/bin/Debug/net10.0/CostTracking.TestHost.dll \
  --urls "$api_origin"
```

After `/__fixture/health` returns ready, run the direct request capture with the pinned Node 24 toolchain on `PATH`:

```sh
node scripts/measure-http.mjs \
  --api-origin "$api_origin" \
  --runs 100 --diagnostic-runs 20 \
  --output "specs/001-horse-finance-effort-tracking/validation/performance-http-local-$run_id.json" \
  --host-awake-guard true
```

This direct diagnostic requires 100 samples for account, monthly P&L, and lifetime, and captures 20 samples each for horses, income, income rules, activity, and expense breakdown. It validates HTTP status, stream version, item counts and key account settings, writes raw safe endpoint timings plus an incremental progress journal, and refuses to overwrite existing output. It records endpoint-only 2,000 ms assessments; those are not the page-visible SC-002 gate. Direct requests are sequential, and the output must retain `hostLoadControlled: false` unless independent host-load evidence justifies changing that field. The 2026-10-17 result is at `validation/performance-http-local-20261017.json`; its three 100-sample endpoint p99 values are below 800 ms, but host load was uncontrolled and the result does not resolve the 2026-10-16 browser-visible threshold failure.

## Human usability (T105)

No participants were recruited or tested. Before a study, prepare a consent statement and an anonymized participant code sheet, then give each of 20 new users the same isolated synthetic-account task without coaching: create the first horse, record a split expense, and explain pending, realized, and skipped income states. Record completion time, unaided success, interpretation answers, observed blocking defects, browser/viewport/zoom, and whether assistance was requested. Do not collect names, account credentials, or financial data. Acceptance requires at least 18/20 to finish the first-horse/split-expense tasks unaided within five minutes and at least 18/20 to interpret all three income states correctly. Repeat after fixing defects; retain anonymized results and the exact task wording in `validation/usability.md`. No result can be entered until real human sessions occur.

## Measured cost (T106)

No region, Azure subscription entitlements, domain ownership, WorkOS plan, or usage telemetry was supplied, and no resources were created. Do not substitute a price estimate for evidence. The operator worksheet must date the estimate and include:

| Input              | Evidence to collect                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Region and compute | Container Apps CPU/memory, cold starts, active replica time, request volume, registry storage/egress                          |
| Azure Files        | Standard SKU, provisioned capacity, transaction assumptions, redundancy, growth/headroom, and actual SKU billing model        |
| Backup             | Independent destination SKU, capacity, 30-generation retention, transactions, recovery traffic, and failure-domain separation |
| Logs/alerts        | Ingested GB/day, 30-day retention, quota, metric/query alert charges and action-group delivery                                |
| Identity/domain    | WorkOS subscription/entitlements, domain registrar/DNS and certificate assumptions                                            |
| Usage and cap      | Measured workload period/volume, free grants actually available, estimated monthly total, and alert test evidence             |

The deployment target remains under $5/month unless the owner explicitly accepts a budget exception. `infra/README.md` records the free-tier and SKU assumptions; it is not a dated or measured regional estimate. Azure Files capacity alerts may lag, so operational headroom policy is also required.

## Security and coverage handoff (T098)

The final matrix should map every endpoint/resource lookup and filter to two authenticated owners plus an unauthenticated caller, and verify identical absent/foreign-resource behavior, safe error responses, payload-free storage logs, auth refresh/logout races, and no persistent browser tokens or financial data. Attach test names/results from the final backend and browser suite; this file is not evidence that the matrix passed. Current infrastructure uses read-only CI checkout permissions, secure Bicep secret parameters, restricted API-only SMB mount, no resource deployment in CI, and payload-free aggregate alerts. Key Vault key access is granted to the API managed identity; session state stays outside public config, and the sample parameters contain only fake `.test` values.

## Outstanding external evidence

Actual Azure Files cross-client locking/freshness/flush, independent backup restore and financial/pending reconciliation, WorkOS staging sign-in and rotation, 100-horse/5,000-change app performance, the 20-person usability study, and dated measured billing remain unverified. These gates require designated resources, seed confirmation, real measurements, or human participation. None can be completed by the local harness or template validation.
