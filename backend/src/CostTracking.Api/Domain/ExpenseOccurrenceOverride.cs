namespace CostTracking.Api.Domain;

public enum ExpenseOccurrenceAction { Changed, Skipped }

public sealed class ExpenseOccurrenceOverride
{
    public Guid EventId { get; }
    public long StreamVersion { get; }
    public Guid RuleId { get; }
    public DateOnly ScheduledDate { get; }
    public ExpenseOccurrenceAction Action { get; }
    public ExpenseRuleDefaults? Changed { get; }

    private ExpenseOccurrenceOverride(Guid eventId, long streamVersion, Guid ruleId, DateOnly scheduledDate,
        ExpenseOccurrenceAction action, ExpenseRuleDefaults? changed)
    {
        EventId = eventId;
        StreamVersion = streamVersion;
        RuleId = ruleId;
        ScheduledDate = scheduledDate;
        Action = action;
        Changed = changed;
    }

    public static ExpenseOccurrenceOverride Create(Guid eventId, long streamVersion, RecurringExpenseRule rule, DateOnly scheduledDate,
        ExpenseOccurrenceAction action, ExpenseRuleDefaults? changed, IReadOnlyCollection<ExpenseOccurrenceOverride> priorOverrides,
        IReadOnlyCollection<Guid> eligibleHorseIds)
    {
        ArgumentNullException.ThrowIfNull(rule);
        ArgumentNullException.ThrowIfNull(priorOverrides);
        ArgumentNullException.ThrowIfNull(eligibleHorseIds);
        if (eventId == Guid.Empty) throw new ArgumentException("Event ID cannot be empty.", nameof(eventId));
        if (rule.RuleId == Guid.Empty) throw new ArgumentException("Rule ID cannot be empty.", nameof(rule));
        if (streamVersion < 1) throw new ArgumentOutOfRangeException(nameof(streamVersion));
        if (!Enum.IsDefined(action)) throw new ArgumentOutOfRangeException(nameof(action));
        ValidatePrior(priorOverrides);
        if (priorOverrides.Any(item => item.EventId == eventId)) throw new ArgumentException("Event IDs must be unique.", nameof(eventId));
        if (priorOverrides.Any(item => item.StreamVersion >= streamVersion))
            throw new ArgumentException("The new event stream version must be greater than prior override versions.", nameof(streamVersion));

        var revision = rule.RevisionFor(scheduledDate);
        if (revision is null || ScheduleExpansion.Expand(revision.Schedule, scheduledDate, scheduledDate).Count == 0)
            throw new ArgumentException("An override must target a currently scheduled occurrence within rule bounds.", nameof(scheduledDate));
        if (action == ExpenseOccurrenceAction.Changed && changed is null)
            throw new ArgumentException("A Changed override requires complete values.", nameof(changed));
        if (action == ExpenseOccurrenceAction.Skipped && changed is not null)
            throw new ArgumentException("A Skipped override cannot contain changed values.", nameof(changed));

        if (changed is not null)
        {
            var unchangedSplit = changed.SplitMode == revision.Defaults.SplitMode &&
                SplitTargets(changed.Allocations).SequenceEqual(SplitTargets(revision.Defaults.Allocations));
            if (!unchangedSplit && changed.Allocations.Any(item => !eligibleHorseIds.Contains(item.HorseId)))
                throw new ArgumentException("Changed split targets must be currently eligible horses.", nameof(eligibleHorseIds));
        }

        return new ExpenseOccurrenceOverride(eventId, streamVersion, rule.RuleId, scheduledDate, action, changed);
    }

    public static ExpenseOccurrenceOverride? LatestFor(Guid ruleId, DateOnly scheduledDate,
        IReadOnlyCollection<ExpenseOccurrenceOverride> overrides)
    {
        ArgumentNullException.ThrowIfNull(overrides);
        if (ruleId == Guid.Empty) throw new ArgumentException("Rule ID cannot be empty.", nameof(ruleId));
        ValidatePrior(overrides);
        return overrides.Where(item => item.RuleId == ruleId && item.ScheduledDate == scheduledDate)
            .MaxBy(item => item.StreamVersion);
    }

    private static void ValidatePrior(IReadOnlyCollection<ExpenseOccurrenceOverride> priorOverrides)
    {
        if (priorOverrides.Any(item => item is null)) throw new ArgumentException("Override rows cannot contain null entries.", nameof(priorOverrides));
        if (priorOverrides.Any(item => item.EventId == Guid.Empty || item.StreamVersion < 1 || item.RuleId == Guid.Empty))
            throw new ArgumentException("Prior override rows require nonempty IDs and positive stream versions.", nameof(priorOverrides));
        if (priorOverrides.Select(item => item.EventId).Distinct().Count() != priorOverrides.Count)
            throw new ArgumentException("Prior override event IDs must be unique.", nameof(priorOverrides));
        if (priorOverrides.Select(item => item.StreamVersion).Distinct().Count() != priorOverrides.Count)
            throw new ArgumentException("Prior override stream versions must be unique.", nameof(priorOverrides));
    }

    private static IEnumerable<(Guid HorseId, int Weight)> SplitTargets(IReadOnlyList<Allocation> allocations) =>
        allocations.OrderBy(item => item.HorseId.ToString("D").ToLowerInvariant(), StringComparer.Ordinal)
            .Select(item => (item.HorseId, item.Weight));
}
