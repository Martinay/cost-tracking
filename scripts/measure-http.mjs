#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import os from "node:os";
import { performance } from "node:perf_hooks";
import process from "node:process";
import {
  assessEndpointThreshold,
  endpointSampleIsValid,
  fixtureMatchesScale,
} from "./measure-http-contract.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.ceil(p * sorted.length) - 1];
  const summary = {
    samples: values.length,
    minMs: round(sorted[0]),
    medianMs: round(percentile(0.5)),
    maxMs: round(sorted.at(-1)),
  };
  if (values.length >= 100) summary.p99Ms = round(percentile(0.99));
  return summary;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

const apiOrigin = argument("api-origin", "");
const runs = Number(argument("runs", "100"));
const diagnosticRuns = Number(argument("diagnostic-runs", "20"));
const output = argument("output", "");
const hostAwakeGuard = argument("host-awake-guard", "false") === "true";
if (
  !apiOrigin ||
  !Number.isInteger(runs) ||
  runs < 100 ||
  !Number.isInteger(diagnosticRuns) ||
  diagnosticRuns < 1 ||
  !output
) {
  throw new Error(
    "Usage: measure-http.mjs --api-origin http://127.0.0.1:51941 --runs 100 --diagnostic-runs 20 --output validation/performance-http-local-YYYYMMDD.json [--host-awake-guard true]",
  );
}
if (existsSync(output))
  throw new Error("Refusing to overwrite an existing measurement artifact.");
mkdirSync(dirname(output), { recursive: true });
const progressPath = `${output}.progress.ndjson`;
if (existsSync(progressPath))
  throw new Error("Refusing to overwrite an existing progress journal.");
const origin = new URL(apiOrigin);
if (
  origin.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
) {
  throw new Error("api-origin must be an HTTP loopback origin.");
}

async function request(path, options = {}) {
  const response = await fetch(new URL(path, origin), options);
  return { response, body: await response.json().catch(() => null) };
}

const appOrigin = origin.origin;
const sessionResponse = await fetch(new URL("/__fixture/session", origin), {
  method: "POST",
  headers: { Origin: appOrigin, "Content-Type": "application/json" },
  body: JSON.stringify({ subject: "user_Fixture" }),
});
if (!sessionResponse.ok)
  throw new Error(`Fixture session returned HTTP ${sessionResponse.status}.`);
const cookie = sessionResponse.headers.getSetCookie?.()[0]?.split(";")[0];
if (!cookie) throw new Error("Fixture session did not issue a session cookie.");
const session = await fetch(new URL("/auth/session", origin), {
  headers: { Cookie: cookie },
});
if (!session.ok)
  throw new Error(`Fixture auth session returned HTTP ${session.status}.`);
const sessionBody = await session.json();
if (typeof sessionBody.accessToken !== "string" || !sessionBody.accessToken)
  throw new Error("Fixture auth session returned no access token.");
const headers = { Authorization: `Bearer ${sessionBody.accessToken}` };

const scale = await request("/__fixture/scale", {
  method: "POST",
  headers: { Origin: appOrigin, "Content-Type": "application/json" },
  body: "{}",
});
if (!scale.response.ok || !fixtureMatchesScale(scale.body)) {
  throw new Error("Synthetic scale fixture failed integrity checks.");
}

const paths = {
  account: "/api/v1/account",
  horses: "/api/v1/horses?limit=100",
  income: "/api/v1/income?from=2026-09-01&to=2026-09-21&limit=100",
  incomeRules: "/api/v1/income-rules?limit=100",
  monthlyReport: "/api/v1/reports/monthly-pnl?month=2026-09",
  lifetimeReport: "/api/v1/reports/lifetime?limit=100",
  activityReport: "/api/v1/reports/activity?from=2026-09-01&to=2026-09-21",
  expenseBreakdown:
    "/api/v1/reports/breakdown?from=2026-09-01&to=2026-09-21&kind=expense",
};
const before = { loadAverage: os.loadavg(), freeMemoryBytes: os.freemem() };
const results = {};
const p99Journeys = new Set(["account", "monthlyReport", "lifetimeReport"]);
for (const [journey, path] of Object.entries(paths)) {
  const endpointRuns = p99Journeys.has(journey) ? runs : diagnosticRuns;
  const timings = [];
  for (let index = 0; index < endpointRuns; index += 1) {
    const started = performance.now();
    const { response, body } = await request(path, { headers });
    const durationMs = round(performance.now() - started);
    const valid = endpointSampleIsValid(response.status, body, {
      streamEvents: scale.body.streamEvents,
      journey,
    });
    timings.push({
      index: index + 1,
      durationMs,
      httpStatus: response.status,
      integrityCheck: valid ? "passed" : "failed",
    });
    if (!valid)
      throw new Error(
        `${journey} sample ${index + 1} failed status or fixture integrity checks.`,
      );
    if ((index + 1) % 25 === 0 || index + 1 === endpointRuns) {
      appendFileSync(
        progressPath,
        `${JSON.stringify({ timestampUtc: new Date().toISOString(), event: "endpoint-batch-complete", endpoint: journey, completed: index + 1, runs: endpointRuns, status: "passed" })}\n`,
        { mode: 0o600 },
      );
      process.stderr.write(
        `${journey}: ${index + 1}/${endpointRuns} successful\n`,
      );
    }
  }
  const summary = summarize(timings.map((sample) => sample.durationMs));
  results[journey] = {
    summary,
    endpointThresholdAssessment: assessEndpointThreshold(summary),
    rawSamples: timings,
  };
}
const after = { loadAverage: os.loadavg(), freeMemoryBytes: os.freemem() };
const record = {
  schemaVersion: 1,
  recordedAtUtc: new Date().toISOString(),
  mode: "local-test-host-direct-http",
  gateEligible: false,
  releaseGatePassed: false,
  note: "Local TestHost direct HTTP request timings; no browser, frontend, Azure Files, or target-region claim.",
  host: {
    platform: process.platform,
    architecture: process.arch,
    logicalCpuCount: os.cpus().length,
    totalMemoryGiB: round(os.totalmem() / 1024 ** 3),
    hostAwakeGuardUsed: hostAwakeGuard,
    hostLoadControlled: false,
    before,
    after,
  },
  dataset: {
    verified: true,
    horses: scale.body.horses,
    acceptedChanges: scale.body.acceptedChanges,
    setupEvents: scale.body.setupEvents,
    streamEvents: scale.body.streamEvents,
    eventMix: scale.body.eventMix,
    dateWindow: scale.body.dateWindow,
  },
  runsByEndpoint: Object.fromEntries(
    Object.keys(paths).map((key) => [
      key,
      p99Journeys.has(key) ? runs : diagnosticRuns,
    ]),
  ),
  endpoints: results,
};
writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(
  `${JSON.stringify({ output, runsPerEndpoint: runs, summaries: Object.fromEntries(Object.entries(results).map(([key, value]) => [key, value.summary])), hostLoadControlled: false })}\n`,
);
