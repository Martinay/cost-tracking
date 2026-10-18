using CostTracking.Api.Domain;

namespace CostTracking.Tests.Domain;

public sealed class RecurringIncomeTests
{
    private static readonly Guid HorseA = Guid.Parse("00000000-0000-0000-0000-000000000011");
    private static readonly Guid HorseB = Guid.Parse("00000000-0000-0000-0000-000000000012");

    [Fact]
    public void Pending_derivation_uses_revision_source_and_defaults_but_only_through_owner_today()
    {
        var start = D(2026, 9, 19);
        var rule = Rule(start, D(2026, 9, 22), amount: 100, source: "Board")
            .Revise(Revision(D(2026, 9, 21), start, 250, "Prize"), D(2026, 9, 18), []);

        var pending = PendingIncome.Derive([rule], [], D(2026, 9, 22), start, D(2026, 9, 23));

        Assert.Collection(pending,
            item => { Assert.Equal(D(2026, 9, 19), item.ScheduledDate); Assert.Equal("Board", item.Source); Assert.Equal(100, item.AmountMinor); },
            item => { Assert.Equal(D(2026, 9, 20), item.ScheduledDate); Assert.Equal("Board", item.Source); Assert.Equal(100, item.AmountMinor); },
            item => { Assert.Equal(D(2026, 9, 21), item.ScheduledDate); Assert.Equal("Prize", item.Source); Assert.Equal(250, item.AmountMinor); },
            item => { Assert.Equal(D(2026, 9, 22), item.ScheduledDate); Assert.Equal("Prize", item.Source); Assert.Equal(250, item.AmountMinor); });
    }

    [Fact]
    public void Pending_derivation_honors_stops_keeps_due_backlog_and_excludes_future_dates()
    {
        var start = D(2026, 9, 17);
        var rule = Rule(start, null, 100, "Board").Stop(D(2026, 9, 22), D(2026, 9, 22), []);

        var pending = PendingIncome.Derive([rule], [], D(2026, 9, 22), D(2026, 9, 17), D(2026, 9, 23));

        Assert.Equal([D(2026, 9, 17), D(2026, 9, 18), D(2026, 9, 19), D(2026, 9, 20), D(2026, 9, 21), D(2026, 9, 22)], pending.Select(item => item.ScheduledDate));
    }

    [Fact]
    public void Pending_derivation_is_date_then_rule_id_ordered_and_omits_final_decisions()
    {
        var start = D(2026, 9, 19);
        var first = Rule(start, null, 100, "Board", Guid.Parse("00000000-0000-0000-0000-000000000002"));
        var second = Rule(start, null, 200, "Prize", Guid.Parse("00000000-0000-0000-0000-000000000001"));
        var rejected = IncomeDecision.Reject(second, start, D(2026, 9, 22), []);

        var pending = PendingIncome.Derive([first, second], [rejected], D(2026, 9, 22), start, D(2026, 9, 20));

        Assert.Equal([(first.RuleId, start), (second.RuleId, D(2026, 9, 20)), (first.RuleId, D(2026, 9, 20))],
            pending.Select(item => (item.RuleId, item.ScheduledDate)));
    }

    [Fact]
    public void Pending_derivation_enforces_candidate_budget_across_rules_before_decisions()
    {
        var start = D(2020, 1, 1);
        var rules = Enumerable.Range(0, 6).Select(_ => Rule(start, null, 100, "Board")).ToArray();

        Assert.Throws<InvalidOperationException>(() => PendingIncome.Derive(rules, [], D(2024, 12, 31), start, D(2024, 12, 31)));
    }

    [Fact]
    public void Pending_and_decisions_reject_invalid_windows_future_occurrences_and_unscheduled_dates()
    {
        var start = D(2026, 9, 19);
        var rule = Rule(start, null, 100, "Board");

        Assert.ThrowsAny<ArgumentException>(() => PendingIncome.Derive([rule], [], D(2026, 9, 22), D(2026, 9, 20), D(2026, 9, 19)));
        Assert.ThrowsAny<ArgumentException>(() => PendingIncome.Derive([rule], [], D(2026, 9, 22), start, D(2031, 9, 19)));
        Assert.ThrowsAny<ArgumentException>(() => IncomeDecision.Reject(rule, D(2026, 9, 23), D(2026, 9, 22), []));
        Assert.ThrowsAny<ArgumentException>(() => IncomeDecision.Reject(rule, D(2026, 9, 18), D(2026, 9, 22), []));
        Assert.ThrowsAny<ArgumentException>(() => IncomeDecision.Approve(rule, D(2026, 9, 19), D(2026, 9, 23), D(2026, 9, 22), Actual(100), [], [HorseA]));
    }

    [Fact]
    public void Decisions_can_be_processed_out_of_order_and_next_due_is_strictly_later_than_processed_date()
    {
        var start = D(2026, 9, 19);
        var rule = Rule(start, D(2026, 9, 22), 100, "Board");
        var approve20 = IncomeDecision.Approve(rule, D(2026, 9, 20), D(2026, 9, 22), D(2026, 9, 22), Actual(100), [], [HorseA]);

        Assert.Equal(D(2026, 9, 21), approve20.NextDueDate);
        var pending = PendingIncome.Derive([rule], [approve20], D(2026, 9, 22), start, D(2026, 9, 22));
        Assert.Equal([D(2026, 9, 19), D(2026, 9, 21), D(2026, 9, 22)], pending.Select(item => item.ScheduledDate));

        var approve21 = IncomeDecision.Approve(rule, D(2026, 9, 21), D(2026, 9, 22), D(2026, 9, 22), Actual(100), [approve20], [HorseA]);
        Assert.Equal(D(2026, 9, 22), approve21.NextDueDate);
        var last = IncomeDecision.Reject(rule, D(2026, 9, 22), D(2026, 9, 22), [approve20, approve21]);
        Assert.Null(last.NextDueDate);
    }

    [Fact]
    public void Decisions_are_final_and_rejection_contains_no_realized_values()
    {
        var start = D(2026, 9, 19);
        var rule = Rule(start, null, 100, "Board");
        var rejected = IncomeDecision.Reject(rule, start, D(2026, 9, 22), []);

        Assert.Equal(IncomeDecisionKind.Rejected, rejected.Kind);
        Assert.Null(rejected.AmountMinor);
        Assert.Empty(rejected.Allocations);
        Assert.Null(rejected.ReceivedDate);
        Assert.Throws<InvalidOperationException>(() => IncomeDecision.Approve(rule, start, D(2026, 9, 22), D(2026, 9, 22), Actual(100), [rejected], [HorseA]));
        Assert.Throws<InvalidOperationException>(() => IncomeDecision.Reject(rule, start, D(2026, 9, 22), [rejected]));
    }

    [Fact]
    public void Approval_uses_revision_source_and_allows_unchanged_inactive_split_but_requires_eligibility_for_changed_split()
    {
        var start = D(2026, 9, 19);
        var rule = Rule(start, null, 100, "Board")
            .Revise(Revision(D(2026, 9, 21), start, 200, "Prize"), D(2026, 9, 18), []);
        var unchanged = new IncomeActuals(300, SplitMode.Equal, [new Allocation(HorseA, 1_000_000, 300)]);

        var approved = IncomeDecision.Approve(rule, D(2026, 9, 21), D(2026, 9, 22), D(2026, 9, 22), unchanged, [], []);

        Assert.Equal("Prize", approved.Source);
        Assert.Equal(300, approved.AmountMinor);
        Assert.Throws<ArgumentException>(() => IncomeDecision.Approve(rule, D(2026, 9, 21), D(2026, 9, 22), D(2026, 9, 22),
            new IncomeActuals(300, SplitMode.Custom, [new Allocation(HorseB, 1_000_000, 300)]), [], [HorseA]));
        var changed = IncomeDecision.Approve(rule, D(2026, 9, 21), D(2026, 9, 22), D(2026, 9, 22),
            new IncomeActuals(300, SplitMode.Custom, [new Allocation(HorseB, 1_000_000, 300)]), [], [HorseB]);
        Assert.Equal(HorseB, Assert.Single(changed.Allocations).HorseId);
    }

    [Fact]
    public void Income_defaults_validate_positive_safe_amount_source_and_allocations()
    {
        Assert.ThrowsAny<ArgumentException>(() => new IncomeRuleDefaults(0, "Board", SplitMode.Equal, [new Allocation(HorseA, 1_000_000, 0)]));
        Assert.ThrowsAny<ArgumentException>(() => new IncomeRuleDefaults(100, "", SplitMode.Equal, [new Allocation(HorseA, 1_000_000, 100)]));
        Assert.ThrowsAny<ArgumentException>(() => new IncomeRuleDefaults(100, new string('x', 101), SplitMode.Equal, [new Allocation(HorseA, 1_000_000, 100)]));
        Assert.ThrowsAny<ArgumentException>(() => new IncomeRuleDefaults(100, "Board", SplitMode.Equal, [new Allocation(HorseA, 1_000_000, 99)]));
    }

    [Fact]
    public void Income_rule_revisions_preserve_anchor_and_stop_is_terminal_after_queued_and_protected_dates()
    {
        var start = D(2026, 9, 1);
        var today = D(2026, 9, 18);
        var rule = Rule(start, null, 100, "Board")
            .Revise(Revision(D(2026, 10, 1), start, 200, "Prize"), today, []);

        Assert.Equal(start, rule.Revisions[1].Schedule.StartDate);
        Assert.ThrowsAny<ArgumentException>(() => rule.Revise(Revision(D(2026, 10, 1), D(2026, 9, 2), 300, "Other"), today, []));
        Assert.ThrowsAny<ArgumentException>(() => rule.Stop(D(2026, 9, 30), D(2026, 9, 18), []));
        Assert.ThrowsAny<ArgumentException>(() => rule.Stop(D(2026, 10, 31), D(2026, 9, 18), [D(2026, 11, 1)]));

        var stopped = rule.Stop(D(2026, 11, 1), today, [D(2026, 11, 1)]);
        Assert.Null(stopped.RevisionFor(D(2026, 11, 2)));
        Assert.Throws<InvalidOperationException>(() => stopped.Revise(Revision(D(2026, 12, 1), start, 300, "Other"), today, []));
    }

    private static RecurringIncomeRule Rule(DateOnly start, DateOnly? end, long amount, string source, Guid? id = null) =>
        RecurringIncomeRule.Create(id ?? Guid.NewGuid(), Revision(start, start, amount, source, end), D(2026, 9, 18));

    private static IncomeRuleRevision Revision(DateOnly effective, DateOnly anchor, long amount, string source, DateOnly? end = null) =>
        new(effective, new Schedule(Cadence.Daily, 1, [], null, anchor, end),
            new IncomeRuleDefaults(amount, source, SplitMode.Equal, [new Allocation(HorseA, 1_000_000, amount)]));

    private static IncomeActuals Actual(long amount) =>
        new(amount, SplitMode.Equal, [new Allocation(HorseA, 1_000_000, amount)]);

    private static DateOnly D(int year, int month, int day) => new(year, month, day);
}
