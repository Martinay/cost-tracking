const expectedEventMix = {
  ExpenseRecorded: 1500,
  IncomeRecorded: 1500,
  RecurringExpenseOccurrenceOverridden: 500,
  RecurringIncomeApproved: 250,
  RecurringIncomeRejected: 250,
  TaskLogged: 1000,
};

export function fixtureMatchesScale(fixture) {
  if (
    !fixture ||
    fixture.horses !== 100 ||
    fixture.acceptedChanges !== 5000 ||
    !Number.isInteger(fixture.setupEvents) ||
    fixture.streamEvents !== fixture.setupEvents + 5000
  )
    return false;
  if (JSON.stringify(fixture.eventMix) !== JSON.stringify(expectedEventMix))
    return false;
  return (
    fixture.dateWindow?.from === "2026-09-01" &&
    fixture.dateWindow?.through === "2026-09-30" &&
    fixture.dateWindow?.asOfDate === "2026-09-21"
  );
}

export function endpointSampleIsValid(status, body, { streamEvents, journey }) {
  if (status !== 200 || body?.streamVersion !== streamEvents) return false;
  if (journey === "account")
    return body.currency === "EUR" && body.timeZone === "Europe/Berlin";
  if (!Array.isArray(body?.items)) return false;
  return (
    !new Set(["horses", "monthlyReport", "lifetimeReport"]).has(journey) ||
    body.items.length === 100
  );
}

export function assessEndpointThreshold(summary, thresholdMs = 2000) {
  if (summary?.samples < 100 || !Number.isFinite(summary?.p99Ms)) {
    return { measured: false, withinEndpointThreshold: null, thresholdMs };
  }
  return {
    measured: true,
    withinEndpointThreshold: summary.p99Ms <= thresholdMs,
    thresholdMs,
  };
}
