namespace CostTracking.Api.Domain;

public sealed record PendingIncomeItem(Guid RuleId, DateOnly ScheduledDate, long AmountMinor, string Source, SplitMode SplitMode, IReadOnlyList<Allocation> Allocations);

public static class PendingIncome
{
    private const int CandidateLimit = 10_000;

    public static IReadOnlyList<PendingIncomeItem> Derive(IReadOnlyCollection<RecurringIncomeRule> rules, IReadOnlyCollection<IncomeDecision> decisions,
        DateOnly ownerToday, DateOnly from, DateOnly through)
    {
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(decisions);
        ValidateWindow(from, through);
        var ruleArray = rules.ToArray();
        if (ruleArray.Any(rule => rule is null)) throw new ArgumentException("Rules cannot contain null entries.", nameof(rules));
        if (ruleArray.Select(rule => rule.RuleId).Distinct().Count() != ruleArray.Length)
            throw new ArgumentException("Rule identifiers must be unique.", nameof(rules));
        var decided = decisions.Select(decision => (decision.RuleId, decision.ScheduledDate)).ToHashSet();
        var candidates = new List<PendingIncomeItem>();
        var generated = 0;

        foreach (var rule in ruleArray)
        {
            var segmentStart = from > rule.StartDate ? from : rule.StartDate;
            var inclusiveThrough = through < ownerToday ? through : ownerToday;
            if (rule.LastDate is { } stop && stop < inclusiveThrough) inclusiveThrough = stop;
            for (var index = 0; index < rule.Revisions.Count; index++)
            {
                var revision = rule.Revisions[index];
                var start = segmentStart > revision.EffectiveFrom ? segmentStart : revision.EffectiveFrom;
                var end = inclusiveThrough;
                if (index + 1 < rule.Revisions.Count)
                {
                    var nextStart = rule.Revisions[index + 1].EffectiveFrom;
                    if (nextStart <= start) continue;
                    var segmentEnd = nextStart.AddDays(-1);
                    if (segmentEnd < end) end = segmentEnd;
                }
                if (revision.Schedule.EndDate is { } scheduleEnd && scheduleEnd < end) end = scheduleEnd;
                if (start > end) continue;

                foreach (var date in ScheduleExpansion.Expand(revision.Schedule, start, end))
                {
                    if (++generated > CandidateLimit) throw new InvalidOperationException("Income occurrence candidate limit exceeded.");
                    if (decided.Contains((rule.RuleId, date))) continue;
                    candidates.Add(new PendingIncomeItem(rule.RuleId, date, revision.Defaults.AmountMinor,
                        revision.Defaults.Source, revision.Defaults.SplitMode, revision.Defaults.Allocations));
                }
            }
        }

        return candidates.OrderBy(item => item.ScheduledDate).ThenBy(item => CanonicalId(item.RuleId), StringComparer.Ordinal).ToArray();
    }

    private static void ValidateWindow(DateOnly from, DateOnly through)
    {
        if (through < from) throw new ArgumentException("The end of the income window cannot precede its start.", nameof(through));
        DateOnly max;
        try { max = from.AddYears(5).AddDays(-1); }
        catch (ArgumentOutOfRangeException) { max = DateOnly.MaxValue; }
        if (through > max) throw new ArgumentOutOfRangeException(nameof(through), "Income windows may span at most five calendar years minus one day.");
    }

    private static string CanonicalId(Guid id) => id.ToString("D").ToLowerInvariant();
}
