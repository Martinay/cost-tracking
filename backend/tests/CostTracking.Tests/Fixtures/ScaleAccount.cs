using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CostTracking.Api.Domain;

namespace CostTracking.Tests.Fixtures;

/// <summary>Deterministic, synthetic account history for local replay and UI scale validation.</summary>
public static class ScaleAccount
{
    public const string Subject = "user_Fixture";
    public const int HorseCount = 100;
    public const int AcceptedChangeCount = 5_000;
    public static readonly DateOnly WindowFrom = new(2026, 9, 1);
    public static readonly DateOnly WindowThrough = new(2026, 9, 30);
    public static readonly DateOnly AsOfDate = new(2026, 9, 21);

    public static IReadOnlyList<EventEnvelope> Create(string subject = Subject)
    {
        var events = new List<EventEnvelope>(5_176);
        var horses = Enumerable.Range(1, HorseCount)
            .Select(index => Identifier(100_000 + index)).ToArray();
        var expenseRules = Enumerable.Range(0, 25).Select(index => Identifier(500_000 + index)).ToArray();
        var incomeRules = Enumerable.Range(0, 50).Select(index => Identifier(600_000 + index)).ToArray();
        var version = 0;

        Add("AccountConfigured", new { currency = "EUR", timeZone = "Europe/Berlin" });
        for (var index = 0; index < horses.Length; index++)
        {
            Add("HorseRegistered", new
            {
                horseId = horses[index],
                name = $"Scale horse {index + 1:D3}",
                breed = "Synthetic",
                dateOfBirth = (string?)null,
                status = "Active"
            });
        }

        for (var index = 0; index < expenseRules.Length; index++)
        {
            var horseId = horses[index];
            Add("RecurringExpenseRuleCreated", new
            {
                ruleId = expenseRules[index],
                effectiveFrom = WindowFrom,
                schedule = DailySchedule(WindowFrom),
                defaults = new
                {
                    amountMinor = 100,
                    category = "Feed",
                    description = "Synthetic daily feed",
                    allocations = OneHorseAllocation(horseId, 100),
                    splitMode = "Equal"
                }
            });
        }

        for (var index = 0; index < incomeRules.Length; index++)
        {
            var horseId = horses[(index + 25) % horses.Length];
            Add("RecurringIncomeRuleCreated", new
            {
                ruleId = incomeRules[index],
                effectiveFrom = WindowFrom,
                schedule = DailySchedule(WindowFrom),
                defaults = new
                {
                    amountMinor = 125,
                    source = "Synthetic lessons",
                    allocations = OneHorseAllocation(horseId, 125),
                    splitMode = "Equal"
                }
            });
        }

        // Realized expense history: 1,000 ordinary purchases and 500 driving expenses
        // whose persisted provenance reconciles exactly to the expense amount.
        for (var index = 0; index < 1_500; index++)
        {
            var horseId = horses[index % horses.Length];
            var driving = index >= 1_000;
            var amount = driving ? 1_000L : 100L;
            Add("ExpenseRecorded", new
            {
                expenseId = Identifier(700_000 + index),
                expenseDate = Day(index),
                amountMinor = amount,
                category = driving ? "Driving" : (index % 2 == 0 ? "Feed" : "Veterinary"),
                description = driving ? "Synthetic clinic journey" : "Synthetic monthly purchase",
                allocations = OneHorseAllocation(horseId, amount),
                driving = driving ? new { kilometers = 10m, rateMinorPerKm = 100m } : null,
                splitMode = "Equal"
            });
        }

        // One-time realized income ensures the monthly report exercises both sides
        // of its reconciliation, in addition to recurring approvals below.
        for (var index = 0; index < 1_500; index++)
        {
            var horseId = horses[(index + 7) % horses.Length];
            Add("IncomeRecorded", new
            {
                incomeId = Identifier(800_000 + index),
                receivedDate = Day(index),
                amountMinor = 250,
                source = index % 2 == 0 ? "Synthetic lessons" : "Synthetic boarding",
                allocations = OneHorseAllocation(horseId, 250),
                splitMode = "Equal"
            });
        }

        for (var index = 0; index < 1_000; index++)
        {
            var horseId = horses[index % horses.Length];
            var quantityOnly = index % 4 == 0;
            Add("TaskLogged", new
            {
                taskId = Identifier(900_000 + index),
                horseId,
                taskDate = Day(index),
                taskType = ((TaskType)(index % Enum.GetValues<TaskType>().Length)).ToString(),
                minutes = quantityOnly ? 0 : 30 + index % 90,
                quantity = quantityOnly ? 1.0m + index % 5 : (decimal?)null,
                quantityUnit = quantityOnly ? "feed portions" : null,
                notes = "Synthetic activity"
            });
        }

        for (var ruleIndex = 0; ruleIndex < expenseRules.Length; ruleIndex++)
        for (var day = 1; day <= 20; day++)
        {
            var horseId = horses[ruleIndex];
            Add("RecurringExpenseOccurrenceOverridden", new
            {
                ruleId = expenseRules[ruleIndex],
                scheduledDate = new DateOnly(2026, 9, day),
                action = "Changed",
                changed = new
                {
                    amountMinor = 125L + day,
                    category = "Feed",
                    description = "Synthetic adjusted feed",
                    allocations = OneHorseAllocation(horseId, 125L + day),
                    splitMode = "Equal"
                }
            });
        }

        for (var ruleIndex = 0; ruleIndex < incomeRules.Length; ruleIndex++)
        for (var day = 1; day <= 10; day++)
        {
            var ruleHorseId = horses[(ruleIndex + 25) % horses.Length];
            var scheduledDate = new DateOnly(2026, 9, day);
            var nextDueDate = scheduledDate.AddDays(1);
            if (day % 2 == 1)
            {
                Add("RecurringIncomeApproved", new
                {
                    ruleId = incomeRules[ruleIndex],
                    scheduledDate,
                    receivedDate = scheduledDate,
                    amountMinor = 125,
                    allocations = OneHorseAllocation(ruleHorseId, 125),
                    nextDueDate,
                    splitMode = "Equal"
                });
            }
            else
            {
                Add("RecurringIncomeRejected", new
                {
                    ruleId = incomeRules[ruleIndex],
                    scheduledDate,
                    nextDueDate
                });
            }
        }

        if (version != events.Capacity)
            throw new InvalidOperationException("Synthetic scale account event count does not match its manifest.");
        return events;

        void Add<T>(string type, T payload)
        {
            version++;
            using var document = JsonDocument.Parse(JsonSerializer.Serialize(payload));
            var commandHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{subject}/{version}")))
                .ToLowerInvariant();
            events.Add(new EventEnvelope(Identifier(1_000_000 + version), version, 1, type, subject,
                new DateTimeOffset(2026, 9, 21, 12, 0, 0, TimeSpan.Zero).AddSeconds(version),
                Identifier(2_000_000 + version), commandHash, document.RootElement.Clone()));
        }
    }

    private static object DailySchedule(DateOnly startDate) => new
    {
        cadence = "Daily", interval = 1, weekdays = Array.Empty<int>(), dayOfMonth = (int?)null,
        startDate, endDate = (DateOnly?)null
    };

    private static object[] OneHorseAllocation(Guid horseId, long amount) =>
        [new { horseId, weight = 1_000_000, amountMinor = amount }];

    private static DateOnly Day(int index) => new(2026, 9, 1 + index % 21);

    private static Guid Identifier(int value) =>
        Guid.Parse($"10000000-0000-4000-8000-{value:D12}");
}
