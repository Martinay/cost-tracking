using CostTracking.Api.Features.IncomeRules;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Domain;

public sealed record IncomeRecord(string Id, DateOnly ReceivedDate, long AmountMinor, string Source,
    SplitMode SplitMode, IReadOnlyList<Allocation> Allocations, long StreamVersion,
    Guid? RuleId = null, DateOnly? ScheduledDate = null, string Origin = "OneTime");

public static class IncomeProjection
{
    public static IReadOnlyList<IncomeRecord> Replay(IEnumerable<EventEnvelope> source)
    {
        var events = source as IReadOnlyList<EventEnvelope> ?? source.ToArray();
        var actual = events.Where(value => value.Type == "IncomeRecorded").Select(value =>
        {
            var payload = value.Payload;
            return new IncomeRecord(payload.GetProperty("incomeId").GetGuid().ToString("D").ToLowerInvariant(),
                ExpenseProjection.ReadDate(payload, "receivedDate"), payload.GetProperty("amountMinor").GetInt64(),
                payload.GetProperty("source").GetString()!, Enum.Parse<SplitMode>(payload.GetProperty("splitMode").GetString()!, false),
                ExpenseProjection.ReadAllocations(payload.GetProperty("allocations")), value.StreamVersion);
        });
        var recurring = IncomeRuleEventReplay.Read(events).Decisions
            .Where(item => item.Kind == IncomeDecisionKind.Approved)
            .Select(item => new IncomeRecord($"income-rule/{item.RuleId:D}/{item.ScheduledDate:yyyy-MM-dd}",
                item.ReceivedDate!.Value, item.AmountMinor!.Value, item.Source!, item.SplitMode!.Value,
                item.Allocations, events.Single(value => value.Type == "RecurringIncomeApproved" &&
                    value.Payload.GetProperty("ruleId").GetGuid() == item.RuleId &&
                    ExpenseProjection.ReadDate(value.Payload, "scheduledDate") == item.ScheduledDate).StreamVersion,
                item.RuleId, item.ScheduledDate, "Recurring"));
        return actual.Concat(recurring).ToArray();
    }
}
