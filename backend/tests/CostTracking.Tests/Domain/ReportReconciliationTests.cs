using System.Text.Json;
using CostTracking.Api.Domain;
using CostTracking.Api.Storage;

namespace CostTracking.Tests.Domain;

public sealed class ReportReconciliationTests
{
    private const string Owner = "user_ReportOwner";
    private static readonly Guid ActiveHorse = Guid.Parse("10000001-0000-4000-8000-000000000001");
    private static readonly Guid SoldHorse = Guid.Parse("10000002-0000-4000-8000-000000000001");
    private static readonly Guid ExpenseRule = Guid.Parse("20000001-0000-4000-8000-000000000001");
    private static readonly Guid IncomeRule = Guid.Parse("20000002-0000-4000-8000-000000000001");

    [Fact]
    public void Monthly_and_lifetime_reconcile_allocations_with_skips_approved_income_and_inactive_horses()
    {
        var events = MixedStream();

        var monthly = FinancialReports.Monthly(events, Owner, D(2026, 9, 21), D(2026, 9, 1), D(2026, 9, 30));
        var lifetime = FinancialReports.Lifetime(events, Owner, D(2026, 9, 21));

        Assert.Equal("EUR", monthly.Currency);
        Assert.Equal([(ActiveHorse, 1_600L, 1_501L, 99L), (SoldHorse, 1_600L, 1_500L, 100L)],
            monthly.Items.Select(item => (item.HorseId, item.IncomeMinor, item.ExpenseMinor, item.NetMinor)));
        Assert.Equal(monthly.Items, lifetime.Items);
        var realized = IncomeProjection.Replay(events);
        Assert.Equal(2, realized.Count); // One-time + approved; pending and rejected dates do not become ledger rows.
        Assert.DoesNotContain(realized, item => item.Id == $"income-rule/{IncomeRule:D}/2026-09-20");
    }

    [Fact]
    public void Report_accumulation_rejects_totals_outside_the_safe_integer_range()
    {
        var events = new List<EventEnvelope>
        {
            Event(1, "AccountConfigured", new { currency = "EUR", timeZone = "Europe/Berlin" }),
            Event(2, "HorseRegistered", new { horseId = ActiveHorse, name = "Misty", breed = "Arabian", dateOfBirth = (DateOnly?)null, status = "Active" }),
            ExpenseEvent(3, 9_007_199_254_740_991L, ActiveHorse),
            ExpenseEvent(4, 1, ActiveHorse)
        };

        Assert.Throws<OverflowException>(() => FinancialReports.Monthly(events, Owner, D(2026, 9, 21), D(2026, 9, 1), D(2026, 9, 30)));
    }

    private static IReadOnlyList<EventEnvelope> MixedStream()
    {
        var equalExpense = new[] { new { horseId = ActiveHorse, weight = 500_000, amountMinor = 501L }, new { horseId = SoldHorse, weight = 500_000, amountMinor = 500L } };
        var equal1000 = new[] { new { horseId = ActiveHorse, weight = 500_000, amountMinor = 500L }, new { horseId = SoldHorse, weight = 500_000, amountMinor = 500L } };
        var equal2000 = new[] { new { horseId = ActiveHorse, weight = 500_000, amountMinor = 1_000L }, new { horseId = SoldHorse, weight = 500_000, amountMinor = 1_000L } };
        var equal1200 = new[] { new { horseId = ActiveHorse, weight = 500_000, amountMinor = 600L }, new { horseId = SoldHorse, weight = 500_000, amountMinor = 600L } };
        var schedule = Daily(D(2026, 9, 19), D(2026, 9, 21));
        var changed = new { amountMinor = 2_000L, category = "Feed", description = "Hay changed", splitMode = "Equal", allocations = new[] { new { horseId = ActiveHorse, weight = 500_000, amountMinor = 1_000L }, new { horseId = SoldHorse, weight = 500_000, amountMinor = 1_000L } } };

        return
        [
            Event(1, "AccountConfigured", new { currency = "EUR", timeZone = "Europe/Berlin" }),
            Event(2, "HorseRegistered", new { horseId = ActiveHorse, name = "Misty", breed = "Arabian", dateOfBirth = (DateOnly?)null, status = "Active" }),
            Event(3, "HorseRegistered", new { horseId = SoldHorse, name = "Storm", breed = "Warmblood", dateOfBirth = (DateOnly?)null, status = "Sold" }),
            Event(4, "ExpenseRecorded", new { expenseId = Guid.Parse("30000001-0000-4000-8000-000000000001"), expenseDate = D(2026, 9, 19), amountMinor = 1_001L, category = "Farrier", description = "Trim", allocations = equalExpense, driving = (object?)null, splitMode = "Equal" }),
            Event(5, "IncomeRecorded", new { incomeId = Guid.Parse("30000002-0000-4000-8000-000000000001"), receivedDate = D(2026, 9, 19), amountMinor = 2_000L, source = "Lessons", allocations = equal2000, splitMode = "Equal" }),
            Event(6, "RecurringExpenseRuleCreated", new { ruleId = ExpenseRule, effectiveFrom = D(2026, 9, 19), schedule, defaults = new { amountMinor = 1_000L, category = "Feed", description = "Hay", splitMode = "Equal", allocations = equal1000 } }),
            Event(7, "RecurringExpenseOccurrenceOverridden", new { ruleId = ExpenseRule, scheduledDate = D(2026, 9, 20), action = "Changed", changed }),
            Event(8, "RecurringExpenseOccurrenceOverridden", new { ruleId = ExpenseRule, scheduledDate = D(2026, 9, 20), action = "Skipped", changed = (object?)null }),
            Event(9, "RecurringIncomeRuleCreated", new { ruleId = IncomeRule, effectiveFrom = D(2026, 9, 19), schedule, defaults = new { amountMinor = 1_000L, source = "Lessons", splitMode = "Equal", allocations = equal1000 } }),
            Event(10, "RecurringIncomeApproved", new { ruleId = IncomeRule, scheduledDate = D(2026, 9, 19), receivedDate = D(2026, 9, 20), amountMinor = 1_200L, allocations = equal1200, nextDueDate = D(2026, 9, 20), splitMode = "Equal" }),
            Event(11, "RecurringIncomeRejected", new { ruleId = IncomeRule, scheduledDate = D(2026, 9, 20), nextDueDate = D(2026, 9, 21) }),
            Event(12, "TaskLogged", new { taskId = Guid.Parse("30000003-0000-4000-8000-000000000001"), horseId = ActiveHorse, taskDate = D(2026, 9, 20), taskType = "Grooming", minutes = 0L, quantity = 1.5m, quantityUnit = "hours", notes = "Quantity only" })
        ];
    }

    private static EventEnvelope ExpenseEvent(long version, long amount, Guid horseId) => Event(version,
        "ExpenseRecorded", new { expenseId = Guid.NewGuid(), expenseDate = D(2026, 9, 19), amountMinor = amount,
            category = "Feed", description = "Large total", allocations = new[] { new { horseId, weight = 1_000_000, amountMinor = amount } }, driving = (object?)null, splitMode = "Equal" });

    private static EventEnvelope Event(long version, string type, object payload)
    {
        var envelope = new EventEnvelope(Guid.Parse($"40000000-0000-4000-8000-{version:D12}"), version, 1, type, Owner,
            new DateTimeOffset(2026, 9, 21, 12, 0, (int)version, TimeSpan.Zero),
            Guid.Parse($"50000000-0000-4000-8000-{version:D12}"), new string('a', 64), JsonSerializer.SerializeToElement(payload));
        try { _ = new EventSerializer().Serialize(envelope); }
        catch (InvalidDataException exception) { throw new InvalidDataException($"Fixture event {type} is invalid.", exception); }
        return envelope;
    }

    private static object Daily(DateOnly start, DateOnly? end) => new
    {
        cadence = "Daily", interval = 1, weekdays = Array.Empty<int>(), dayOfMonth = (int?)null,
        startDate = start, endDate = end
    };

    private static DateOnly D(int year, int month, int day) => new(year, month, day);
}
