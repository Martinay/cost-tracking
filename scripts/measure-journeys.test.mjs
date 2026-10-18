import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeTimings,
  summarizeJourneySamples,
  assessWarmPerformance,
  validateMeasurementConfig,
  validateFixtureApiUrl,
  validateScaleFixture,
  validateJourneyMonths,
  includeRequestFailures,
  validateSourceSnapshot,
  createApiProxyHandler,
  summarizeSmokeSamples,
  settleJourneyLifecycle,
  shouldEmitProgress,
  formatProgressRecord,
  clockGapDiagnostic,
} from "./measure-journeys.mjs";

test("summarizes timings with nearest-rank p99 and preserves sample count", () => {
  const summary = summarizeTimings(
    Array.from({ length: 100 }, (_, index) => index + 1),
  );
  assert.deepEqual(summary, {
    samples: 100,
    minMs: 1,
    medianMs: 50,
    p99Ms: 99,
    maxMs: 100,
  });
});

test("does not report a passing performance gate without at least 100 warm runs", () => {
  assert.throws(() => summarizeTimings(Array(99).fill(100)), /At least 100/);
});

test("smoke mode allows one sample but never reports percentiles or gate eligibility", () => {
  const config = validateMeasurementConfig({
    ledgerUrl: "http://127.0.0.1:5173/income",
    reportUrl: "http://127.0.0.1:5173/reports?month=2026-09",
    ledgerSelector: '[data-testid="ledger-ready"]',
    reportSelector: '[data-testid="report-ready"]',
    datasetDescription: "Local smoke fixture",
    runs: 1,
    smoke: true,
  });
  assert.equal(config.runs, 1);
  assert.equal(config.smoke, true);
  assert.equal(
    validateMeasurementConfig({
      ledgerUrl: "http://127.0.0.1:5173/income",
      reportUrl: "http://127.0.0.1:5173/reports?month=2026-09",
      ledgerSelector: '[data-testid="ledger-ready"]',
      reportSelector: '[data-testid="report-ready"]',
      datasetDescription: "Local smoke fixture",
      smoke: true,
    }).runs,
    1,
  );
  assert.deepEqual(
    summarizeSmokeSamples([
      { durationMs: 12, outcome: "passed" },
      { durationMs: 19, outcome: "failed", failureClass: "timeout" },
    ]),
    { samples: 2, failedSamples: 1, durationsMs: [12, 19] },
  );
  assert.throws(() => summarizeTimings([12]), /At least 100/);
  assert.throws(
    () =>
      validateMeasurementConfig({
        ledgerUrl: "http://127.0.0.1:5173/income",
        reportUrl: "http://127.0.0.1:5173/reports?month=2026-09",
        ledgerSelector: '[data-testid="ledger-ready"]',
        reportSelector: '[data-testid="report-ready"]',
        datasetDescription: "Local smoke fixture",
        runs: 2,
        smoke: true,
      }),
    /exactly one run/,
  );
});

test("warm ledger and report visibility each have to meet the p99 threshold", () => {
  const summaries = {
    ledger: summarizeTimings(Array(100).fill(1800)),
    report: summarizeTimings([...Array(98).fill(1900), 2100, 2100]),
  };
  assert.deepEqual(assessWarmPerformance(summaries, 2000), {
    passed: false,
    thresholdMs: 2000,
    failures: [{ journey: "report", p99Ms: 2100 }],
  });
});

test("failed journey samples remain in the denominator and make the performance gate fail", () => {
  const ledgerSamples = [
    ...Array(99)
      .fill(null)
      .map(() => ({ durationMs: 200, outcome: "passed" })),
    { durationMs: 500, outcome: "failed", failureClass: "timeout" },
  ];
  const summaries = {
    ledger: summarizeJourneySamples(ledgerSamples),
    report: summarizeJourneySamples(
      Array(100)
        .fill(null)
        .map(() => ({ durationMs: 300, outcome: "passed" })),
    ),
  };
  assert.equal(summaries.ledger.samples, 100);
  assert.equal(summaries.ledger.failedSamples, 1);
  assert.equal(assessWarmPerformance(summaries, 2000).passed, false);
});

test("API status failures upgrade an otherwise visible journey to a failed sample", () => {
  const sample = includeRequestFailures({
    durationMs: 20,
    outcome: "passed",
    requests: [
      {
        method: "GET",
        endpoint: "/api/v1/reports/monthly-pnl",
        httpStatus: 500,
        outcome: "http-error",
      },
    ],
  });
  assert.equal(sample.outcome, "failed");
  assert.equal(sample.failureClass, "api-request-failure");
  assert.equal(
    summarizeJourneySamples([
      ...Array(99).fill({ durationMs: 20, outcome: "passed" }),
      sample,
    ]).failedSamples,
    1,
  );
});

test("known API cancellations caused by bounded page teardown do not become request failures", () => {
  const sample = includeRequestFailures({
    durationMs: 20,
    outcome: "passed",
    requests: [
      { method: "GET", endpoint: "/api/v1/reports/activity", outcome: "teardown-cancelled" },
    ],
  });
  assert.equal(sample.outcome, "passed");
});

test("source snapshot evidence requires a SHA-256 digest and timestamp", () => {
  assert.deepEqual(
    validateSourceSnapshot("a".repeat(64), "2026-10-09T12:00:00.000Z"),
    { sha256: "a".repeat(64), takenAtUtc: "2026-10-09T12:00:00.000Z" },
  );
  assert.throws(
    () => validateSourceSnapshot("not-a-hash", "2026-10-09T12:00:00Z"),
    /SHA-256/i,
  );
  assert.throws(
    () => validateSourceSnapshot("a".repeat(64), "not-a-date"),
    /timestamp/i,
  );
});

test("measurement output can record concurrent frontend browser validation and uncontrolled host load", () => {
  const config = validateMeasurementConfig({
    ledgerUrl: "http://127.0.0.1:5173/income",
    reportUrl: "http://127.0.0.1:5173/reports?month=2026-09",
    ledgerSelector: '[data-testid="ledger-ready"]',
    reportSelector: '[data-testid="report-ready"]',
    datasetDescription: "Pre-fix synthetic application baseline",
    frontendBrowserSuiteActive: "true",
    hostAwakeGuard: "true",
    runs: 100,
  });
  assert.equal(config.frontendBrowserSuiteActive, true);
  assert.equal(config.hostAwakeGuard, true);
  assert.throws(
    () =>
      validateMeasurementConfig({
        ledgerUrl: "http://127.0.0.1:5173/income",
        reportUrl: "http://127.0.0.1:5173/reports?month=2026-09",
        ledgerSelector: '[data-testid="ledger-ready"]',
        reportSelector: '[data-testid="report-ready"]',
        datasetDescription: "Synthetic app baseline",
        frontendBrowserSuiteActive: "maybe",
        hostAwakeGuard: "maybe",
        runs: 100,
      }),
    /frontendBrowserSuiteActive/,
  );
  assert.throws(
    () =>
      validateMeasurementConfig({
        ledgerUrl: "http://127.0.0.1:5173/income",
        reportUrl: "http://127.0.0.1:5173/reports?month=2026-09",
        ledgerSelector: '[data-testid="ledger-ready"]',
        reportSelector: '[data-testid="report-ready"]',
        datasetDescription: "Synthetic app baseline",
        hostAwakeGuard: "maybe",
        runs: 100,
      }),
    /hostAwakeGuard/,
  );
});

test("API proxy converts route-fetch exceptions into an observed failed request without logging them", async () => {
  let aborted = false;
  const captured = [];
  const handler = createApiProxyHandler("http://127.0.0.1:51872", (sample) =>
    captured.push(sample),
  );
  await assert.doesNotReject(() =>
    handler({
      request: () => ({
        method: () => "GET",
        url: () => "http://127.0.0.1:51872/api/v1/account",
      }),
      fetch: async () => {
        throw new Error(
          "TargetClosedError Bearer secret-token-must-not-escape",
        );
      },
      abort: async () => {
        aborted = true;
      },
    }),
  );
  assert.equal(aborted, true);
  assert.equal(captured[0].errorClass, "route-error");
  assert.doesNotMatch(JSON.stringify(captured), /secret-token-must-not-escape/);
});

test("API proxy classifies safe route timeouts without preserving exception text", async () => {
  const captured = [];
  const handler = createApiProxyHandler("http://127.0.0.1:51872", (sample) =>
    captured.push(sample),
  );
  await handler({
    request: () => ({
      method: () => "GET",
      url: () => "http://127.0.0.1:51872/api/v1/account",
    }),
    fetch: async () => {
      throw new Error("Timeout 15000ms exceeded Authorization: secret");
    },
    abort: async () => {},
  });
  assert.equal(captured[0].outcome, "network-error");
  assert.equal(captured[0].errorClass, "route-timeout");
  assert.doesNotMatch(JSON.stringify(captured), /secret|15000/);
});

test("progress journal includes timestamps and bounded diagnostic keys only", () => {
  const record = formatProgressRecord(
    {
      event: "api-request-complete",
      mode: "warm",
      journey: "report",
      index: 4,
      endpoint: "/api/v1/reports/monthly-pnl",
      method: "GET",
      durationMs: 25,
      httpStatus: 502,
      outcome: "http-error",
      errorClass: "route-error",
      authorization: "Bearer secret",
      url: "http://private.test/report?token=secret",
    },
    "2026-10-16T10:00:00.000Z",
  );
  assert.deepEqual(JSON.parse(record), {
    timestampUtc: "2026-10-16T10:00:00.000Z",
    event: "api-request-complete",
    mode: "warm",
    journey: "report",
    index: 4,
    endpoint: "/api/v1/reports/monthly-pnl",
    method: "GET",
    durationMs: 25,
    httpStatus: 502,
    outcome: "http-error",
    errorClass: "route-error",
  });
  assert.doesNotMatch(record, /secret|private\.test|authorization|token=/i);
});

test("clock diagnostics compare wall and monotonic elapsed time", () => {
  assert.deepEqual(
    clockGapDiagnostic({
      wallStartMs: 1000,
      wallEndMs: 5000,
      monotonicStartMs: 20,
      monotonicEndMs: 3010,
    }),
    { wallElapsedMs: 4000, monotonicElapsedMs: 2990, clockGapMs: 1010 },
  );
});

test("API proxy records backend status and timing with only the safe endpoint", async () => {
  const captured = [];
  const handler = createApiProxyHandler("http://127.0.0.1:51932", (sample) =>
    captured.push(sample),
  );
  await handler({
    request: () => ({
      method: () => "GET",
      url: () =>
        "http://127.0.0.1:51932/api/v1/reports/monthly-pnl?token=secret",
    }),
    fetch: async () => ({ status: () => 503, headers: () => ({}) }),
    fulfill: async () => {},
  });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].method, "GET");
  assert.equal(captured[0].endpoint, "/api/v1/reports/monthly-pnl");
  assert.equal(captured[0].httpStatus, 503);
  assert.equal(captured[0].outcome, "http-error");
  assert.ok(Number.isFinite(captured[0].durationMs));
  assert.doesNotMatch(JSON.stringify(captured), /secret|token=/i);
});

test("API proxy rejects local Vite URLs when the configured API origin is expected", async () => {
  const captured = [];
  let aborted = false;
  let fetchCalled = false;
  const handler = createApiProxyHandler(
    "http://127.0.0.1:51932",
    (sample) => captured.push(sample),
    "http://127.0.0.1:51931",
  );
  await handler({
    request: () => ({
      method: () => "GET",
      url: () => "http://127.0.0.1:51932/api/v1/account",
    }),
    fetch: async () => {
      fetchCalled = true;
      throw new Error("proxy should not fetch the wrong origin");
    },
    abort: async () => {
      aborted = true;
    },
  });
  assert.equal(aborted, true);
  assert.equal(fetchCalled, false);
  assert.deepEqual(
    captured.map(({ endpoint, outcome }) => ({ endpoint, outcome })),
    [{ endpoint: "/api/v1/account", outcome: "network-error" }],
  );
});

test("journey lifecycle bounds render settling and closes before bounded route drain", async () => {
  const order = [];
  const result = await settleJourneyLifecycle({
    settleRender: () => new Promise(() => {}),
    stopNetwork: async () => order.push("stop"),
    closePage: async () => order.push("close"),
    routeTasks: [new Promise(() => {})],
    timeoutMs: 5,
  });

  assert.deepEqual(order, ["stop", "close"]);
  assert.deepEqual(result, {
    renderSettled: false,
    networkStopped: true,
    pageClosed: true,
    routesDrained: false,
    pendingRouteCount: 1,
  });
});

test("progress output can report bounded journey batches and every failure", () => {
  assert.equal(
    shouldEmitProgress({ event: "journey-complete", outcome: "passed" }, 25, 25),
    true,
  );
  assert.equal(
    shouldEmitProgress({ event: "journey-complete", outcome: "passed" }, 24, 25),
    false,
  );
  assert.equal(
    shouldEmitProgress({ event: "journey-complete", outcome: "failed" }, 24, 25),
    true,
  );
});

test("requires both a user-visible route and a descriptive synthetic dataset", () => {
  assert.throws(
    () =>
      validateMeasurementConfig({
        ledgerUrl: "http://127.0.0.1:5173/ledger",
        reportUrl: "http://127.0.0.1:5173/reports",
        ledgerSelector: '[data-testid="ledger-ready"]',
        reportSelector: '[data-testid="report-ready"]',
        datasetDescription: "",
        runs: 100,
      }),
    /datasetDescription is required/,
  );
});

test("measurement runs record claims without labeling them verified", () => {
  const config = validateMeasurementConfig({
    ledgerUrl: "http://127.0.0.1:5173/ledger?month=2026-10",
    reportUrl: "http://127.0.0.1:5173/reports?month=2026-10",
    ledgerSelector: '[data-testid="ledger-ready"]',
    reportSelector: '[data-testid="report-ready"]',
    datasetDescription: "Synthetic local account seeded by the test operator",
    horses: 100,
    acceptedChanges: 5000,
    apiOrigin: "http://127.0.0.1:5010",
    runs: 100,
  });
  assert.equal(config.dataset.verified, false);
  assert.equal(config.dataset.horsesClaimed, 100);
  assert.equal(config.dataset.acceptedChangesClaimed, 5000);
  assert.equal(config.runs, 100);
  assert.equal(config.apiOrigin, "http://127.0.0.1:5010");
  assert.throws(
    () =>
      validateMeasurementConfig({
        ledgerUrl: "http://127.0.0.1:5173/income",
        reportUrl: "http://127.0.0.1:5173/reports?month=2026-09",
        ledgerSelector: '[data-testid="ledger-ready"]',
        reportSelector: '[data-testid="report-ready"]',
        datasetDescription: "https://example.com/person",
        runs: 100,
      }),
    /do not include names, URLs, IDs, or credentials/,
  );
  assert.throws(
    () =>
      validateMeasurementConfig({
        ledgerUrl: "http://127.0.0.1:5173/income",
        reportUrl: "http://127.0.0.1:5173/reports?month=2026-09",
        ledgerSelector: '[data-testid="ledger-ready"]',
        reportSelector: '[data-testid="report-ready"]',
        datasetDescription: "Synthetic local account",
        apiOrigin: "http://user:token@127.0.0.1:5010",
        runs: 100,
      }),
    /without embedded credentials/,
  );
});

test("fixture bootstrap accepts only local test-host origins", () => {
  assert.equal(
    validateFixtureApiUrl("http://127.0.0.1:5010"),
    "http://127.0.0.1:5010",
  );
  assert.equal(
    validateFixtureApiUrl("http://localhost:5010/"),
    "http://localhost:5010",
  );
  assert.throws(
    () => validateFixtureApiUrl("https://api.example.com"),
    /loopback/,
  );
  assert.throws(
    () => validateFixtureApiUrl("http://127.0.0.1:5010/prefix"),
    /origin only/,
  );
});

test("fixture proof preserves event mix and date-window semantics with the verified counts", () => {
  const fixture = {
    subject: "user_Fixture",
    horses: 100,
    setupEvents: 151,
    acceptedChanges: 5000,
    streamEvents: 5151,
    eventMix: { ExpenseRecorded: 3000, IncomeRecorded: 1500, TaskLogged: 500 },
    dateWindow: {
      from: "2026-09-01",
      through: "2026-09-30",
      asOfDate: "2026-09-21",
    },
  };
  assert.deepEqual(validateScaleFixture(fixture), {
    horses: 100,
    setupEvents: 151,
    acceptedChanges: 5000,
    streamEvents: 5151,
    eventMix: fixture.eventMix,
    dateWindow: fixture.dateWindow,
    verified: true,
  });
  assert.throws(
    () =>
      validateScaleFixture({
        ...fixture,
        acceptedChanges: 4999,
        streamEvents: 5150,
      }),
    /exactly/,
  );
  assert.throws(
    () => validateScaleFixture({ ...fixture, streamEvents: 5150 }),
    /setup plus accepted/,
  );
  assert.throws(
    () => validateScaleFixture({ ...fixture, subject: "another-user" }),
    /subject/,
  );
  assert.throws(
    () =>
      validateScaleFixture({ ...fixture, eventMix: { ExpenseRecorded: 4999 } }),
    /sum to acceptedChanges/,
  );
  assert.throws(
    () =>
      validateScaleFixture({
        ...fixture,
        dateWindow: { ...fixture.dateWindow, asOfDate: "2026-10-01" },
      }),
    /date window/,
  );
});

test("local measurement URLs must target the fixture month", () => {
  const window = {
    from: "2026-09-01",
    through: "2026-09-30",
    asOfDate: "2026-09-21",
  };
  assert.equal(
    validateJourneyMonths(
      "http://127.0.0.1:5173/income",
      "http://127.0.0.1:5173/reports?month=2026-09",
      window,
    ),
    "2026-09",
  );
  assert.throws(
    () =>
      validateJourneyMonths(
        "http://127.0.0.1:5173/income?month=2026-10",
        "http://127.0.0.1:5173/reports?month=2026-09",
        window,
      ),
    /fixture month/,
  );
  assert.throws(
    () =>
      validateJourneyMonths(
        "http://127.0.0.1:5173/income",
        "http://127.0.0.1:5173/reports?month=2026-10",
        window,
      ),
    /fixture month/,
  );
});
