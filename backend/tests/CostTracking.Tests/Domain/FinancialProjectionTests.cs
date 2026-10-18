using System.Text.Json;
using CostTracking.Api.Domain;
using CostTracking.Api.Storage;

namespace CostTracking.Tests.Domain;

public sealed class FinancialProjectionTests
{
    private const string Owner = "user_Alice";
    private static readonly Guid First = Guid.Parse("00000001-0000-4000-8000-000000000001");
    private static readonly Guid Second = Guid.Parse("00000002-0000-4000-8000-000000000001");

    [Fact]
    public void Monthly_totals_reconcile_allocated_income_and_expenses_and_keep_inactive_horses()
    {
        var events = Stream();

        var report = FinancialReports.Monthly(events, Owner, D(2026, 9, 21), D(2026, 9, 1), D(2026, 9, 30));

        Assert.Equal("EUR", report.Currency);
        Assert.Equal(6, report.StreamVersion);
        Assert.Equal([(First, 1100L, 501L, 599L), (Second, 1000L, 500L, 500L)],
            report.Items.Select(item => (item.HorseId, item.IncomeMinor, item.ExpenseMinor, item.NetMinor)));
    }

    [Fact]
    public void Lifetime_totals_include_sold_horses_and_exclude_future_one_time_income()
    {
        var events = Stream();

        var report = FinancialReports.Lifetime(events, Owner, D(2026, 9, 21));

        Assert.Equal([(First, 1000L, 501L, 499L), (Second, 1000L, 500L, 500L)],
            report.Items.Select(item => (item.HorseId, item.IncomeMinor, item.ExpenseMinor, item.NetMinor)));
    }

    [Fact]
    public void Recurring_occurrences_and_overrides_contribute_to_monthly_and_lifetime_totals()
    {
        var events = Stream().ToList();
        var ruleId = Guid.Parse("00000006-0000-4000-8000-000000000001");
        events.Add(Envelope(7, "RecurringExpenseRuleCreated", new
        {
            ruleId, effectiveFrom = D(2026, 9, 21),
            schedule = new { cadence = "Daily", interval = 1, weekdays = Array.Empty<int>(), dayOfMonth = (int?)null, startDate = D(2026, 9, 21), endDate = (DateOnly?)D(2026, 9, 23) },
            defaults = new { amountMinor = 100, category = "Feed", description = "Hay", splitMode = "Equal", allocations = new[] { new { horseId = First, weight = 1_000_000, amountMinor = 100 } } }
        }));
        events.Add(Envelope(8, "RecurringExpenseOccurrenceOverridden", new { ruleId, scheduledDate = D(2026, 9, 22), action = "Skipped", changed = (object?)null }));

        var monthly = FinancialReports.Monthly(events, Owner, D(2026, 9, 23), D(2026, 9, 1), D(2026, 9, 30));
        var lifetime = FinancialReports.Lifetime(events, Owner, D(2026, 9, 22));

        Assert.Equal(701, monthly.Items.Single(item => item.HorseId == First).ExpenseMinor);
        Assert.Equal(500, monthly.Items.Single(item => item.HorseId == Second).ExpenseMinor);
        Assert.Equal(601, lifetime.Items.Single(item => item.HorseId == First).ExpenseMinor);
    }

    private static IReadOnlyList<EventEnvelope> Stream()
    {
        var serializer = new EventSerializer();
        var values = new[]
        {
            ("AccountConfigured", "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}"),
            ("HorseRegistered", $"{{\"horseId\":\"{First:D}\",\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}}"),
            ("HorseRegistered", $"{{\"horseId\":\"{Second:D}\",\"name\":\"Storm\",\"breed\":\"Warmblood\",\"dateOfBirth\":null,\"status\":\"Sold\"}}"),
            ("ExpenseRecorded", $"{{\"expenseId\":\"00000003-0000-4000-8000-000000000001\",\"expenseDate\":\"2026-09-21\",\"amountMinor\":1001,\"category\":\"Feed\",\"description\":\"Hay\",\"allocations\":[{{\"horseId\":\"{First:D}\",\"weight\":500000,\"amountMinor\":501}},{{\"horseId\":\"{Second:D}\",\"weight\":500000,\"amountMinor\":500}}],\"driving\":null,\"splitMode\":\"Equal\"}}"),
            ("IncomeRecorded", $"{{\"incomeId\":\"00000004-0000-4000-8000-000000000001\",\"receivedDate\":\"2026-09-21\",\"amountMinor\":2000,\"source\":\"Lessons\",\"allocations\":[{{\"horseId\":\"{First:D}\",\"weight\":500000,\"amountMinor\":1000}},{{\"horseId\":\"{Second:D}\",\"weight\":500000,\"amountMinor\":1000}}],\"splitMode\":\"Equal\"}}"),
            ("IncomeRecorded", $"{{\"incomeId\":\"00000005-0000-4000-8000-000000000001\",\"receivedDate\":\"2026-09-22\",\"amountMinor\":100,\"source\":\"Future\",\"allocations\":[{{\"horseId\":\"{First:D}\",\"weight\":1000000,\"amountMinor\":100}}],\"splitMode\":\"Equal\"}}")
        };
        return values.Select((item, index) =>
        {
            using var payload = JsonDocument.Parse(item.Item2);
            return new EventEnvelope(Guid.Parse($"0000000{index + 1}-0000-4000-8000-000000000001"), index + 1,
                1, item.Item1, Owner, new DateTimeOffset(2026, 9, 21, 12, 0, index, TimeSpan.Zero), Guid.NewGuid(),
                new string('a', 64), payload.RootElement.Clone());
        }).ToArray().Select(value => { _ = serializer.Serialize(value); return value; }).ToArray();
    }

    private static EventEnvelope Envelope(long version, string type, object payloadValue)
    {
        var value = new EventEnvelope(Guid.NewGuid(), version, 1, type, Owner,
            new DateTimeOffset(2026, 9, 21, 12, 0, (int)version, TimeSpan.Zero), Guid.NewGuid(), new string('a', 64), JsonSerializer.SerializeToElement(payloadValue));
        _ = new EventSerializer().Serialize(value);
        return value;
    }

    private static DateOnly D(int year, int month, int day) => new(year, month, day);
}
