using CostTracking.Api.Domain;

namespace CostTracking.Tests.Domain;

public sealed class ExpenseOccurrencesTests
{
    private static readonly Guid Horse = Guid.Parse("11111111-1111-4111-8111-111111111111");
    private static readonly Guid RuleId = Guid.Parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    [Fact]
    public void Expansion_applies_revision_segments_and_stable_ids_in_date_then_rule_order()
    {
        var first = Rule(RuleId, new DateOnly(2026, 9, 1), 100).Revise(
            Revision(new DateOnly(2026, 9, 25), new DateOnly(2026, 9, 1), 200), new DateOnly(2026, 9, 21), []);
        var otherId = Guid.Parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        var second = Rule(otherId, new DateOnly(2026, 9, 1), 300);

        var items = ExpenseOccurrences.Expand([second, first], [], new DateOnly(2026, 9, 24), new DateOnly(2026, 9, 26));

        Assert.Equal(new[] { new DateOnly(2026, 9, 24), new DateOnly(2026, 9, 24), new DateOnly(2026, 9, 25), new DateOnly(2026, 9, 25), new DateOnly(2026, 9, 26), new DateOnly(2026, 9, 26) },
            items.Select(item => item.ScheduledDate));
        Assert.All(items.Where(item => item.RuleId == RuleId && item.ScheduledDate == new DateOnly(2026, 9, 24)), item => Assert.Equal(100, item.AmountMinor));
        Assert.All(items.Where(item => item.RuleId == RuleId && item.ScheduledDate >= new DateOnly(2026, 9, 25)), item => Assert.Equal(200, item.AmountMinor));
        Assert.Equal("expense-rule/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/2026-09-24", items.Single(item => item.RuleId == RuleId && item.ScheduledDate == new DateOnly(2026, 9, 24)).Id);
        Assert.Equal(items, items.OrderBy(item => item.ScheduledDate).ThenBy(item => item.RuleId.ToString("D").ToLowerInvariant(), StringComparer.Ordinal));
    }

    [Fact]
    public void Skipped_overrides_keep_display_values_and_changed_overrides_replace_them()
    {
        var rule = Rule(RuleId, new DateOnly(2026, 9, 1), 100);
        var date = new DateOnly(2026, 9, 20);
        var changedDefaults = Defaults(250);
        var changed = ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 1, rule, date, ExpenseOccurrenceAction.Changed,
            changedDefaults, [], [Horse]);
        var skipped = ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 2, rule, date, ExpenseOccurrenceAction.Skipped,
            null, [changed], [Horse]);

        var skippedItem = Assert.Single(ExpenseOccurrences.Expand([rule], [changed, skipped], date, date));
        Assert.Equal(250, skippedItem.AmountMinor);
        Assert.Equal(changedDefaults.Allocations, skippedItem.Allocations);
        Assert.True(skippedItem.Skipped);
        Assert.Equal("Skipped", skippedItem.OccurrenceState);
        Assert.Equal(0, skippedItem.ContributionMinor);

        var restored = ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 3, rule, date, ExpenseOccurrenceAction.Changed,
            Defaults(400), [changed, skipped], [Horse]);
        var restoredItem = Assert.Single(ExpenseOccurrences.Expand([rule], [changed, skipped, restored], date, date));
        Assert.Equal(400, restoredItem.AmountMinor);
        Assert.False(restoredItem.Skipped);
        Assert.Equal("Changed", restoredItem.OccurrenceState);
        Assert.Equal(400, restoredItem.ContributionMinor);
    }

    [Fact]
    public void Expansion_obeys_stop_bounds_and_five_calendar_year_window()
    {
        var start = new DateOnly(2024, 2, 29);
        var rule = Rule(RuleId, start, 100).Stop(new DateOnly(2026, 9, 21), new DateOnly(2026, 9, 21), []);
        var rows = ExpenseOccurrences.Expand([rule], [], new DateOnly(2024, 2, 28), new DateOnly(2026, 9, 22));

        Assert.DoesNotContain(rows, row => row.ScheduledDate < start || row.ScheduledDate > new DateOnly(2026, 9, 21));
        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrences.Expand([rule], [], new DateOnly(2020, 1, 1), new DateOnly(2025, 1, 1)));
        Assert.Equal(new DateOnly(2025, 2, 27), DateWindow.MaximumThrough(new DateOnly(2020, 2, 29)));
    }

    [Fact]
    public void Expansion_enforces_candidate_limit_across_rules_before_returning_pages()
    {
        var start = new DateOnly(2026, 1, 1);
        var rules = Enumerable.Range(0, 2).Select(index => Rule(Guid.NewGuid(), start, 100)).ToArray();

        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrences.Expand(rules, [], start, start.AddDays(9), maxCandidates: 19));
        Assert.Equal(18, ExpenseOccurrences.Expand(rules, [], start, start.AddDays(8), maxCandidates: 18).Count);

        var fiveYearStart = new DateOnly(2020, 1, 1);
        var maxThrough = DateWindow.MaximumThrough(fiveYearStart);
        var tenThousandRules = Enumerable.Range(0, 5).Select(_ => Rule(Guid.NewGuid(), fiveYearStart, 100)).ToList();
        var shortEnd = fiveYearStart.AddDays(864);
        tenThousandRules.Add(RecurringExpenseRule.Create(Guid.NewGuid(),
            new RuleRevision(fiveYearStart, new Schedule(Cadence.Daily, 1, [], null, fiveYearStart, shortEnd), Defaults(100)), fiveYearStart));
        Assert.Equal(10_000, ExpenseOccurrences.Expand(tenThousandRules, [], fiveYearStart, maxThrough).Count);
        tenThousandRules.Add(Rule(Guid.NewGuid(), fiveYearStart, 100));
        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrences.Expand(tenThousandRules, [], fiveYearStart, maxThrough));
    }

    [Fact]
    public void Duplicate_rule_ids_and_duplicate_overrides_are_rejected()
    {
        var rule = Rule(RuleId, new DateOnly(2026, 9, 1), 100);
        var date = new DateOnly(2026, 9, 20);
        var item = ExpenseOccurrenceOverride.Create(Guid.NewGuid(), 1, rule, date, ExpenseOccurrenceAction.Skipped, null, [], []);
        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrences.Expand([rule, rule], [], date, date));
        Assert.ThrowsAny<ArgumentException>(() => ExpenseOccurrences.Expand([rule], [item, item], date, date));
    }

    private static RecurringExpenseRule Rule(Guid id, DateOnly start, long amount) =>
        RecurringExpenseRule.Create(id, Revision(start, start, amount), start);

    private static RuleRevision Revision(DateOnly effectiveFrom, DateOnly start, long amount) =>
        new(effectiveFrom, new Schedule(Cadence.Daily, 1, [], null, start, null), Defaults(amount));

    private static ExpenseRuleDefaults Defaults(long amount) => new(amount, "Feed", "Hay", SplitMode.Equal,
        [new Allocation(Horse, AllocationCalculator.TotalWeight, amount)]);
}
