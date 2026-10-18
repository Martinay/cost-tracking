namespace CostTracking.Api.Domain;

public sealed class IncomeRuleDefaults
{
    public long AmountMinor { get; }
    public string Source { get; }
    public SplitMode SplitMode { get; }
    public IReadOnlyList<Allocation> Allocations { get; }

    public IncomeRuleDefaults(long amountMinor, string source, SplitMode splitMode, IReadOnlyList<Allocation> allocations)
    {
        FinancialValues.RequirePositiveMinor(amountMinor);
        ArgumentException.ThrowIfNullOrWhiteSpace(source);
        ArgumentNullException.ThrowIfNull(allocations);
        if (source.Length > 100) throw new ArgumentOutOfRangeException(nameof(source));
        if (!Enum.IsDefined(splitMode)) throw new ArgumentOutOfRangeException(nameof(splitMode));
        if (allocations.Count is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(allocations));
        if (allocations.Any(item => item.HorseId == Guid.Empty || item.Weight <= 0 || item.AmountMinor < 0 ||
                                    item.AmountMinor > FinancialValues.MaximumSafeInteger))
            throw new ArgumentException("Allocations must contain valid horse IDs, positive weights, and safe nonnegative amounts.", nameof(allocations));
        if (allocations.Select(item => item.HorseId).Distinct().Count() != allocations.Count)
            throw new ArgumentException("Allocation horse IDs must be unique.", nameof(allocations));
        if (allocations.Sum(item => (long)item.Weight) != AllocationCalculator.TotalWeight)
            throw new ArgumentException("Allocation weights must total 1,000,000.", nameof(allocations));
        if (allocations.Aggregate(0L, (sum, item) => checked(sum + item.AmountMinor)) != amountMinor)
            throw new ArgumentException("Allocation amounts must equal the rule amount.", nameof(allocations));
        if (splitMode == SplitMode.Equal && !allocations.SequenceEqual(AllocationCalculator.Equal(amountMinor, allocations.Select(item => item.HorseId).ToArray())))
            throw new ArgumentException("Equal split allocations must match the canonical equal split.", nameof(allocations));

        AmountMinor = amountMinor;
        Source = source;
        SplitMode = splitMode;
        Allocations = Array.AsReadOnly(allocations.ToArray());
    }
}

public sealed record IncomeRuleRevision
{
    public DateOnly EffectiveFrom { get; }
    public Schedule Schedule { get; }
    public IncomeRuleDefaults Defaults { get; }

    public IncomeRuleRevision(DateOnly effectiveFrom, Schedule schedule, IncomeRuleDefaults defaults)
    {
        ArgumentNullException.ThrowIfNull(schedule);
        ArgumentNullException.ThrowIfNull(defaults);
        if (effectiveFrom < schedule.StartDate) throw new ArgumentException("A revision cannot be effective before its schedule start.", nameof(effectiveFrom));
        EffectiveFrom = effectiveFrom;
        Schedule = schedule;
        Defaults = defaults;
    }
}

public sealed class RecurringIncomeRule
{
    public Guid RuleId { get; }
    public DateOnly StartDate { get; }
    public IReadOnlyList<IncomeRuleRevision> Revisions { get; }
    public DateOnly? LastDate { get; }

    private RecurringIncomeRule(Guid ruleId, DateOnly startDate, IReadOnlyList<IncomeRuleRevision> revisions, DateOnly? lastDate)
    {
        RuleId = ruleId;
        StartDate = startDate;
        Revisions = Array.AsReadOnly(revisions.ToArray());
        LastDate = lastDate;
    }

    public static RecurringIncomeRule Create(Guid ruleId, IncomeRuleRevision initial, DateOnly today)
    {
        ArgumentNullException.ThrowIfNull(initial);
        if (ruleId == Guid.Empty) throw new ArgumentException("Rule ID cannot be empty.", nameof(ruleId));
        if (initial.EffectiveFrom != initial.Schedule.StartDate)
            throw new ArgumentException("The initial revision must be effective on its original schedule start date.", nameof(initial));
        return new RecurringIncomeRule(ruleId, initial.Schedule.StartDate, [initial], null);
    }

    public RecurringIncomeRule Revise(IncomeRuleRevision revision, DateOnly today, IReadOnlyCollection<DateOnly> protectedDates)
    {
        ArgumentNullException.ThrowIfNull(revision);
        ArgumentNullException.ThrowIfNull(protectedDates);
        if (LastDate.HasValue) throw new InvalidOperationException("A stopped rule is terminal and cannot be revised.");
        if (revision.Schedule.StartDate != StartDate) throw new ArgumentException("A revision must preserve the original start anchor.", nameof(revision));
        if (revision.EffectiveFrom <= today) throw new ArgumentException("A revision must become effective after owner today.", nameof(revision));
        if (revision.EffectiveFrom <= Revisions[^1].EffectiveFrom) throw new ArgumentException("Revision dates must be strictly increasing.", nameof(revision));
        if (protectedDates.Any(date => revision.EffectiveFrom <= date))
            throw new ArgumentException("A revision must become effective after every protected occurrence.", nameof(revision));
        return new RecurringIncomeRule(RuleId, StartDate, Revisions.Append(revision).ToArray(), null);
    }

    public RecurringIncomeRule Stop(DateOnly lastDate, DateOnly today, IReadOnlyCollection<DateOnly> protectedDates)
    {
        ArgumentNullException.ThrowIfNull(protectedDates);
        if (LastDate.HasValue) throw new InvalidOperationException("A stopped rule cannot be stopped again.");
        if (lastDate < StartDate || lastDate < today || Revisions.Any(item => lastDate < item.EffectiveFrom) || protectedDates.Any(date => lastDate < date))
            throw new ArgumentException("The inclusive stop date cannot precede the start, today, queued revisions, or protected dates.", nameof(lastDate));
        return new RecurringIncomeRule(RuleId, StartDate, Revisions, lastDate);
    }

    public IncomeRuleRevision? RevisionFor(DateOnly date)
    {
        if (date < StartDate || (LastDate.HasValue && date > LastDate.Value)) return null;
        for (var index = Revisions.Count - 1; index >= 0; index--)
        {
            var revision = Revisions[index];
            if (revision.EffectiveFrom > date) continue;
            if (revision.Schedule.EndDate is { } end && date > end) return null;
            return revision;
        }
        return null;
    }
}
