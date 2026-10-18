using CostTracking.Api.Storage;

namespace CostTracking.Api.Domain;

public sealed record FinancialBalance(Guid HorseId, long IncomeMinor, long ExpenseMinor, long NetMinor);
public sealed record MonthlyFinancialReport(string Currency, DateOnly From, DateOnly Through,
    IReadOnlyList<FinancialBalance> Items, long StreamVersion);
public sealed record LifetimeFinancialReport(string Currency, DateOnly AsOfDate,
    IReadOnlyList<FinancialBalance> Items, long StreamVersion);

public static class FinancialReports
{
    public static MonthlyFinancialReport Monthly(IReadOnlyList<EventEnvelope> events, string owner,
        DateOnly asOfDate, DateOnly from, DateOnly through)
    {
        ArgumentNullException.ThrowIfNull(events);
        if (through < from) throw new ArgumentException("The report end date cannot precede the start date.", nameof(through));
        var account = AccountProjection.Replay(owner, events);
        if (account.Currency is null) throw new InvalidOperationException("Account settings are required for financial reports.");
        var horses = HorseProjection.Replay(events);
        var totals = Initialize(horses);
        foreach (var item in ExpenseProjection.Replay(events).Where(item => item.ExpenseDate >= from && item.ExpenseDate <= through))
            Add(totals, item.Allocations, expense: true);
        foreach (var item in IncomeProjection.Replay(events).Where(item => item.ReceivedDate >= from && item.ReceivedDate <= through))
            Add(totals, item.Allocations, expense: false);
        AddRecurringExpenses(totals, events, from, through);
        return new MonthlyFinancialReport(account.Currency, from, through, Freeze(totals), account.StreamVersion);
    }

    public static LifetimeFinancialReport Lifetime(IReadOnlyList<EventEnvelope> events, string owner,
        DateOnly asOfDate)
    {
        ArgumentNullException.ThrowIfNull(events);
        var account = AccountProjection.Replay(owner, events);
        if (account.Currency is null) throw new InvalidOperationException("Account settings are required for financial reports.");
        var totals = Initialize(HorseProjection.Replay(events));
        foreach (var item in ExpenseProjection.Replay(events).Where(item => item.ExpenseDate <= asOfDate))
            Add(totals, item.Allocations, expense: true);
        foreach (var item in IncomeProjection.Replay(events).Where(item => item.ReceivedDate <= asOfDate))
            Add(totals, item.Allocations, expense: false);
        var recurrence = RecurringExpenseProjection.Read(events);
        if (recurrence.Rules.Count > 0)
        {
            var cursor = recurrence.Rules.Values.Min(rule => rule.StartDate);
            while (cursor <= asOfDate)
            {
                var through = Min(asOfDate, cursor.AddYears(5).AddDays(-1));
                AddOccurrences(totals, ExpenseOccurrences.Expand(recurrence.Rules.Values.ToArray(),
                    recurrence.Overrides, cursor, through));
                if (through == asOfDate) break;
                cursor = through.AddDays(1);
            }
        }
        return new LifetimeFinancialReport(account.Currency, asOfDate, Freeze(totals), account.StreamVersion);
    }

    private static Dictionary<Guid, (long Income, long Expense)> Initialize(IEnumerable<Horse> horses) =>
        horses.ToDictionary(horse => horse.HorseId, _ => (0L, 0L));

    private static void Add(Dictionary<Guid, (long Income, long Expense)> totals,
        IReadOnlyList<Allocation> allocations, bool expense)
    {
        foreach (var allocation in allocations)
        {
            if (!totals.TryGetValue(allocation.HorseId, out var current))
                throw new InvalidDataException("Financial allocation references an unregistered horse.");
            totals[allocation.HorseId] = expense
                ? (current.Income, FinancialValues.SumSafe([current.Expense, allocation.AmountMinor]))
                : (FinancialValues.SumSafe([current.Income, allocation.AmountMinor]), current.Expense);
        }
    }

    private static void AddRecurringExpenses(Dictionary<Guid, (long Income, long Expense)> totals,
        IReadOnlyList<EventEnvelope> events, DateOnly from, DateOnly through)
    {
        var recurrence = RecurringExpenseProjection.Read(events);
        if (recurrence.Rules.Count == 0) return;
        AddOccurrences(totals, ExpenseOccurrences.Expand(recurrence.Rules.Values.ToArray(), recurrence.Overrides, from, through));
    }

    private static void AddOccurrences(Dictionary<Guid, (long Income, long Expense)> totals,
        IEnumerable<ExpenseOccurrence> occurrences)
    {
        foreach (var item in occurrences.Where(item => !item.Skipped))
            Add(totals, item.Allocations, expense: true);
    }

    private static DateOnly Min(DateOnly first, DateOnly second) => first < second ? first : second;

    private static IReadOnlyList<FinancialBalance> Freeze(Dictionary<Guid, (long Income, long Expense)> totals) =>
        totals.OrderBy(item => item.Key.ToString("D").ToLowerInvariant(), StringComparer.Ordinal)
            .Select(item => new FinancialBalance(item.Key, item.Value.Income, item.Value.Expense,
                FinancialValues.SumSafe([item.Value.Income, -item.Value.Expense]))).ToArray();
}
