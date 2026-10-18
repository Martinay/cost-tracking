using System.Globalization;
using System.Text.Json;
using CostTracking.Api.Contracts;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Domain;

internal sealed record RecurringExpenseReplay(Dictionary<Guid, RecurringExpenseRule> Rules,
    List<ExpenseOccurrenceOverride> Overrides);

internal static class RecurringExpenseProjection
{
    public static RecurringExpenseReplay Read(IReadOnlyList<EventEnvelope> events)
    {
        var rules = new Dictionary<Guid, RecurringExpenseRule>();
        var overrides = new List<ExpenseOccurrenceOverride>();
        foreach (var envelope in events)
        {
            var payload = envelope.Payload;
            switch (envelope.Type)
            {
                case "RecurringExpenseRuleCreated":
                {
                    var id = payload.GetProperty("ruleId").GetGuid();
                    var revision = ReadRevision(payload);
                    rules.Add(id, RecurringExpenseRule.Create(id, revision, revision.EffectiveFrom));
                    break;
                }
                case "RecurringExpenseRuleUpdated":
                {
                    var id = payload.GetProperty("ruleId").GetGuid();
                    if (!rules.TryGetValue(id, out var rule)) throw new InvalidDataException("Expense rule update references a missing rule.");
                    var revision = ReadRevision(payload);
                    var protectedDates = overrides.Where(item => item.RuleId == id).Select(item => item.ScheduledDate).ToArray();
                    var ownerToday = revision.EffectiveFrom == DateOnly.MinValue ? DateOnly.MinValue : revision.EffectiveFrom.AddDays(-1);
                    rules[id] = rule.Revise(revision, ownerToday, protectedDates);
                    break;
                }
                case "RecurringExpenseRuleStopped":
                {
                    var id = payload.GetProperty("ruleId").GetGuid();
                    if (!rules.TryGetValue(id, out var rule)) throw new InvalidDataException("Expense rule stop references a missing rule.");
                    var lastDate = ReadDate(payload.GetProperty("lastDate"));
                    var protectedDates = overrides.Where(item => item.RuleId == id).Select(item => item.ScheduledDate).ToArray();
                    rules[id] = rule.Stop(lastDate, lastDate, protectedDates);
                    break;
                }
                case "RecurringExpenseOccurrenceOverridden":
                {
                    var id = payload.GetProperty("ruleId").GetGuid();
                    if (!rules.TryGetValue(id, out var rule)) throw new InvalidDataException("Expense override references a missing rule.");
                    var date = ReadDate(payload.GetProperty("scheduledDate"));
                    var action = Enum.Parse<ExpenseOccurrenceAction>(payload.GetProperty("action").GetString()!, false);
                    var changed = payload.GetProperty("changed").ValueKind == JsonValueKind.Null
                        ? null : RecurringExpenseEventValues.ReadDefaults(payload.GetProperty("changed"));
                    var prior = overrides.Where(item => item.RuleId == id && item.ScheduledDate == date).ToArray();
                    var eligibleIds = events.TakeWhile(value => value.StreamVersion < envelope.StreamVersion)
                        .Where(value => value.Type is "HorseRegistered" or "HorseDetailsUpdated")
                        .Select(value => value.Payload.GetProperty("horseId").GetGuid()).Distinct().ToArray();
                    overrides.Add(ExpenseOccurrenceOverride.Create(envelope.EventId, envelope.StreamVersion,
                        rule, date, action, changed, prior, eligibleIds));
                    break;
                }
            }
        }
        return new RecurringExpenseReplay(rules, overrides);
    }

    private static RuleRevision ReadRevision(JsonElement payload) => new(ReadDate(payload.GetProperty("effectiveFrom")),
        payload.GetProperty("schedule").Deserialize<Schedule>(ApiProtocol.JsonOptions)!,
        RecurringExpenseEventValues.ReadDefaults(payload.GetProperty("defaults")));

    private static DateOnly ReadDate(JsonElement value) => DateOnly.ParseExact(value.GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture);
}

internal static class RecurringExpenseEventValues
{
    public static ExpenseRuleDefaults ReadDefaults(JsonElement payload)
    {
        var allocations = payload.GetProperty("allocations").Deserialize<Allocation[]>(ApiProtocol.JsonOptions)!;
        var splitMode = Enum.Parse<SplitMode>(payload.GetProperty("splitMode").GetString()!, false);
        return new ExpenseRuleDefaults(payload.GetProperty("amountMinor").GetInt64(),
            payload.GetProperty("category").GetString()!, payload.GetProperty("description").GetString()!, splitMode, allocations);
    }
}
