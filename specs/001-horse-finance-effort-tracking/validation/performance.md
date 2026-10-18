# Performance measurement record

## Application acceptance: LOCAL SYNTHETIC APP MEASURED; WARM THRESHOLD FAILED

On 2026-10-16, the local TestHost application completed 100 fresh-context and 100 reused-context journeys for both the month ledger and September report (400 journeys total). All journeys passed, and all 2,200 proxied API requests returned HTTP 200. The independently verified fixture contained 100 horses, 5,000 accepted changes, 176 setup events, and 5,176 stream events. The run used Chromium 156.0.8078.4, Node 24.19.0, macOS arm64, 12 logical CPUs, and 24 GiB RAM. The frontend code snapshot SHA-256 is `ed638ca30b3cdad18c2e1de9355f65a06572502a87a90f55df37d607c169145e` (2026-10-16T10:29:25Z); region was `local TestHost`.

| Journey | Cold p99 | Cold max | Warm p99 | Warm max | Failed samples |
| --- | ---: | ---: | ---: | ---: | ---: |
| Month ledger | 2,372.89 ms | 3,855.53 ms | 2,355.65 ms | 2,356.04 ms | 0 |
| September report | 2,356.57 ms | 2,855.64 ms | 2,856.13 ms | 2,872.76 ms | 0 |

The 2,000 ms warm threshold failed for both views. Cold p99 is reported separately; a fresh browser context is not a service cold start. The run used a task-scoped awake guard and measured a maximum 0.97 ms wall/monotonic clock gap, but `hostLoadControlled` is false. This is local synthetic-app evidence only: `gateEligible` and `releaseGatePassed` remain false, and there is no deployed-region or scale-to-zero result. No application fix is claimed. T104 remains incomplete pending a qualifying browser-visible run and diagnosis of its warm latency.

On 2026-10-17, a separate direct-HTTP diagnostic isolated API request cost from browser rendering and the page query waterfall. It used the same verified 100-horse, 5,000-change account (176 setup events; 5,176 total events) and made sequential requests to the local TestHost. The account, monthly P&L, and lifetime endpoints each had 100 samples; horses, income, income rules, activity, and expense breakdown each had 20 diagnostic samples. Every response was HTTP 200, matched stream version 5,176, and passed route-specific response checks. The 100-sample medians/p99s were 503.09/734.07 ms for account, 745.43/772.89 ms for monthly P&L, and 747.72/769.09 ms for lifetime. Account had one 2,152.27 ms maximum outlier. The five 20-sample diagnostic medians ranged from 512.28 to 564.25 ms; they are too small for p99 reporting. The raw artifact is [performance-http-local-20261017.json](performance-http-local-20261017.json), with the incremental journal beside it. The task-scoped awake guard was used, but host load was uncontrolled: one-minute load average rose from 2.11 to 3.28, and free memory started at 70.6 MiB. These endpoint timings are diagnostic only. They do not represent simultaneous browser queries, page-visible latency, Azure Files, a target region, or a release-gate result, and do not establish a cause for the earlier browser p99 failure.

The final raw result is [performance-local-20261016.json](performance-local-20261016.json). Its append-only, sanitized progress journal is [performance-local-20261016-progress.ndjson](performance-local-20261016-progress.ndjson); it records UTC phase timestamps, journey indices/outcomes, safe API paths/statuses/durations, cleanup state, and clock gaps, without payloads, headers, cookies, tokens, query strings, or exception text. The four-journey pre-run smoke is [performance-smoke-local-20261016.json](performance-smoke-local-20261016.json), with its journal beside it. The smoke passed 4/4 journeys and is not a p99 result.

The 2026-10-10 run remains preserved at [performance-local-t072-20261010.json](performance-local-t072-20261010.json). It contains 400 samples with 76 failed journeys, zero HTTP error statuses among captured requests, and network errors, timeouts, cleanup timeouts, and fixture-session failures. Its temporary frontend snapshot and process logs no longer exist, and the artifact has no progress timestamps or clock-gap measurements; its failure cause is unknown. The 2026-10-16 run used a fresh snapshot and awake guard, but does not prove what caused the earlier failures.

The runner now records safe route-error classes, wall/monotonic elapsed-time gaps, and a flushed incremental progress journal. Its 22 focused tests passed before the measurement. The earlier failed local attempt history and the separate embedded synthetic harness check remain below for context; neither replaces the final raw application run above.

## Measurement harness check: EXECUTED, SYNTHETIC ONLY

On 2026-10-09, `scripts/measure-journeys.mjs --self-test --runs 100` ran Chromium `156.0.8078.4` on Node `v24.19.0` against its embedded loopback HTML fixture. The fixture renders 100 synthetic horse rows and represents 5,000 synthetic changes in generated fixture data; it does not call the application API or replay ledger events. The harness captured 100 fresh-browser-context and 100 reused-context page visibility timings for each ledger/report page, for 400 samples total. The browser process and fixture server stayed running throughout; a fresh context does not represent Container Apps scale-to-zero or another service cold start. The output includes all raw samples, summary percentiles, host/browser context, and empty API timing arrays because the synthetic fixture makes no API calls.

| Journey               | Cold p99 | Warm p99 |
| --------------------- | -------: | -------: |
| Synthetic ledger page | 41.39 ms | 55.48 ms |
| Synthetic report page | 40.90 ms | 40.91 ms |

The anonymized raw record is [performance-synthetic.json](performance-synthetic.json). It labels itself `synthetic-harness-check`, `gateEligible: false`, and `releaseGatePassed: false`. Failed samples are retained and counted; any warm journey failure makes the p99 assessment fail. Output omits URLs/query strings, request/response bodies and headers, cookies, and tokens. It only verifies that the harness can run and emit raw samples.

## Repeatable local procedure and target-region gate

For a local application run, the TestHost loopback fixture verifies 100 horses and 5,000 accepted changes, then returns the actual setup-event count, event mix, and stream version. The fixture has 176 setup events and 5,000 accepted events and uses September 2026 (`from=2026-09-01`, `through=2026-09-30`, `asOfDate=2026-09-21`). The harness checks the counts and month selection, obtains the test-only token in each disposable browser context, and proxies API requests to adapt CORS for Vite. Set `VITE_API_BASE_URL` to the same TestHost origin passed to `--fixture-api-url` and `--api-origin`.

```sh
snapshot=/path/to/frozen-frontend
api_origin=http://127.0.0.1:51941
web_origin=http://127.0.0.1:51942
temp_root=$(python3 -c 'import tempfile; print(tempfile.gettempdir())')
run_id=$(date -u +%Y%m%dT%H%M%SZ)

E2E_STORAGE_ROOT="$temp_root/cost-tracking-e2e/performance-$run_id" \
E2E_WEB_URL="$web_origin" \
dotnet backend/tests/CostTracking.TestHost/bin/Debug/net10.0/CostTracking.TestHost.dll --urls "$api_origin"

VITE_API_BASE_URL="$api_origin" \
node "$snapshot/node_modules/vite/bin/vite.js" "$snapshot" \
  --config "$snapshot/vite.config.ts" \
  --host 127.0.0.1 --port 51932 --strictPort
```

```sh
node scripts/measure-journeys.mjs \
  --ledger-url 'http://127.0.0.1:51942/income' \
  --report-url 'http://127.0.0.1:51942/reports?month=2026-09' \
  --ledger-selector '[data-testid="ledger-ready"]' \
  --report-selector '[data-testid="report-ready"]' \
  --fixture-api-url 'http://127.0.0.1:51941' \
  --api-origin 'http://127.0.0.1:51941' \
  --dataset-description 'Verified isolated synthetic 100-horse, 5000-change account' \
  --runs 100 --region 'local TestHost' --host-awake-guard true --progress-every 25 \
  --source-snapshot-hash '<frozen-source-sha256>' \
  --source-snapshot-at-utc '<snapshot-UTC-timestamp>' \
  --output specs/001-horse-finance-effort-tracking/validation/performance-local.json
```

`--host-awake-guard true` records that an idle-sleep guard was used; it does not set `hostLoadControlled`. The runner writes `<output>.progress.ndjson` as samples complete so an interrupted run retains its safe phase and request diagnostics. Local fixture results remain `gateEligible: false` and say nothing about deployed-region timing. Target acceptance requires an independently seeded and verified account, the real API origin and deployed region/runtime, and retained seed/replay evidence. Measure actual service cold starts separately after a verified scale-to-zero interval. Warm p99 must be at most 2,000 ms for both views; retain every failed sample and result whether it passes or fails.
