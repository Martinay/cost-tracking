namespace CostTracking.Api.Domain;

public enum IncomeDecisionKind { Approved, Rejected }

public sealed record IncomeActuals(long AmountMinor, SplitMode SplitMode, IReadOnlyList<Allocation> Allocations);

public sealed class IncomeDecision
{
    public Guid RuleId { get; }
    public DateOnly ScheduledDate { get; }
    public IncomeDecisionKind Kind { get; }
    public DateOnly? ReceivedDate { get; }
    public long? AmountMinor { get; }
    public IReadOnlyList<Allocation> Allocations { get; }
    public SplitMode? SplitMode { get; }
    public string? Source { get; }
    public DateOnly? NextDueDate { get; }

    private IncomeDecision(Guid ruleId, DateOnly scheduledDate, IncomeDecisionKind kind, DateOnly? receivedDate,
        long? amountMinor, IReadOnlyList<Allocation> allocations, SplitMode? splitMode, string? source, DateOnly? nextDueDate)
    {
        RuleId = ruleId;
        ScheduledDate = scheduledDate;
        Kind = kind;
        ReceivedDate = receivedDate;
        AmountMinor = amountMinor;
        Allocations = Array.AsReadOnly(allocations.ToArray());
        SplitMode = splitMode;
        Source = source;
        NextDueDate = nextDueDate;
    }

    public static IncomeDecision Approve(RecurringIncomeRule rule, DateOnly scheduledDate, DateOnly receivedDate, DateOnly ownerToday,
        IncomeActuals actualValues, IReadOnlyCollection<IncomeDecision> priorDecisions, IReadOnlyCollection<Guid>? eligibleHorseIds = null)
    {
        ArgumentNullException.ThrowIfNull(rule);
        ArgumentNullException.ThrowIfNull(actualValues);
        ArgumentNullException.ThrowIfNull(priorDecisions);
        var revision = ValidateDueKey(rule, scheduledDate, ownerToday, priorDecisions);
        if (receivedDate > ownerToday) throw new ArgumentException("The actual received date cannot be in the future.", nameof(receivedDate));
        var actualDefaults = new IncomeRuleDefaults(actualValues.AmountMinor, revision.Defaults.Source,
            actualValues.SplitMode, actualValues.Allocations);

        var unchangedSplit = actualDefaults.SplitMode == revision.Defaults.SplitMode &&
            SplitTargets(actualDefaults.Allocations).SequenceEqual(SplitTargets(revision.Defaults.Allocations));
        if (!unchangedSplit)
        {
            var eligible = (eligibleHorseIds ?? Array.Empty<Guid>()).ToHashSet();
            if (actualDefaults.Allocations.Any(allocation => !eligible.Contains(allocation.HorseId)))
                throw new ArgumentException("Changed income splits require currently eligible horses.", nameof(eligibleHorseIds));
        }

        var result = new IncomeDecision(rule.RuleId, scheduledDate, IncomeDecisionKind.Approved, receivedDate,
            actualDefaults.AmountMinor, actualDefaults.Allocations, actualDefaults.SplitMode, revision.Defaults.Source, null);
        var nextDue = FindNextDueDate(rule, scheduledDate, priorDecisions.Append(result).ToArray());
        return new IncomeDecision(rule.RuleId, scheduledDate, IncomeDecisionKind.Approved, receivedDate,
            actualDefaults.AmountMinor, actualDefaults.Allocations, actualDefaults.SplitMode, revision.Defaults.Source, nextDue);
    }

    public static IncomeDecision Reject(RecurringIncomeRule rule, DateOnly scheduledDate, DateOnly ownerToday,
        IReadOnlyCollection<IncomeDecision> priorDecisions)
    {
        ArgumentNullException.ThrowIfNull(rule);
        ArgumentNullException.ThrowIfNull(priorDecisions);
        ValidateDueKey(rule, scheduledDate, ownerToday, priorDecisions);
        var result = new IncomeDecision(rule.RuleId, scheduledDate, IncomeDecisionKind.Rejected, null, null, [], null, null, null);
        return new IncomeDecision(rule.RuleId, scheduledDate, IncomeDecisionKind.Rejected, null, null, [], null, null,
            FindNextDueDate(rule, scheduledDate, priorDecisions.Append(result).ToArray()));
    }

    private static IncomeRuleRevision ValidateDueKey(RecurringIncomeRule rule, DateOnly scheduledDate, DateOnly ownerToday,
        IReadOnlyCollection<IncomeDecision> priorDecisions)
    {
        if (scheduledDate > ownerToday) throw new ArgumentException("Future occurrences cannot be decided in advance.", nameof(scheduledDate));
        if (priorDecisions.Any(item => item.RuleId == rule.RuleId && item.ScheduledDate == scheduledDate))
            throw new InvalidOperationException("An income occurrence can receive only one final decision.");
        var revision = rule.RevisionFor(scheduledDate);
        if (revision is null || ScheduleExpansion.Expand(revision.Schedule, scheduledDate, scheduledDate).Count == 0)
            throw new ArgumentException("The requested date is not a scheduled occurrence for this rule.", nameof(scheduledDate));
        return revision;
    }

    private static DateOnly? FindNextDueDate(RecurringIncomeRule rule, DateOnly after,
        IReadOnlyCollection<IncomeDecision> decisions)
    {
        if (after == DateOnly.MaxValue) return null;
        var decided = decisions.Select(item => (item.RuleId, item.ScheduledDate)).ToHashSet();
        var maxDate = rule.LastDate ?? DateOnly.MaxValue;
        for (var index = 0; index < rule.Revisions.Count; index++)
        {
            var revision = rule.Revisions[index];
            var start = after.AddDays(1);
            if (start < revision.EffectiveFrom) start = revision.EffectiveFrom;
            if (start < rule.StartDate) start = rule.StartDate;
            var end = maxDate;
            if (index + 1 < rule.Revisions.Count)
            {
                var nextEffective = rule.Revisions[index + 1].EffectiveFrom;
                if (nextEffective == DateOnly.MinValue) continue;
                var segmentEnd = nextEffective.AddDays(-1);
                if (segmentEnd < end) end = segmentEnd;
            }
            if (revision.Schedule.EndDate is { } scheduleEnd && scheduleEnd < end) end = scheduleEnd;
            if (start > end) continue;

            while (start <= end)
            {
                var chunkEnd = MaxWindowEnd(start);
                if (chunkEnd > end) chunkEnd = end;
                foreach (var candidate in ScheduleExpansion.Expand(revision.Schedule, start, chunkEnd))
                {
                    if (!decided.Contains((rule.RuleId, candidate))) return candidate;
                }
                if (chunkEnd == DateOnly.MaxValue) break;
                start = chunkEnd.AddDays(1);
            }
        }
        return null;
    }

    private static DateOnly MaxWindowEnd(DateOnly from)
    {
        try { return from.AddYears(5).AddDays(-1); }
        catch (ArgumentOutOfRangeException) { return DateOnly.MaxValue; }
    }

    private static IEnumerable<(Guid HorseId, int Weight)> SplitTargets(IReadOnlyList<Allocation> allocations) =>
        allocations.OrderBy(item => item.HorseId.ToString("D").ToLowerInvariant(), StringComparer.Ordinal)
            .Select(item => (item.HorseId, item.Weight));
}
