namespace CostTracking.Api.Domain;

public sealed record ExpenseOccurrence(string Id, Guid RuleId, DateOnly ScheduledDate, long AmountMinor,
    string Category, string Description, SplitMode SplitMode, IReadOnlyList<Allocation> Allocations,
    string Origin, string OccurrenceState, bool Skipped, long ContributionMinor);

public static class ExpenseOccurrences
{
    public static IReadOnlyList<ExpenseOccurrence> Expand(IReadOnlyCollection<RecurringExpenseRule> rules,
        IReadOnlyCollection<ExpenseOccurrenceOverride> overrides, DateOnly from, DateOnly through,
        int maxCandidates = 10_000)
    {
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(overrides);
        DateWindow.Validate(from, through);
        if (maxCandidates < 1) throw new ArgumentOutOfRangeException(nameof(maxCandidates));
        if (rules.Any(rule => rule is null || rule.RuleId == Guid.Empty))
            throw new ArgumentException("Rules must have nonempty IDs.", nameof(rules));
        if (rules.Select(rule => rule.RuleId).Distinct().Count() != rules.Count)
            throw new ArgumentException("Rule IDs must be unique.", nameof(rules));

        var rulesById = rules.ToDictionary(rule => rule.RuleId);
        if (overrides.Any(item => item is null || item.EventId == Guid.Empty || item.RuleId == Guid.Empty || item.StreamVersion < 1))
            throw new ArgumentException("Override rows must have valid IDs and stream versions.", nameof(overrides));
        if (overrides.Select(item => item.EventId).Distinct().Count() != overrides.Count ||
            overrides.Select(item => item.StreamVersion).Distinct().Count() != overrides.Count)
            throw new ArgumentException("Override event IDs and stream versions must be unique.", nameof(overrides));
        if (overrides.Any(item => !rulesById.ContainsKey(item.RuleId)))
            throw new ArgumentException("An override references an unknown rule.", nameof(overrides));

        var overridesByOccurrence = overrides.GroupBy(item => (item.RuleId, item.ScheduledDate))
            .ToDictionary(group => group.Key, group => group.OrderBy(item => item.StreamVersion).ToArray());
        var result = new List<ExpenseOccurrence>();
        var candidates = 0;

        foreach (var rule in rules.OrderBy(item => item.RuleId.ToString("D").ToLowerInvariant(), StringComparer.Ordinal))
        {
            for (var index = 0; index < rule.Revisions.Count; index++)
            {
                var revision = rule.Revisions[index];
                var segmentFrom = Max(from, revision.EffectiveFrom, rule.StartDate, revision.Schedule.StartDate);
                var segmentThrough = through;
                if (revision.Schedule.EndDate is { } scheduleEnd && scheduleEnd < segmentThrough)
                    segmentThrough = scheduleEnd;
                if (rule.LastDate is { } lastDate && lastDate < segmentThrough)
                    segmentThrough = lastDate;
                if (index + 1 < rule.Revisions.Count)
                {
                    var nextEffectiveFrom = rule.Revisions[index + 1].EffectiveFrom;
                    if (nextEffectiveFrom == DateOnly.MinValue) continue;
                    var previousDay = nextEffectiveFrom.AddDays(-1);
                    if (previousDay < segmentThrough) segmentThrough = previousDay;
                }
                if (segmentThrough < segmentFrom) continue;

                var dates = ScheduleExpansion.Expand(revision.Schedule, segmentFrom, segmentThrough);
                if (dates.Count > maxCandidates - candidates)
                    throw new ArgumentOutOfRangeException(nameof(maxCandidates), "The query exceeds the generated occurrence limit.");
                candidates += dates.Count;

                foreach (var date in dates)
                {
                    overridesByOccurrence.TryGetValue((rule.RuleId, date), out var occurrenceHistory);
                    var latest = occurrenceHistory?.LastOrDefault();
                    var latestChanged = occurrenceHistory?.LastOrDefault(item => item.Action == ExpenseOccurrenceAction.Changed);
                    var defaults = latest?.Action == ExpenseOccurrenceAction.Changed
                        ? latest.Changed!
                        : latestChanged?.Changed ?? revision.Defaults;
                    var skipped = latest?.Action == ExpenseOccurrenceAction.Skipped;
                    var state = latest?.Action.ToString() ?? "Virtual";
                    result.Add(new ExpenseOccurrence(
                        $"expense-rule/{rule.RuleId:D}/{date:yyyy-MM-dd}", rule.RuleId, date,
                        defaults.AmountMinor, defaults.Category, defaults.Description, defaults.SplitMode,
                        defaults.Allocations, "Recurring", state, skipped, skipped ? 0 : defaults.AmountMinor));
                }
            }
        }

        return result.OrderBy(item => item.ScheduledDate)
            .ThenBy(item => item.RuleId.ToString("D").ToLowerInvariant(), StringComparer.Ordinal)
            .ToArray();
    }

    private static DateOnly Max(DateOnly first, DateOnly second, DateOnly third, DateOnly fourth) =>
        first > second ? (first > third ? (first > fourth ? first : fourth) : (third > fourth ? third : fourth))
            : (second > third ? (second > fourth ? second : fourth) : (third > fourth ? third : fourth));
}
