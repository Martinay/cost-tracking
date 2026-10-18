namespace CostTracking.Api.Domain;

/// <summary>An immutable recurring expense rule with an original calendar anchor and queued revisions.</summary>
public sealed class RecurringExpenseRule
{
    public Guid RuleId { get; }
    public DateOnly StartDate { get; }
    public IReadOnlyList<RuleRevision> Revisions { get; }
    public DateOnly? LastDate { get; }

    private RecurringExpenseRule(Guid ruleId, DateOnly startDate, IReadOnlyList<RuleRevision> revisions, DateOnly? lastDate)
    {
        RuleId = ruleId;
        StartDate = startDate;
        Revisions = Array.AsReadOnly(revisions.ToArray());
        LastDate = lastDate;
    }

    public static RecurringExpenseRule Create(Guid ruleId, RuleRevision initial, DateOnly ownerToday)
    {
        ArgumentNullException.ThrowIfNull(initial);
        if (ruleId == Guid.Empty) throw new ArgumentException("Rule ID cannot be empty.", nameof(ruleId));
        if (initial.EffectiveFrom != initial.Schedule.StartDate)
            throw new ArgumentException("The initial revision must be effective on the original schedule start date.", nameof(initial));
        return new RecurringExpenseRule(ruleId, initial.Schedule.StartDate, [initial], null);
    }

    public RecurringExpenseRule Revise(RuleRevision revision, DateOnly ownerToday, IReadOnlyCollection<DateOnly> protectedDates)
    {
        ArgumentNullException.ThrowIfNull(revision);
        ArgumentNullException.ThrowIfNull(protectedDates);
        if (LastDate.HasValue) throw new InvalidOperationException("A stopped rule is terminal and cannot be revised.");
        if (revision.Schedule.StartDate != StartDate)
            throw new ArgumentException("A revision must preserve the original schedule start anchor.", nameof(revision));
        if (revision.EffectiveFrom <= ownerToday)
            throw new ArgumentException("A revision must become effective after owner today.", nameof(revision));
        if (revision.EffectiveFrom <= Revisions[^1].EffectiveFrom)
            throw new ArgumentException("Queued revisions must have strictly increasing effective dates.", nameof(revision));
        if (protectedDates.Any(date => revision.EffectiveFrom <= date))
            throw new ArgumentException("A revision must become effective after every protected occurrence.", nameof(revision));
        return new RecurringExpenseRule(RuleId, StartDate, Revisions.Append(revision).ToArray(), null);
    }

    public RecurringExpenseRule Stop(DateOnly lastDate, DateOnly ownerToday, IReadOnlyCollection<DateOnly> protectedDates)
    {
        ArgumentNullException.ThrowIfNull(protectedDates);
        if (LastDate.HasValue) throw new InvalidOperationException("A stopped rule cannot be stopped again.");
        if (lastDate < StartDate || lastDate < ownerToday || Revisions.Any(revision => lastDate < revision.EffectiveFrom) ||
            protectedDates.Any(date => lastDate < date))
            throw new ArgumentException("The inclusive stop date cannot precede the start, owner today, queued revisions, or protected dates.", nameof(lastDate));
        return new RecurringExpenseRule(RuleId, StartDate, Revisions, lastDate);
    }

    public RuleRevision? RevisionFor(DateOnly scheduledDate)
    {
        if (scheduledDate < StartDate || (LastDate.HasValue && scheduledDate > LastDate.Value)) return null;
        for (var index = Revisions.Count - 1; index >= 0; index--)
        {
            var revision = Revisions[index];
            if (revision.EffectiveFrom > scheduledDate) continue;
            if (revision.Schedule.EndDate is { } scheduleEnd && scheduledDate > scheduleEnd) return null;
            return revision;
        }
        return null;
    }
}
