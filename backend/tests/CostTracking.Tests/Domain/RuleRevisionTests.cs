using CostTracking.Api.Domain;

namespace CostTracking.Tests.Domain;

public sealed class RuleRevisionTests
{
    private static readonly Guid HorseA = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private static readonly Guid HorseB = Guid.Parse("00000000-0000-0000-0000-000000000002");

    [Fact]
    public void Initial_revision_must_start_at_original_schedule_anchor_and_may_be_in_the_past()
    {
        var past = D(2026, 1, 1);
        var rule = RecurringExpenseRule.Create(Guid.NewGuid(), Revision(past, past, 100), D(2026, 6, 1));

        Assert.Equal(past, rule.StartDate);
        Assert.Single(rule.Revisions);
        Assert.Equal(100, rule.Revisions[0].Defaults.AmountMinor);
        Assert.Throws<ArgumentException>(() => RecurringExpenseRule.Create(Guid.NewGuid(), Revision(D(2026, 2, 1), past, 100), D(2026, 6, 1)));
    }

    [Fact]
    public void Queued_revisions_must_be_future_strictly_ordered_and_keep_original_schedule_anchor()
    {
        var start = D(2026, 1, 1);
        var rule = RecurringExpenseRule.Create(Guid.NewGuid(), Revision(start, start, 100), D(2026, 6, 1));
        rule = rule.Revise(Revision(D(2026, 7, 1), start, 200), D(2026, 6, 1), []);

        Assert.Equal(start, rule.Revisions[1].Schedule.StartDate);
        Assert.Throws<ArgumentException>(() => rule.Revise(Revision(D(2026, 6, 1), start, 300), D(2026, 6, 1), []));
        Assert.Throws<ArgumentException>(() => rule.Revise(Revision(D(2026, 7, 1), start, 300), D(2026, 6, 1), []));
        Assert.Throws<ArgumentException>(() => rule.Revise(Revision(D(2026, 8, 1), D(2026, 2, 1), 300), D(2026, 6, 1), []));
    }

    [Fact]
    public void Revision_applicability_uses_half_open_effective_date_segments()
    {
        var start = D(2026, 1, 1);
        var rule = RecurringExpenseRule.Create(Guid.NewGuid(), Revision(start, start, 100), D(2026, 6, 1))
            .Revise(Revision(D(2026, 7, 1), start, 200), D(2026, 6, 1), [])
            .Revise(Revision(D(2026, 9, 1), start, 300), D(2026, 6, 1), []);

        Assert.Null(rule.RevisionFor(D(2025, 12, 31)));
        Assert.Equal(100, rule.RevisionFor(D(2026, 6, 30))!.Defaults.AmountMinor);
        Assert.Equal(200, rule.RevisionFor(D(2026, 7, 1))!.Defaults.AmountMinor);
        Assert.Equal(200, rule.RevisionFor(D(2026, 8, 31))!.Defaults.AmountMinor);
        Assert.Equal(300, rule.RevisionFor(D(2026, 9, 1))!.Defaults.AmountMinor);
    }

    [Fact]
    public void Revision_applicability_is_intersected_with_the_revision_schedule_end()
    {
        var start = D(2026, 1, 1);
        var rule = RecurringExpenseRule.Create(Guid.NewGuid(), Revision(start, start, 100), D(2026, 6, 1))
            .Revise(new RuleRevision(D(2026, 7, 1),
                new Schedule(Cadence.Monthly, 1, [], 1, start, D(2026, 8, 31)), Defaults(200)), D(2026, 6, 1), []);

        Assert.Equal(200, rule.RevisionFor(D(2026, 8, 31))!.Defaults.AmountMinor);
        Assert.Null(rule.RevisionFor(D(2026, 9, 1)));
    }

    [Fact]
    public void Revision_cannot_move_before_a_protected_override_or_decision_date()
    {
        var start = D(2026, 1, 1);
        var rule = RecurringExpenseRule.Create(Guid.NewGuid(), Revision(start, start, 100), D(2026, 6, 1));

        Assert.Throws<ArgumentException>(() => rule.Revise(Revision(D(2026, 8, 1), start, 200), D(2026, 6, 1), [D(2026, 8, 1)]));
        Assert.Throws<ArgumentException>(() => rule.Revise(Revision(D(2026, 8, 1), start, 200), D(2026, 6, 1), [D(2026, 9, 1)]));
        Assert.Equal(200, rule.Revise(Revision(D(2026, 10, 1), start, 200), D(2026, 6, 1), [D(2026, 9, 1)]).Revisions[^1].Defaults.AmountMinor);
    }

    [Fact]
    public void Stop_date_is_inclusive_and_cannot_erase_start_today_queued_revisions_or_protected_dates()
    {
        var start = D(2026, 1, 1);
        var today = D(2026, 6, 1);
        var rule = RecurringExpenseRule.Create(Guid.NewGuid(), Revision(start, start, 100), today)
            .Revise(Revision(D(2026, 8, 1), start, 200), today, []);

        Assert.Throws<ArgumentException>(() => rule.Stop(D(2025, 12, 31), today, []));
        Assert.Throws<ArgumentException>(() => rule.Stop(D(2026, 5, 31), today, []));
        Assert.Throws<ArgumentException>(() => rule.Stop(D(2026, 7, 31), today, []));
        Assert.Throws<ArgumentException>(() => rule.Stop(D(2026, 8, 31), today, [D(2026, 9, 1)]));
        var stopped = rule.Stop(D(2026, 9, 1), today, [D(2026, 9, 1)]);
        Assert.Equal(D(2026, 9, 1), stopped.LastDate);
        Assert.NotNull(stopped.RevisionFor(D(2026, 9, 1)));
        Assert.Null(stopped.RevisionFor(D(2026, 9, 2)));
    }

    [Fact]
    public void Stopped_rule_is_terminal_and_cannot_be_revised_or_stopped_again()
    {
        var start = D(2026, 1, 1);
        var today = D(2026, 6, 1);
        var stopped = RecurringExpenseRule.Create(Guid.NewGuid(), Revision(start, start, 100), today).Stop(today, today, []);

        Assert.Throws<InvalidOperationException>(() => stopped.Revise(Revision(D(2026, 7, 1), start, 200), today, []));
        Assert.Throws<InvalidOperationException>(() => stopped.Stop(D(2026, 8, 1), today, []));
    }

    [Fact]
    public void Rule_defaults_reject_nonpositive_money_missing_text_and_invalid_allocations()
    {
        Assert.ThrowsAny<ArgumentException>(() => Defaults(0));
        Assert.ThrowsAny<ArgumentException>(() => new ExpenseRuleDefaults(100, "", "hay", SplitMode.Equal, [new Allocation(HorseA, 1_000_000, 100)]));
        Assert.ThrowsAny<ArgumentException>(() => new ExpenseRuleDefaults(100, "feed", "hay", SplitMode.Equal, [new Allocation(HorseA, 1_000_000, 100)]));
        Assert.ThrowsAny<ArgumentException>(() => new ExpenseRuleDefaults(100, "Driving", "hay", SplitMode.Equal, [new Allocation(HorseA, 1_000_000, 100)]));
        Assert.ThrowsAny<ArgumentException>(() => new ExpenseRuleDefaults(100, "Feed", "hay", SplitMode.Equal, []));
        Assert.ThrowsAny<ArgumentException>(() => new ExpenseRuleDefaults(100, "Feed", "hay", SplitMode.Equal, [new Allocation(Guid.Empty, 1_000_000, 100)]));
        Assert.ThrowsAny<ArgumentException>(() => new ExpenseRuleDefaults(100, "Feed", "hay", SplitMode.Equal, [new Allocation(HorseA, 1_000_000, 99)]));
        Assert.ThrowsAny<ArgumentException>(() => new ExpenseRuleDefaults(100, "Feed", "hay", SplitMode.Custom, [new Allocation(HorseA, 500_000, 50), new Allocation(HorseB, 500_000, 49)]));
    }

    private static RuleRevision Revision(DateOnly effectiveFrom, DateOnly anchor, long amount) =>
        new(effectiveFrom, new Schedule(Cadence.Monthly, 1, [], 1, anchor, null), Defaults(amount));

    private static ExpenseRuleDefaults Defaults(long amount) =>
        new(amount, "Feed", "hay", SplitMode.Equal, [new Allocation(HorseA, 1_000_000, amount)]);

    private static DateOnly D(int year, int month, int day) => new(year, month, day);
}
