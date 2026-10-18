using CostTracking.Api.Domain;

namespace CostTracking.Tests.Domain;

public sealed class AllocationTests
{
    private static readonly Guid LexicallyFirst = Guid.Parse("00000001-0000-4000-8000-000000000001");
    private static readonly Guid LexicallySecond = Guid.Parse("00000100-0000-4000-8000-000000000001");

    [Fact]
    public void Equal_split_divides_amount_and_residual_by_canonical_horse_id()
    {
        var allocations = AllocationCalculator.Equal(1001, [LexicallySecond, LexicallyFirst]);

        Assert.Equal([LexicallyFirst, LexicallySecond], allocations.Select(item => item.HorseId));
        Assert.Equal([501L, 500L], allocations.Select(item => item.AmountMinor));
        Assert.Equal([500_000, 500_000], allocations.Select(item => item.Weight));
        Assert.Equal(1001L, allocations.Sum(item => item.AmountMinor));
        Assert.Equal(1_000_000, allocations.Sum(item => item.Weight));
    }

    [Fact]
    public void Equal_split_handles_large_amounts_and_residual_weights_for_three_horses()
    {
        var ids = new[]
        {
            Guid.Parse("00000003-0000-4000-8000-000000000001"),
            Guid.Parse("00000001-0000-4000-8000-000000000001"),
            Guid.Parse("00000002-0000-4000-8000-000000000001")
        };

        var allocations = AllocationCalculator.Equal(300_000_000, ids);

        Assert.Equal(ids.OrderBy(id => id.ToString("D").ToLowerInvariant(), StringComparer.Ordinal), allocations.Select(item => item.HorseId));
        Assert.All(allocations, item => Assert.Equal(100_000_000L, item.AmountMinor));
        Assert.Equal([333_334, 333_333, 333_333], allocations.Select(item => item.Weight));
        Assert.Equal(300_000_000, allocations.Sum(item => item.AmountMinor));
        Assert.Equal(1_000_000, allocations.Sum(item => item.Weight));
    }

    [Fact]
    public void Custom_split_uses_largest_fractional_remainders_and_returns_uuid_order()
    {
        var lexicallyThird = Guid.Parse("00000003-0000-4000-8000-000000000001");
        var lexicallyFirst = Guid.Parse("00000001-0000-4000-8000-000000000001");
        var lexicallySecond = Guid.Parse("00000002-0000-4000-8000-000000000001");

        var allocations = AllocationCalculator.Custom(7,
        [
            new CustomShare(lexicallyThird, 200_000),
            new CustomShare(lexicallyFirst, 500_000),
            new CustomShare(lexicallySecond, 300_000)
        ]);

        Assert.Equal([lexicallyFirst, lexicallySecond, lexicallyThird], allocations.Select(item => item.HorseId));
        Assert.Equal([4L, 2L, 1L], allocations.Select(item => item.AmountMinor));
        Assert.Equal([500_000, 300_000, 200_000], allocations.Select(item => item.Weight));
        Assert.Equal(7L, allocations.Sum(item => item.AmountMinor));
        Assert.Equal(1_000_000, allocations.Sum(item => item.Weight));
    }

    [Fact]
    public void Custom_split_breaks_equal_remainder_ties_by_canonical_uuid_not_guid_byte_order()
    {
        var allocations = AllocationCalculator.Custom(1,
        [
            new CustomShare(LexicallySecond, 500_000),
            new CustomShare(LexicallyFirst, 500_000)
        ]);

        Assert.Equal([LexicallyFirst, LexicallySecond], allocations.Select(item => item.HorseId));
        Assert.Equal([1L, 0L], allocations.Select(item => item.AmountMinor));
    }

    [Fact]
    public void Valid_target_count_boundaries_and_zero_minor_allocations_are_supported()
    {
        var one = AllocationCalculator.Equal(1, [LexicallyFirst]);
        Assert.Equal(1L, Assert.Single(one).AmountMinor);
        Assert.Equal(1_000_000, one[0].Weight);

        var oneHundredIds = Enumerable.Range(1, 100)
            .Select(index => Guid.Parse($"{index:00000000}-0000-4000-8000-000000000001"))
            .ToArray();
        var hundred = AllocationCalculator.Equal(100, oneHundredIds);
        Assert.Equal(100, hundred.Count);
        Assert.All(hundred, item => Assert.Equal(1, item.AmountMinor));
        Assert.Equal(1_000_000, hundred.Sum(item => item.Weight));

        var zeroShare = AllocationCalculator.Custom(1,
        [
            new CustomShare(LexicallyFirst, 1),
            new CustomShare(LexicallySecond, 999_999)
        ]);
        Assert.Contains(zeroShare, item => item.AmountMinor == 0);
        Assert.Equal(1L, zeroShare.Sum(item => item.AmountMinor));
    }

    [Fact]
    public void Safe_integer_maximum_is_allocated_exactly_without_intermediate_overflow()
    {
        const long maximumSafeInteger = 9_007_199_254_740_991;

        var allocations = AllocationCalculator.Custom(maximumSafeInteger,
        [
            new CustomShare(LexicallyFirst, 1),
            new CustomShare(LexicallySecond, 999_999)
        ]);

        Assert.Equal(maximumSafeInteger, allocations.Sum(item => item.AmountMinor));
        Assert.Equal(1_000_000, allocations.Sum(item => item.Weight));
        Assert.All(allocations, item => Assert.InRange(item.AmountMinor, 0L, maximumSafeInteger));
    }

    [Fact]
    public void Invalid_amounts_target_counts_duplicates_and_custom_weights_are_rejected()
    {
        AssertInvalid(() => AllocationCalculator.Equal(0, [LexicallyFirst]));
        AssertInvalid(() => AllocationCalculator.Equal(-1, [LexicallyFirst]));
        AssertInvalid(() => AllocationCalculator.Equal(9_007_199_254_740_992, [LexicallyFirst]));
        AssertInvalid(() => AllocationCalculator.Equal(1, []));
        AssertInvalid(() => AllocationCalculator.Equal(1, Enumerable.Range(1, 101).Select(GuidFromInt).ToArray()));
        AssertInvalid(() => AllocationCalculator.Equal(1, [LexicallyFirst, LexicallyFirst]));

        var custom101Targets = Enumerable.Range(1, 101).Select(GuidFromInt)
            .Select((id, index) => new CustomShare(id, index == 0 ? 999_900 : 1)).ToArray();
        AssertInvalid(() => AllocationCalculator.Custom(1, custom101Targets));
        AssertInvalid(() => AllocationCalculator.Custom(0, [new CustomShare(LexicallyFirst, 1_000_000)]));
        AssertInvalid(() => AllocationCalculator.Custom(-1, [new CustomShare(LexicallyFirst, 1_000_000)]));
        AssertInvalid(() => AllocationCalculator.Custom(9_007_199_254_740_992, [new CustomShare(LexicallyFirst, 1_000_000)]));
        AssertInvalid(() => AllocationCalculator.Custom(1, []));
        AssertInvalid(() => AllocationCalculator.Custom(1,
            [new CustomShare(LexicallyFirst, 500_000), new CustomShare(LexicallyFirst, 500_000)]));
        AssertInvalid(() => AllocationCalculator.Custom(1,
            [new CustomShare(LexicallyFirst, 0), new CustomShare(LexicallySecond, 1_000_000)]));
        AssertInvalid(() => AllocationCalculator.Custom(1,
            [new CustomShare(LexicallyFirst, 999_999), new CustomShare(LexicallySecond, 2)]));
        AssertInvalid(() => AllocationCalculator.Custom(1,
            [new CustomShare(LexicallyFirst, int.MaxValue), new CustomShare(LexicallySecond, int.MaxValue)]));
    }

    private static void AssertInvalid(Action action)
    {
        var exception = Record.Exception(action);
        Assert.NotNull(exception);
        Assert.True(exception is ArgumentException or OverflowException,
            $"Expected an argument/overflow validation error, received {exception.GetType().Name}.");
    }

    private static Guid GuidFromInt(int value) => Guid.Parse($"{value:00000000}-0000-4000-8000-000000000001");
}
