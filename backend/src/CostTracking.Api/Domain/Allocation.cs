using System.Numerics;
using System.Text.Json.Serialization;

namespace CostTracking.Api.Domain;

[JsonConverter(typeof(JsonStringEnumConverter<SplitMode>))]
public enum SplitMode { Equal, Custom }

public sealed record Allocation(Guid HorseId, int Weight, long AmountMinor);
public sealed record CustomShare(Guid HorseId, int Weight);

/// <summary>Calculates immutable per-horse shares with exact integer arithmetic and canonical UUID ordering.</summary>
public static class AllocationCalculator
{
    public const int TotalWeight = 1_000_000;

    public static IReadOnlyList<Allocation> Equal(long amountMinor, IReadOnlyCollection<Guid> horseIds)
    {
        FinancialValues.RequirePositiveMinor(amountMinor);
        var ordered = ValidateIds(horseIds);
        var amountBase = amountMinor / ordered.Length;
        var amountRemainder = amountMinor % ordered.Length;
        var weightBase = TotalWeight / ordered.Length;
        var weightRemainder = TotalWeight % ordered.Length;
        return ordered.Select((id, index) => new Allocation(id,
            checked(weightBase + (index < weightRemainder ? 1 : 0)),
            checked(amountBase + (index < amountRemainder ? 1 : 0)))).ToArray();
    }

    public static IReadOnlyList<Allocation> Custom(long amountMinor, IReadOnlyCollection<CustomShare> shares)
    {
        FinancialValues.RequirePositiveMinor(amountMinor);
        ArgumentNullException.ThrowIfNull(shares);
        if (shares.Count is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(shares), "A split requires 1 to 100 targets.");
        var ordered = shares.OrderBy(share => CanonicalId(share.HorseId), StringComparer.Ordinal).ToArray();
        if (ordered.Any(share => share.HorseId == Guid.Empty)) throw new ArgumentException("Horse identifiers cannot be empty.", nameof(shares));
        if (ordered.Select(share => share.HorseId).Distinct().Count() != ordered.Length)
            throw new ArgumentException("Horse identifiers must be distinct.", nameof(shares));
        if (ordered.Any(share => share.Weight <= 0)) throw new ArgumentException("Custom weights must be positive integers.", nameof(shares));
        var totalWeight = ordered.Aggregate(0L, (sum, share) => checked(sum + share.Weight));
        if (totalWeight != TotalWeight) throw new ArgumentException("Custom weights must sum to 1,000,000.", nameof(shares));

        var results = ordered.Select(share =>
        {
            var product = (BigInteger)amountMinor * share.Weight;
            var quotient = BigInteger.DivRem(product, TotalWeight, out var remainder);
            if (quotient > FinancialValues.MaximumSafeInteger) throw new OverflowException("Allocation exceeds the safe integer range.");
            return new WeightedAllocation(share.HorseId, share.Weight, (long)quotient, remainder);
        }).ToArray();
        var remaining = amountMinor - results.Sum(item => item.AmountMinor);
        foreach (var item in results.OrderByDescending(item => item.Remainder)
                     .ThenBy(item => CanonicalId(item.HorseId), StringComparer.Ordinal).Take(checked((int)remaining)))
            item.AmountMinor++;
        return results.Select(item => new Allocation(item.HorseId, item.Weight, item.AmountMinor)).ToArray();
    }

    private static Guid[] ValidateIds(IReadOnlyCollection<Guid> horseIds)
    {
        ArgumentNullException.ThrowIfNull(horseIds);
        if (horseIds.Count is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(horseIds), "A split requires 1 to 100 targets.");
        if (horseIds.Any(id => id == Guid.Empty)) throw new ArgumentException("Horse identifiers cannot be empty.", nameof(horseIds));
        if (horseIds.Distinct().Count() != horseIds.Count) throw new ArgumentException("Horse identifiers must be distinct.", nameof(horseIds));
        return horseIds.OrderBy(CanonicalId, StringComparer.Ordinal).ToArray();
    }

    private static string CanonicalId(Guid id) => id.ToString("D").ToLowerInvariant();

    private sealed class WeightedAllocation(Guid horseId, int weight, long amountMinor, BigInteger remainder)
    {
        public Guid HorseId { get; } = horseId;
        public int Weight { get; } = weight;
        public long AmountMinor { get; set; } = amountMinor;
        public BigInteger Remainder { get; } = remainder;
    }
}
