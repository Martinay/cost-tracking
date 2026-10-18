namespace CostTracking.Api.Domain;

/// <summary>Validated defaults captured by one recurring expense rule revision.</summary>
public sealed class ExpenseRuleDefaults
{
    private static readonly HashSet<string> Categories = new(StringComparer.Ordinal)
    {
        "Stabling", "Veterinary", "Farrier", "Feed", "Equipment", "Training", "Other"
    };

    public long AmountMinor { get; }
    public string Category { get; }
    public string Description { get; }
    public SplitMode SplitMode { get; }
    public IReadOnlyList<Allocation> Allocations { get; }

    public ExpenseRuleDefaults(long amountMinor, string category, string description, SplitMode splitMode,
        IReadOnlyList<Allocation> allocations)
    {
        FinancialValues.RequirePositiveMinor(amountMinor);
        ArgumentException.ThrowIfNullOrWhiteSpace(category);
        ArgumentNullException.ThrowIfNull(description);
        if (!Categories.Contains(category)) throw new ArgumentException("Unknown expense category.", nameof(category));
        ArgumentNullException.ThrowIfNull(allocations);
        if (description.Length > 500) throw new ArgumentOutOfRangeException(nameof(description));
        if (!Enum.IsDefined(splitMode)) throw new ArgumentOutOfRangeException(nameof(splitMode));
        if (allocations.Count is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(allocations));
        if (allocations.Any(item => item.HorseId == Guid.Empty || item.Weight <= 0 || item.AmountMinor < 0 ||
                                    item.AmountMinor > FinancialValues.MaximumSafeInteger))
            throw new ArgumentException("Allocations must contain valid horse IDs, positive weights, and safe nonnegative amounts.", nameof(allocations));
        if (allocations.Select(item => item.HorseId).Distinct().Count() != allocations.Count)
            throw new ArgumentException("Allocation horse IDs must be unique.", nameof(allocations));
        if (allocations.Sum(item => (long)item.Weight) != AllocationCalculator.TotalWeight)
            throw new ArgumentException("Allocation weights must total 1,000,000.", nameof(allocations));
        var allocated = allocations.Aggregate(0L, (sum, item) => checked(sum + item.AmountMinor));
        if (allocated != amountMinor)
            throw new ArgumentException("Allocation amounts must equal the rule amount.", nameof(allocations));
        if (splitMode == SplitMode.Equal && !allocations.SequenceEqual(AllocationCalculator.Equal(amountMinor, allocations.Select(item => item.HorseId).ToArray())))
            throw new ArgumentException("Equal split allocations must match the canonical equal split.", nameof(allocations));

        AmountMinor = amountMinor;
        Category = category;
        Description = description;
        SplitMode = splitMode;
        Allocations = Array.AsReadOnly(allocations.ToArray());
    }
}

/// <summary>A complete revision whose schedule keeps the rule's original start anchor.</summary>
public sealed record RuleRevision
{
    public DateOnly EffectiveFrom { get; }
    public Schedule Schedule { get; }
    public ExpenseRuleDefaults Defaults { get; }

    public RuleRevision(DateOnly effectiveFrom, Schedule schedule, ExpenseRuleDefaults defaults)
    {
        ArgumentNullException.ThrowIfNull(schedule);
        ArgumentNullException.ThrowIfNull(defaults);
        if (effectiveFrom < schedule.StartDate)
            throw new ArgumentException("A revision cannot become effective before the schedule start date.", nameof(effectiveFrom));
        EffectiveFrom = effectiveFrom;
        Schedule = schedule;
        Defaults = defaults;
    }
}
