import test from "node:test";
import assert from "node:assert/strict";
import {
  assessEndpointThreshold,
  endpointSampleIsValid,
  fixtureMatchesScale,
} from "./measure-http-contract.mjs";

const fixture = {
  horses: 100,
  acceptedChanges: 5000,
  setupEvents: 176,
  streamEvents: 5176,
  eventMix: {
    ExpenseRecorded: 1500,
    IncomeRecorded: 1500,
    RecurringExpenseOccurrenceOverridden: 500,
    RecurringIncomeApproved: 250,
    RecurringIncomeRejected: 250,
    TaskLogged: 1000,
  },
  dateWindow: {
    from: "2026-09-01",
    through: "2026-09-30",
    asOfDate: "2026-09-21",
  },
};

test("scale fixture requires the exact event counts, mix and report dates", () => {
  assert.equal(fixtureMatchesScale(fixture), true);
  assert.equal(
    fixtureMatchesScale({ ...fixture, acceptedChanges: 4999 }),
    false,
  );
  assert.equal(
    fixtureMatchesScale({ ...fixture, eventMix: { ExpenseRecorded: 5000 } }),
    false,
  );
  assert.equal(
    fixtureMatchesScale({
      ...fixture,
      dateWindow: { ...fixture.dateWindow, asOfDate: "2026-10-21" },
    }),
    false,
  );
});

test("endpoint sample rejects HTTP errors, version drift and incorrect item counts", () => {
  const expected = { streamEvents: 5176, journey: "monthlyReport" };
  const body = { streamVersion: 5176, items: Array.from({ length: 100 }) };
  assert.equal(endpointSampleIsValid(200, body, expected), true);
  assert.equal(endpointSampleIsValid(503, body, expected), false);
  assert.equal(
    endpointSampleIsValid(200, { ...body, streamVersion: 5175 }, expected),
    false,
  );
  assert.equal(
    endpointSampleIsValid(
      200,
      { ...body, items: body.items.slice(0, 99) },
      expected,
    ),
    false,
  );
});

test("two-second endpoint diagnostic requires 100 samples and fails above threshold", () => {
  assert.deepEqual(assessEndpointThreshold({ samples: 100, p99Ms: 2000 }), {
    measured: true,
    withinEndpointThreshold: true,
    thresholdMs: 2000,
  });
  assert.equal(
    assessEndpointThreshold({ samples: 100, p99Ms: 2000.01 })
      .withinEndpointThreshold,
    false,
  );
  assert.deepEqual(assessEndpointThreshold({ samples: 20 }), {
    measured: false,
    withinEndpointThreshold: null,
    thresholdMs: 2000,
  });
});
