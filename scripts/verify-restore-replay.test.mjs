import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeFinancialReport,
  summarizePendingApprovals,
  assertRestoredFinancialReport,
  assertNoRepairedLedgerStream,
  assertProjectionParity,
  assessBackupAge,
} from "./verify-restore-replay.mjs";

const report = (streamVersion = 5176) => ({
  currency: "EUR",
  month: "2026-09",
  streamVersion,
  items: [
    {
      horseId: "synthetic-1",
      incomeMinor: 1200,
      expenseMinor: 800,
      netMinor: 400,
    },
    {
      horseId: "synthetic-2",
      incomeMinor: 300,
      expenseMinor: 100,
      netMinor: 200,
    },
  ],
});

test("financial replay summary compares aggregate projections without retaining horse IDs", () => {
  const value = summarizeFinancialReport(report());
  assert.deepEqual(value, {
    currency: "EUR",
    month: "2026-09",
    streamVersion: 5176,
    horseRows: 2,
    incomeMinor: 1500,
    expenseMinor: 900,
    netMinor: 600,
  });
  assert.equal(JSON.stringify(value).includes("synthetic-1"), false);
});

test("pending approval summary is order independent and retains only count and a key digest", () => {
  const first = summarizePendingApprovals([
    { ruleId: "rule-b", scheduledDate: "2026-09-02" },
    { ruleId: "rule-a", scheduledDate: "2026-09-01" },
  ]);
  const second = summarizePendingApprovals([
    { ruleId: "rule-a", scheduledDate: "2026-09-01" },
    { ruleId: "rule-b", scheduledDate: "2026-09-02" },
  ]);
  assert.equal(first.count, 2);
  assert.equal(first.keyDigestSha256, second.keyDigestSha256);
  assert.equal(JSON.stringify(first).includes("rule-a"), false);
});

test("projection parity fails on totals, version, or pending-key changes", () => {
  const baseline = {
    report: summarizeFinancialReport(report()),
    pending: summarizePendingApprovals([
      { ruleId: "rule-a", scheduledDate: "2026-09-01" },
    ]),
  };
  assert.doesNotThrow(() => assertProjectionParity(baseline, baseline));
  assert.throws(
    () =>
      assertProjectionParity(baseline, {
        ...baseline,
        report: summarizeFinancialReport(report(5175)),
      }),
    /projection mismatch/i,
  );
  assert.throws(
    () =>
      assertProjectionParity(baseline, {
        ...baseline,
        pending: summarizePendingApprovals([
          { ruleId: "rule-b", scheduledDate: "2026-09-01" },
        ]),
      }),
    /projection mismatch/i,
  );
});

test("restored financial reads fail on an empty or partial stream rather than masking it", () => {
  const fixture = { streamEvents: 5176, horses: 100 };
  assert.throws(
    () =>
      assertRestoredFinancialReport(
        {
          currency: "EUR",
          month: "2026-09",
          streamVersion: 0,
          items: [],
        },
        fixture,
      ),
    /does not match/i,
  );
  assert.throws(
    () =>
      assertRestoredFinancialReport(
        {
          currency: "EUR",
          month: "2026-09",
          streamVersion: 5176,
          items: [
            { horseId: "x", incomeMinor: 1, expenseMinor: 0, netMinor: 1 },
          ],
        },
        fixture,
      ),
    /does not match/i,
  );
});

test("empty-read stream initialization is not accepted as restored event data", () => {
  assert.deepEqual(assertNoRepairedLedgerStream(null), {
    streamFileInitializedByRead: false,
    eventBytes: 0,
  });
  assert.deepEqual(assertNoRepairedLedgerStream(Buffer.alloc(0)), {
    streamFileInitializedByRead: true,
    eventBytes: 0,
  });
  assert.throws(
    () => assertNoRepairedLedgerStream(Buffer.from('{"streamVersion":1}\n')),
    /event data/i,
  );
});

test("backup age calculation marks only the observed snapshot age, not a scheduled RPO guarantee", () => {
  const result = assessBackupAge(
    "2026-10-09T10:00:00Z",
    "2026-10-09T11:30:00Z",
  );
  assert.deepEqual(result, {
    targetSeconds: 86400,
    snapshotAgeSeconds: 5400,
    snapshotWithin24HourBoundAtRestore: true,
    scheduledRpoProven: false,
  });
  assert.throws(
    () => assessBackupAge("2026-10-09T12:00:00Z", "2026-10-09T11:30:00Z"),
    /after restore/i,
  );
});
