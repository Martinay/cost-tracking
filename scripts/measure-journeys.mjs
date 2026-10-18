#!/usr/bin/env node
import { createRequire } from "node:module";
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function summarizeTimings(values) {
  if (!Array.isArray(values) || values.length < 100) {
    throw new Error("At least 100 timing samples are required to report p99.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("Timing samples must be finite nonnegative milliseconds.");
  }
  const percentile = (fraction) =>
    sorted[Math.ceil(fraction * sorted.length) - 1];
  return {
    samples: sorted.length,
    minMs: round(sorted[0]),
    medianMs: round(percentile(0.5)),
    p99Ms: round(percentile(0.99)),
    maxMs: round(sorted.at(-1)),
  };
}

export function assessWarmPerformance(summaries, thresholdMs = 2000) {
  const failures = Object.entries(summaries)
    .filter(
      ([, summary]) => summary.p99Ms > thresholdMs || summary.failedSamples > 0,
    )
    .map(([journey, summary]) => ({
      journey,
      p99Ms: summary.p99Ms,
      ...(summary.failedSamples > 0
        ? { failedSamples: summary.failedSamples }
        : {}),
    }));
  return { passed: failures.length === 0, thresholdMs, failures };
}

export function summarizeJourneySamples(samples) {
  if (!Array.isArray(samples) || samples.length < 100) {
    throw new Error("At least 100 journey samples are required to report p99.");
  }
  const summary = summarizeTimings(samples.map((sample) => sample.durationMs));
  return {
    ...summary,
    failedSamples: samples.filter((sample) => sample.outcome !== "passed")
      .length,
  };
}

export function summarizeSmokeSamples(samples) {
  return {
    samples: samples.length,
    failedSamples: samples.filter((sample) => sample.outcome !== "passed")
      .length,
    durationsMs: samples.map((sample) => sample.durationMs),
  };
}

export function shouldEmitProgress(event, completedCount, every = 1) {
  if (event.event === "journey-complete") {
    return event.outcome !== "passed" || completedCount % every === 0;
  }
  return event.event === "fixture-bootstrap-complete";
}

export function clockGapDiagnostic({
  wallStartMs,
  wallEndMs,
  monotonicStartMs,
  monotonicEndMs,
}) {
  const wallElapsedMs = wallEndMs - wallStartMs;
  const monotonicElapsedMs = monotonicEndMs - monotonicStartMs;
  return {
    wallElapsedMs: round(wallElapsedMs),
    monotonicElapsedMs: round(monotonicElapsedMs),
    clockGapMs: round(Math.abs(wallElapsedMs - monotonicElapsedMs)),
  };
}

const progressFields = [
  "mode",
  "journey",
  "index",
  "durationMs",
  "clockGapMs",
  "outcome",
  "failureClass",
  "apiFailures",
  "pendingRoutes",
  "renderSettled",
  "networkStopped",
  "pageClosed",
  "routesDrained",
  "pendingRouteCount",
  "method",
  "endpoint",
  "httpStatus",
  "errorClass",
];

export function formatProgressRecord(event, timestampUtc = new Date().toISOString()) {
  const record = { timestampUtc, event: event.event };
  for (const key of progressFields) {
    if (event[key] !== undefined) record[key] = event[key];
  }
  return `${JSON.stringify(record)}\n`;
}

function safeRouteErrorClass(error, tearingDown) {
  if (tearingDown) return null;
  return /timeout|timed out/i.test(String(error?.message ?? ""))
    ? "route-timeout"
    : "route-error";
}

export function includeRequestFailures(sample) {
  if (
    sample.outcome === "passed" &&
    sample.requests.some(
      (request) =>
        request.outcome !== "completed" &&
        request.outcome !== "teardown-cancelled",
    )
  ) {
    return {
      ...sample,
      outcome: "failed",
      failureClass: "api-request-failure",
    };
  }
  return sample;
}

export function validateMeasurementConfig(options) {
  for (const name of ["ledgerUrl", "reportUrl"]) {
    let url;
    try {
      url = new URL(options[name]);
    } catch {
      throw new Error(`${name} must be a valid URL.`);
    }
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  for (const name of [
    "ledgerSelector",
    "reportSelector",
    "datasetDescription",
  ]) {
    if (typeof options[name] !== "string" || !options[name].trim()) {
      throw new Error(`${name} is required.`);
    }
  }
  const smoke = options.smoke === true || options.smoke === "true";
  const runs = Number(options.runs ?? (smoke ? 1 : 100));
  if (!Number.isInteger(runs) || (smoke ? runs !== 1 : runs < 100)) {
    throw new Error(
      smoke
        ? "Smoke mode requires exactly one run."
        : "At least 100 runs are required to report p99.",
    );
  }
  const thresholdMs = Number(options.thresholdMs ?? 2000);
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0)
    throw new Error("thresholdMs must be positive.");
  const suiteActive = options.frontendBrowserSuiteActive ?? false;
  if (![true, false, "true", "false"].includes(suiteActive)) {
    throw new Error(
      "frontendBrowserSuiteActive must be a boolean or the string true/false.",
    );
  }
  const awakeGuard = options.hostAwakeGuard ?? false;
  if (![true, false, "true", "false"].includes(awakeGuard)) {
    throw new Error("hostAwakeGuard must be a boolean or the string true/false.");
  }
  for (const [name, value] of [
    ["datasetDescription", options.datasetDescription],
    ["region", options.region ?? "unspecified"],
  ]) {
    if (
      value.length > 100 ||
      !/^[A-Za-z0-9][A-Za-z0-9 .,()_-]*$/.test(value.trim())
    ) {
      throw new Error(
        `${name} may contain only short plain labels; do not include names, URLs, IDs, or credentials.`,
      );
    }
  }
  const fixtureApiUrl = options.fixtureApiUrl
    ? validateFixtureApiUrl(options.fixtureApiUrl)
    : null;
  const sourceSnapshot = validateSourceSnapshot(
    options.sourceSnapshotHash,
    options.sourceSnapshotAtUtc,
  );
  let apiOrigin =
    fixtureApiUrl ?? new URL(options.apiOrigin ?? options.ledgerUrl).origin;
  if (options.apiOrigin) {
    let apiUrl;
    try {
      apiUrl = new URL(options.apiOrigin);
    } catch {
      throw new Error("apiOrigin must be a valid HTTP or HTTPS URL.");
    }
    if (
      !["http:", "https:"].includes(apiUrl.protocol) ||
      apiUrl.username ||
      apiUrl.password
    ) {
      throw new Error(
        "apiOrigin must use HTTP or HTTPS without embedded credentials.",
      );
    }
    apiOrigin = apiUrl.origin;
    if (fixtureApiUrl && apiOrigin !== fixtureApiUrl) {
      throw new Error(
        "apiOrigin must match fixtureApiUrl when using the local TestHost fixture.",
      );
    }
  }
  return {
    ledgerUrl: options.ledgerUrl,
    reportUrl: options.reportUrl,
    ledgerSelector: options.ledgerSelector,
    reportSelector: options.reportSelector,
    dataset: {
      description: options.datasetDescription.trim(),
      horsesClaimed: optionalCount(options.horses),
      acceptedChangesClaimed: optionalCount(options.acceptedChanges),
      verified: false,
    },
    fixtureApiUrl,
    apiOrigin,
    sourceSnapshot,
    smoke,
    onProgress:
      typeof options.onProgress === "function" ? options.onProgress : null,
    frontendBrowserSuiteActive: suiteActive === true || suiteActive === "true",
    hostAwakeGuard: awakeGuard === true || awakeGuard === "true",
    region: options.region ?? "unspecified",
    runs,
    thresholdMs,
  };
}

export function validateSourceSnapshot(hash, takenAtUtc) {
  if (hash === undefined && takenAtUtc === undefined) return null;
  if (typeof hash !== "string" || !/^[a-f0-9]{64}$/i.test(hash)) {
    throw new Error(
      "sourceSnapshotHash must be a 64-character SHA-256 digest.",
    );
  }
  if (
    typeof takenAtUtc !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(takenAtUtc) ||
    !Number.isFinite(Date.parse(takenAtUtc))
  ) {
    throw new Error("sourceSnapshotAtUtc must be an ISO-8601 UTC timestamp.");
  }
  return { sha256: hash.toLowerCase(), takenAtUtc };
}

export function createApiProxyHandler(
  webOrigin,
  onRequest = null,
  expectedApiOrigin = null,
  onRequestStart = null,
  isTearingDown = () => false,
) {
  return async (route) => {
    const request = route.request();
    const started = performance.now();
    const endpoint = safeEndpoint(request);
    onRequestStart?.({ method: request.method(), endpoint });
    const record = (httpStatus, outcome, errorClass = null) => {
      if (!onRequest) return;
      onRequest?.({
        method: request.method(),
        endpoint,
        durationMs: round(performance.now() - started),
        httpStatus,
        outcome,
        ...(errorClass ? { errorClass } : {}),
      });
    };
    try {
      if (request.method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": webOrigin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
            "Access-Control-Allow-Headers":
              "Authorization,Content-Type,Idempotency-Key,If-Match,X-CSRF-Token",
            "Access-Control-Max-Age": "600",
          },
        });
        return;
      }
      if (
        expectedApiOrigin &&
        new URL(request.url()).origin !== expectedApiOrigin
      ) {
        record(null, "network-error", "wrong-api-origin");
        await route.abort("failed");
        return;
      }
      const response = await route.fetch({ timeout: 15_000 });
      const status = response.status();
      record(status, status >= 400 ? "http-error" : "completed");
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          "Access-Control-Allow-Origin": webOrigin,
          "Access-Control-Allow-Credentials": "true",
        },
      });
    } catch (error) {
      const tearingDown = isTearingDown();
      record(
        null,
        tearingDown ? "teardown-cancelled" : "network-error",
        safeRouteErrorClass(error, tearingDown),
      );
      // Do not surface Playwright's route exception text: it includes request
      // headers, including the fixture Bearer token. An abort becomes a normal
      // requestfailed event and remains in the journey failure denominator.
      try {
        await route.abort("failed");
      } catch {
        // A page/context teardown can win the race; no diagnostics are emitted.
      }
    }
  };
}

export async function settleJourneyLifecycle({
  settleRender,
  stopNetwork,
  closePage,
  routeTasks,
  timeoutMs = 2_000,
}) {
  const renderSettled = await boundedOperation(settleRender, timeoutMs);
  const networkStopped = await boundedOperation(stopNetwork, timeoutMs);
  const pageClosed = await boundedOperation(closePage, timeoutMs);
  const tasks = [...routeTasks];
  const routesDrained = await boundedOperation(
    () => Promise.allSettled(tasks),
    timeoutMs,
  );
  return {
    renderSettled,
    networkStopped,
    pageClosed,
    routesDrained,
    pendingRouteCount: routesDrained ? 0 : tasks.length,
  };
}

async function boundedOperation(operation, timeoutMs) {
  let timer;
  const result = await Promise.race([
    Promise.resolve()
      .then(operation)
      .then(() => true, () => false),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return result;
}

export function validateFixtureApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("fixtureApiUrl must be a valid loopback URL.");
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (
    url.protocol !== "http:" ||
    !loopbackHosts.has(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "fixtureApiUrl must use an unauthenticated HTTP loopback origin.",
    );
  }
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error("fixtureApiUrl must contain an origin only.");
  return url.origin;
}

export function validateScaleFixture(result) {
  if (result?.subject !== "user_Fixture")
    throw new Error("Scale fixture returned an unexpected subject.");
  if (result.horses !== 100 || result.acceptedChanges !== 5000) {
    throw new Error(
      "Scale fixture did not confirm exactly 100 horses and 5000 accepted changes.",
    );
  }
  if (
    !Number.isInteger(result.setupEvents) ||
    result.setupEvents < 0 ||
    !Number.isInteger(result.streamEvents) ||
    result.streamEvents !== result.setupEvents + result.acceptedChanges
  ) {
    throw new Error(
      "Scale fixture stream event count must equal setup plus accepted changes.",
    );
  }
  if (
    !result.eventMix ||
    typeof result.eventMix !== "object" ||
    Array.isArray(result.eventMix) ||
    Object.values(result.eventMix).some(
      (count) => !Number.isInteger(count) || count < 0,
    ) ||
    Object.values(result.eventMix).reduce((sum, count) => sum + count, 0) !==
      result.acceptedChanges
  ) {
    throw new Error("Scale fixture event mix must sum to acceptedChanges.");
  }
  const dateWindow = result.dateWindow;
  const isoDate = (value) =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (
    !dateWindow ||
    !isoDate(dateWindow.from) ||
    !isoDate(dateWindow.through) ||
    !isoDate(dateWindow.asOfDate) ||
    dateWindow.from.slice(0, 7) !== dateWindow.through.slice(0, 7) ||
    dateWindow.asOfDate < dateWindow.from ||
    dateWindow.asOfDate > dateWindow.through
  ) {
    throw new Error("Scale fixture date window is invalid.");
  }
  return {
    horses: result.horses,
    setupEvents: result.setupEvents,
    acceptedChanges: result.acceptedChanges,
    streamEvents: result.streamEvents,
    eventMix: result.eventMix,
    dateWindow,
    verified: true,
  };
}

export function validateJourneyMonths(ledgerUrl, reportUrl, dateWindow) {
  const month = dateWindow.from.slice(0, 7);
  const ledgerMonth = new URL(ledgerUrl).searchParams.get("month");
  const reportMonth = new URL(reportUrl).searchParams.get("month");
  if (ledgerMonth && ledgerMonth !== month)
    throw new Error(`Ledger URL must select the fixture month ${month}.`);
  if (reportMonth !== month)
    throw new Error(`Report URL must select the fixture month ${month}.`);
  if (dateWindow.asOfDate.slice(0, 7) !== month)
    throw new Error("Fixture owner date must be within the measured month.");
  return month;
}

function optionalCount(value) {
  if (value === undefined) return null;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0)
    throw new Error("Dataset counts must be nonnegative integers.");
  return count;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function safeEndpoint(request) {
  const url = new URL(request.url());
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "api" && parts[1] === "v1") {
    const safeParts = new Set([
      "api",
      "v1",
      "account",
      "horses",
      "expenses",
      "driving-rate",
      "driving",
      "previews",
      "financial",
      "income",
      "income-rules",
      "income-approvals",
      "activities",
      "reports",
      "monthly-pnl",
      "breakdown",
      "activity",
      "lifetime",
      "tasks",
    ]);
    return `/${parts
      .slice(0, 4)
      .map((part) => (safeParts.has(part) ? part : ":resource"))
      .join("/")}`;
  }
  return `/${parts.slice(0, 2).join("/")}`;
}

async function captureJourney(
  context,
  url,
  selector,
  expectedOrigin,
  timeoutMs,
  onReady,
  onProgress,
) {
  const page = await context.newPage();
  await page.bringToFront();
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);
  const requests = [];
  const routeTasks = new Set();
  let resolveApiFailure;
  let tearingDown = false;
  const apiFailure = new Promise((resolve) => {
    resolveApiFailure = resolve;
  });
  let fixtureSession = null;
  if (expectedOrigin) {
    // Recover the TestHost-issued access token inside this disposable context,
    // then emulate the same auth-session response as the local E2E proxy.
    // The token remains in memory and is never included in output.
    await page.goto(new URL("/__fixture/health", expectedOrigin).toString());
    fixtureSession = await page.evaluate(async () => {
      const response = await fetch("/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          `Fixture session lookup returned HTTP ${response.status}.`,
        );
      return await response.json();
    });
    if (!fixtureSession?.accessToken)
      throw new Error("Fixture session lookup returned no access token.");
    const webOrigin = new URL(url).origin;
    await page.route("**/auth/session", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({
          user: { id: fixtureSession.user?.id ?? "user_Fixture" },
          accessToken: fixtureSession.accessToken,
          csrfToken: fixtureSession.csrfToken ?? "fixture-csrf",
        }),
      }),
    );
    // TestHost CORS is configured for its HTTPS fixture origin. This browser
    // proxy forwards real API traffic and adapts only CORS response headers to
    // the local Vite origin, preserving actual status and request timing.
    const proxyHandler = createApiProxyHandler(
      webOrigin,
      (sample) => {
        requests.push(sample);
        onProgress?.({ event: "api-request-complete", ...sample });
        if (sample.outcome !== "completed") resolveApiFailure(sample);
      },
      expectedOrigin,
      (request) => onProgress?.({ event: "api-request-start", ...request }),
      () => tearingDown,
    );
    await page.route("**/api/v1/**", (route) => {
      const task = proxyHandler(route);
      routeTasks.add(task);
      task.finally(() => routeTasks.delete(task));
      return task;
    });
  }
  const wallStartMs = Date.now();
  const start = performance.now();
  let sample;
  let forcedFailureClass = null;
  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    if (!response?.ok())
      throw new Error(
        "Journey navigation returned an unsuccessful HTTP response.",
      );
    const readiness = page
      .locator(selector)
      .waitFor({ state: "visible", timeout: timeoutMs })
      .then(() => ({ ready: true }))
      .catch((error) => ({ error }));
    const first = await Promise.race([
      readiness,
      apiFailure.then((failure) => ({ apiFailure: failure })),
    ]);
    if (first.apiFailure) {
      forcedFailureClass = "api-request-failure";
      throw new Error("An API request failed before the ready state.");
    }
    if (first.error) throw first.error;
    onReady?.();
    onProgress?.({ event: "render-settle-start" });
    const renderSettled = await boundedOperation(
      () =>
        page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        ),
      2_000,
    );
    onProgress?.({ event: "render-settle-complete", settled: renderSettled });
    if (!renderSettled) throw new Error("Render did not settle after readiness.");
    sample = {
      durationMs: round(performance.now() - start),
      outcome: "passed",
      requests,
    };
  } catch (error) {
    sample = {
      durationMs: round(performance.now() - start),
      outcome: "failed",
      failureClass:
        forcedFailureClass ??
        (/timeout/i.test(error.message)
          ? "timeout"
          : "navigation-or-render-error"),
      requests,
    };
  } finally {
    onProgress?.({ event: "journey-cleanup-start", pendingRoutes: routeTasks.size });
    const cleanup = await settleJourneyLifecycle({
      settleRender: async () => {},
      stopNetwork: async () => {
        tearingDown = true;
        await page.route("**/api/v1/**", (route) => route.abort());
      },
      closePage: async () => page.close(),
      routeTasks,
      timeoutMs: 2_000,
    });
    onProgress?.({ event: "journey-cleanup-complete", ...cleanup });
    sample = includeRequestFailures({ ...sample, requests });
    if (
      !cleanup.networkStopped ||
      !cleanup.pageClosed ||
      !cleanup.routesDrained
    ) {
      sample = {
        ...sample,
        outcome: "failed",
        failureClass: "cleanup-timeout",
        cleanup,
      };
    } else {
      sample.cleanup = cleanup;
    }
  }
  sample.requests = requests;
  sample.clock = clockGapDiagnostic({
    wallStartMs,
    wallEndMs: Date.now(),
    monotonicStartMs: start,
    monotonicEndMs: performance.now(),
  });
  return sample;
}

async function measureMode(browser, config, mode) {
  const samples = { ledger: [], report: [] };
  const requestSamples = { ledger: [], report: [] };
  let sharedContext;
  if (mode === "warm") {
    sharedContext = await browser.newContext();
    try {
      emitProgress(config, { event: "fixture-bootstrap-start", mode });
      await bootstrapFixture(sharedContext, config);
      emitProgress(config, { event: "fixture-bootstrap-complete", mode });
    } catch {
      samples.ledger.push({
        durationMs: 0,
        outcome: "failed",
        failureClass: "fixture-bootstrap-failure",
      });
      emitProgress(config, {
        event: "journey-complete",
        mode,
        journey: "ledger",
        index: 1,
        outcome: "failed",
        failureClass: "fixture-bootstrap-failure",
        durationMs: 0,
        apiFailures: 0,
      });
      await sharedContext.close();
      return modeResult(samples, requestSamples, config.smoke);
    }
  }
  try {
    for (let index = 0; index < config.runs; index += 1) {
      for (const [journey, url, selector] of [
        ["ledger", config.ledgerUrl, config.ledgerSelector],
        ["report", config.reportUrl, config.reportSelector],
      ]) {
        const context = sharedContext ?? (await browser.newContext());
        const durationStart = performance.now();
        emitProgress(config, {
          event: "journey-start",
          mode,
          journey,
          index: index + 1,
        });
        try {
          let sample;
          try {
            if (!sharedContext) {
              emitProgress(config, { event: "fixture-bootstrap-start", mode });
              await bootstrapFixture(context, config);
              emitProgress(config, {
                event: "fixture-bootstrap-complete",
                mode,
              });
            }
            sample = await captureJourney(
              context,
              url,
              selector,
              config.apiOrigin,
              config.smoke ? 15_000 : 60_000,
              () =>
                emitProgress(config, {
                  event: "journey-ready",
                  mode,
                  journey,
                  index: index + 1,
                }),
              (event) =>
                emitProgress(config, {
                  ...event,
                  mode,
                  journey,
                  index: index + 1,
                }),
            );
          } catch {
            sample = {
              durationMs: round(performance.now() - durationStart),
              outcome: "failed",
              failureClass: "fixture-session-failure",
              requests: [],
            };
          }
          samples[journey].push({
            durationMs: sample.durationMs,
            outcome: sample.outcome,
            ...(sample.clock ? { clock: sample.clock } : {}),
            ...(sample.failureClass
              ? { failureClass: sample.failureClass }
              : {}),
          });
          requestSamples[journey].push(...sample.requests);
          emitProgress(config, {
            event: "journey-complete",
            mode,
            journey,
            index: index + 1,
            outcome: sample.outcome,
            ...(sample.failureClass
              ? { failureClass: sample.failureClass }
              : {}),
            durationMs: sample.durationMs,
            ...(sample.clock ? { clockGapMs: sample.clock.clockGapMs } : {}),
            apiFailures: sample.requests.filter(
              (request) => request.outcome !== "completed",
            ).length,
          });
        } finally {
          if (!sharedContext) await context.close();
        }
        if (config.smoke && samples[journey].at(-1).outcome !== "passed") {
          await sharedContext?.close();
          return modeResult(samples, requestSamples, true);
        }
      }
    }
  } finally {
    await sharedContext?.close();
  }
  return modeResult(samples, requestSamples, config.smoke);
}

function modeResult(samples, requestSamples, smoke) {
  return {
    summaries: Object.fromEntries(
      Object.entries(samples).map(([name, values]) => [
        name,
        smoke ? summarizeSmokeSamples(values) : summarizeJourneySamples(values),
      ]),
    ),
    rawSamples: samples,
    requestTimings: requestSamples,
  };
}

function emitProgress(config, event) {
  config.onProgress?.(event);
}

async function bootstrapFixture(context, config) {
  if (!config.fixtureApiUrl) return;
  const page = await context.newPage();
  page.setDefaultTimeout(config.smoke ? 15_000 : 60_000);
  page.setDefaultNavigationTimeout(config.smoke ? 15_000 : 60_000);
  try {
    const webOrigin = new URL(config.ledgerUrl).origin;
    await page.goto(webOrigin, {
      waitUntil: "domcontentloaded",
      timeout: config.smoke ? 15_000 : 60_000,
    });
    const result = await page.evaluate(async (apiBase) => {
      async function post(path) {
        const response = await fetch(`${apiBase}${path}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const body = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(`Fixture ${path} returned HTTP ${response.status}.`);
        return body;
      }
      const session = await post("/__fixture/session");
      if (session?.subject !== "user_Fixture")
        throw new Error("Fixture session returned an unexpected subject.");
      return { session, scale: await post("/__fixture/scale") };
    }, config.fixtureApiUrl);
    const proof = validateScaleFixture({
      ...result.scale,
      subject: result.session.subject,
    });
    const month = validateJourneyMonths(
      config.ledgerUrl,
      config.reportUrl,
      proof.dateWindow,
    );
    config.dataset = {
      ...config.dataset,
      horsesClaimed: proof.horses,
      setupEvents: proof.setupEvents,
      acceptedChangesClaimed: proof.acceptedChanges,
      streamEvents: proof.streamEvents,
      eventMix: proof.eventMix,
      dateWindow: proof.dateWindow,
      measuredMonth: month,
      verified: proof.verified,
      evidence: "TestHost-only loopback fixture response",
    };
  } finally {
    await page.close();
  }
}

function syntheticDocument(kind, horses, acceptedChanges) {
  const horseRows = Array.from(
    { length: horses },
    (_, index) => `<li>Horse ${index + 1}</li>`,
  ).join("");
  const stream = Array.from({ length: acceptedChanges }, (_, index) => ({
    streamVersion: index + 1,
    kind: "synthetic",
  }));
  const selector = kind === "ledger" ? "ledger-ready" : "report-ready";
  const title = kind === "ledger" ? "October ledger" : "Monthly reports";
  const contents =
    kind === "ledger"
      ? `<ul>${horseRows}</ul><p>${stream.length} accepted changes loaded.</p>`
      : `<p>Report calculated from ${stream.length} accepted changes and ${horses} horses.</p>`;
  return `<!doctype html><html><head><title>${title}</title></head><body><main data-testid="${selector}"><h1>${title}</h1>${contents}</main></body></html>`;
}

async function syntheticConfig(runs, smoke = false) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const ledgerHtml = syntheticDocument("ledger", 100, 5000);
  const reportHtml = syntheticDocument("report", 100, 5000);
  const server = createServer((request, response) => {
    const body =
      request.url === "/ledger"
        ? ledgerHtml
        : request.url === "/reports"
          ? reportHtml
          : null;
    if (body === null) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    browser,
    server,
    config: {
      ledgerUrl: `${baseUrl}/ledger`,
      reportUrl: `${baseUrl}/reports`,
      apiOrigin: baseUrl,
      ledgerSelector: '[data-testid="ledger-ready"]',
      reportSelector: '[data-testid="report-ready"]',
      dataset: {
        description: "Built-in deterministic synthetic HTML fixture",
        horsesClaimed: 100,
        acceptedChangesClaimed: 5000,
        verified: true,
        fixture: true,
      },
      region: "local synthetic fixture",
      runs,
      thresholdMs: 2000,
      smoke,
    },
  };
}

function loadPlaywright() {
  const require = createRequire(path.join(root, "frontend", "package.json"));
  try {
    return require("@playwright/test");
  } catch (error) {
    throw new Error(
      `Playwright is not installed from frontend/package-lock.json: ${error.message}`,
    );
  }
}

export async function runJourneyMeasurement(
  config,
  { synthetic = false } = {},
) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    return await executeMeasurement(browser, config, synthetic);
  } finally {
    await browser.close();
  }
}

async function executeMeasurement(browser, config, synthetic) {
  const cold = await measureMode(browser, config, "cold");
  const coldFailed =
    config.smoke &&
    Object.values(cold.rawSamples).some((samples) =>
      samples.some((sample) => sample.outcome !== "passed"),
    );
  const warm = coldFailed
    ? {
        summaries: {
          ledger: summarizeSmokeSamples([]),
          report: summarizeSmokeSamples([]),
        },
        rawSamples: { ledger: [], report: [] },
        requestTimings: { ledger: [], report: [] },
      }
    : await measureMode(browser, config, "warm");
  const assessment = config.smoke
    ? null
    : assessWarmPerformance(warm.summaries, config.thresholdMs);
  const allJourneysSuccessful = [cold, warm].every((mode) =>
    Object.values(mode.summaries).every(
      (summary) => summary.failedSamples === 0,
    ),
  );
  return {
    schemaVersion: 1,
    recordedAtUtc: new Date().toISOString(),
    mode: synthetic
      ? "synthetic-harness-check"
      : config.fixtureApiUrl
        ? "local-test-host"
        : "target-application",
    gateEligible: false,
    smoke: config.smoke,
    smokeComplete: config.smoke && allJourneysSuccessful,
    releaseGatePassed: false,
    note: synthetic
      ? "Synthetic harness check only; timings are not application performance evidence."
      : config.fixtureApiUrl
        ? "Local TestHost fixture only; not a target-region performance or release result."
        : "Dataset claims are operator-supplied and remain unverified by this harness.",
    browser: {
      name: "Chromium",
      version: browser.version(),
      runtime: process.version,
    },
    host: {
      platform: process.platform,
      architecture: process.arch,
      logicalCpuCount: os.cpus().length,
      memoryGiB: round(os.totalmem() / 1024 ** 3),
    },
    region: config.region,
    sourceSnapshot: config.sourceSnapshot,
    dataset: config.dataset,
    runsPerMode: config.runs,
    allJourneysSuccessful,
    execution: {
      workers: 1,
      journeyOrder: ["ledger", "report"],
      concurrentJourneys: false,
      concurrentFrontendBrowserSuite: config.frontendBrowserSuiteActive,
      hostLoadControlled: false,
            awakeGuardUsed: config.hostAwakeGuard,
    },
    warmP99Assessment: assessment,
    cold: {
      definition:
        "Fresh browser context per page navigation; browser process and target app/server remain running and may be warm.",
      summaries: cold.summaries,
      rawSamples: cold.rawSamples,
      requestTimings: cold.requestTimings,
    },
    warm: {
      summaries: warm.summaries,
      rawSamples: warm.rawSamples,
      requestTimings: warm.requestTimings,
    },
  };
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--self-test") {
      result.selfTest = true;
      continue;
    }
    if (!key.startsWith("--") || index + 1 >= argv.length)
      throw new Error(`Unexpected argument: ${key}`);
    result[
      key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    ] = argv[++index];
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    const smoke = args.smoke === "true";
    const runs = Number(args.runs ?? (smoke ? 1 : 100));
    if (!Number.isInteger(runs) || (smoke ? runs !== 1 : runs < 100))
      throw new Error(
        smoke
          ? "Smoke mode requires exactly one run."
          : "--runs must be at least 100 for p99.",
      );
    const { browser, server, config } = await syntheticConfig(runs, smoke);
    try {
      const report = await executeMeasurement(browser, config, true);
      const output = args.output;
      const json = `${JSON.stringify(report, null, 2)}\n`;
      if (output)
        await (
          await import("node:fs/promises")
        ).writeFile(output, json, { flag: "wx", mode: 0o600 });
      else process.stdout.write(json);
      if (smoke && !report.smokeComplete) process.exitCode = 1;
    } finally {
      await browser.close();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    return;
  }
  const progressEvery = Number(args.progressEvery ?? 1);
  if (!Number.isInteger(progressEvery) || progressEvery < 1)
    throw new Error("--progress-every must be a positive integer.");
  let completedCount = 0;
  let progressFd = null;
  const config = validateMeasurementConfig({
    ledgerUrl: args.ledgerUrl,
    reportUrl: args.reportUrl,
    ledgerSelector: args.ledgerSelector,
    reportSelector: args.reportSelector,
    datasetDescription: args.datasetDescription,
    fixtureApiUrl: args.fixtureApiUrl,
    apiOrigin: args.apiOrigin,
    horses: args.horses,
    acceptedChanges: args.acceptedChanges,
    region: args.region,
    runs: args.runs,
    thresholdMs: args.thresholdMs,
    sourceSnapshotHash: args.sourceSnapshotHash,
    sourceSnapshotAtUtc: args.sourceSnapshotAtUtc,
    frontendBrowserSuiteActive: args.frontendBrowserSuiteActive,
    hostAwakeGuard: args.hostAwakeGuard,
    smoke: args.smoke,
    onProgress: (event) => {
      if (event.event === "journey-complete") completedCount += 1;
      if (shouldEmitProgress(event, completedCount, progressEvery))
        process.stderr.write(`${JSON.stringify(event)}\n`);
      if (progressFd !== null) {
        writeSync(progressFd, formatProgressRecord(event));
        if (
          [
            "fixture-bootstrap-complete",
            "journey-start",
            "journey-cleanup-complete",
            "journey-complete",
          ].includes(event.event)
        ) {
          fsyncSync(progressFd);
        }
      }
    },
  });
  const progressPath = args.progressLog ??
    (args.output ? `${args.output}.progress.ndjson` : null);
  try {
    if (progressPath) progressFd = openSync(progressPath, "wx", 0o600);
    const report = await runJourneyMeasurement(config);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (args.output)
      await (
        await import("node:fs/promises")
      ).writeFile(args.output, json, { flag: "wx", mode: 0o600 });
    else process.stdout.write(json);
    if (config.smoke && !report.smokeComplete) process.exitCode = 1;
  } finally {
    if (progressFd !== null) closeSync(progressFd);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
