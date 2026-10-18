using CostTracking.Api.Domain;

namespace CostTracking.Tests.Domain;

public sealed class ExpenseOccurrenceOverrideTests
{
    private static readonly Guid RuleId = Guid.Parse("00000000-0000-0000-0000-000000000021");
    private static readonly Guid HorseA = Guid.Parse("00000000-0000-0000-0000-000000000031");
    private static readonly Guid HorseB = Guid.Parse("00000000-0000-0000-0000-000000000032");

    [Fact]
    public void Changed_override_keeps_complete_values_and_allows_unchanged_inactive_split()
    {
        var rule = Rule();
        var changed = Defaults(300, HorseA, SplitMode.Equal);

        var result = ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 1, rule, D(2026, 9, 20),
            ExpenseOccurrenceAction.Changed, changed, [], []);

        Assert.Equal(RuleId, result.RuleId);
        Assert.Equal(D(2026, 9, 20), result.ScheduledDate);
        Assert.Equal(ExpenseOccurrenceAction.Changed, result.Action);
        Assert.Equal(changed, result.Changed);
    }

    [Fact]
    public void Changed_override_with_new_or_replaced_targets_requires_current_eligibility()
    {
        var rule = Rule();
        var changed = Defaults(300, HorseB, SplitMode.Custom);

        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 1, rule, D(2026, 9, 20),
            ExpenseOccurrenceAction.Changed, changed, [], [HorseA]));
        var result = ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 1, rule, D(2026, 9, 20),
            ExpenseOccurrenceAction.Changed, changed, [], [HorseB]);
        Assert.Equal(HorseB, Assert.Single(result.Changed!.Allocations).HorseId);
    }

    [Fact]
    public void Skipped_override_stores_null_and_latest_override_wins_by_stream_version_per_key()
    {
        var rule = Rule();
        var skipped = ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 1, rule, D(2026, 9, 20),
            ExpenseOccurrenceAction.Skipped, null, [], []);
        var changed = ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 2, rule, D(2026, 9, 20),
            ExpenseOccurrenceAction.Changed, Defaults(400, HorseA, SplitMode.Equal), [skipped], []);

        Assert.Null(skipped.Changed);
        Assert.Same(changed, ExpenseOccurrenceOverride.LatestFor(RuleId, D(2026, 9, 20), [skipped, changed]));
        Assert.Null(ExpenseOccurrenceOverride.LatestFor(RuleId, D(2026, 9, 21), [skipped, changed]));
    }

    [Fact]
    public void Overrides_require_a_scheduled_date_inside_revision_schedule_and_stop_bounds()
    {
        var rule = Rule();
        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 1, rule, D(2026, 9, 18),
            ExpenseOccurrenceAction.Skipped, null, [], []));
        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 1, rule, D(2026, 9, 22),
            ExpenseOccurrenceAction.Skipped, null, [], []));

        var stopped = rule.Stop(D(2026, 9, 20), D(2026, 9, 20), []);
        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 1, stopped, D(2026, 9, 21),
            ExpenseOccurrenceAction.Skipped, null, [], []));
        Assert.NotNull(ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 1, stopped, D(2026, 9, 20),
            ExpenseOccurrenceAction.Skipped, null, [], []));
    }

    [Fact]
    public void Override_uses_the_applicable_revision_schedule_after_a_cadence_change()
    {
        var start = D(2026, 9, 19);
        var initial = new RuleRevision(start,
            new Schedule(Cadence.Weekly, 1, [], null, start, null), Defaults(100, HorseA, SplitMode.Equal));
        var revision = new RuleRevision(D(2026, 10, 1),
            new Schedule(Cadence.Weekdays, 1, [5], null, start, null), Defaults(100, HorseA, SplitMode.Equal));
        var rule = RecurringExpenseRule.Create(RuleId, initial, D(2026, 9, 18)).Revise(revision, D(2026, 9, 20), []);

        var result = ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 1, rule, D(2026, 10, 2),
            ExpenseOccurrenceAction.Skipped, null, [], []);

        Assert.Equal(D(2026, 10, 2), result.ScheduledDate);
    }

    [Fact]
    public void Override_action_and_changed_payload_shape_must_match_exactly()
    {
        var rule = Rule();
        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 1, rule, D(2026, 9, 20),
            (ExpenseOccurrenceAction)99, null, [], []));
        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 1, rule, D(2026, 9, 20),
            ExpenseOccurrenceAction.Changed, null, [], []));
        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 1, rule, D(2026, 9, 20),
            ExpenseOccurrenceAction.Skipped, Defaults(300, HorseA, SplitMode.Equal), [], []));
    }

    [Fact]
    public void Event_ids_and_stream_versions_must_be_valid_and_unique()
    {
        var rule = Rule();
        var existing = ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 5, rule, D(2026, 9, 19),
            ExpenseOccurrenceAction.Skipped, null, [], []);

        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrenceOverride.Create(Guid.Empty, 6, rule, D(2026, 9, 20),
            ExpenseOccurrenceAction.Skipped, null, [existing], []));
        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 0, rule, D(2026, 9, 20),
            ExpenseOccurrenceAction.Skipped, null, [], []));
        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrenceOverride.Create(existing.EventId, 6, rule, D(2026, 9, 20),
            ExpenseOccurrenceAction.Skipped, null, [existing], []));
        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 5, rule, D(2026, 9, 20),
            ExpenseOccurrenceAction.Skipped, null, [existing], []));
        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrenceOverride.LatestFor(RuleId, D(2026, 9, 19), [existing, existing]));
    }

    private static RecurringExpenseRule Rule() => RecurringExpenseRule.Create(RuleId,
        new RuleRevision(D(2026, 9, 19), new Schedule(Cadence.Daily, 1, [], null, D(2026, 9, 19), D(2026, 9, 21)),
            Defaults(100, HorseA, SplitMode.Equal)), D(2026, 9, 18));

    private static ExpenseRuleDefaults Defaults(long amount, Guid horseId, SplitMode splitMode) =>
        new(amount, "Feed", "hay", splitMode, [new Allocation(horseId, 1_000_000, amount)]);

    private static DateOnly D(int year, int month, int day) => new(year, month, day);
}
