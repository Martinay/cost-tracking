using System.Numerics;

namespace CostTracking.Api.Domain;

/// <summary>Shared safe-integer and rounding rules for persisted financial values.</summary>
public static class FinancialValues
{
    public const long MaximumSafeInteger = 9_007_199_254_740_991;

    public static long RequirePositiveMinor(long value, string? parameterName = null)
    {
        if (value is <= 0 or > MaximumSafeInteger)
            throw new ArgumentOutOfRangeException(parameterName ?? nameof(value), "Amount must be a positive safe integer in minor units.");
        return value;
    }

    public static long RequireAllocatedMinor(long value, string? parameterName = null)
    {
        if (value is < 0 or > MaximumSafeInteger)
            throw new ArgumentOutOfRangeException(parameterName ?? nameof(value), "Allocation must be a nonnegative safe integer in minor units.");
        return value;
    }

    public static long RequireSafeInteger(long value, string? parameterName = null)
    {
        if (value is < -MaximumSafeInteger or > MaximumSafeInteger)
            throw new ArgumentOutOfRangeException(parameterName ?? nameof(value), "Value exceeds the safe integer range.");
        return value;
    }

    public static long SumSafe(IEnumerable<long> values)
    {
        ArgumentNullException.ThrowIfNull(values);
        var total = values.Aggregate(BigInteger.Zero, (sum, value) => sum + value);
        if (total < -MaximumSafeInteger || total > MaximumSafeInteger)
            throw new OverflowException("Financial total exceeds the safe integer range.");
        return (long)total;
    }

    /// <summary>Rounds a positive decimal minor-unit result once, away from zero at a half unit.</summary>
    public static long RoundMinor(decimal amount)
    {
        if (amount <= 0) throw new ArgumentOutOfRangeException(nameof(amount), "Amount must be positive.");
        var rounded = decimal.Round(amount, 0, MidpointRounding.AwayFromZero);
        if (rounded > MaximumSafeInteger) throw new OverflowException("Financial amount exceeds the safe integer range.");
        return (long)rounded;
    }

    public static long CalculateDrivingMinor(decimal kilometers, decimal rateMinorPerKm)
    {
        if (kilometers <= 0) throw new ArgumentOutOfRangeException(nameof(kilometers), "Distance must be positive.");
        if (rateMinorPerKm <= 0) throw new ArgumentOutOfRangeException(nameof(rateMinorPerKm), "Rate must be positive.");
        if (decimal.Round(kilometers, 3) != kilometers)
            throw new ArgumentOutOfRangeException(nameof(kilometers), "Distance may use at most three decimal places.");
        if (decimal.Round(rateMinorPerKm, 4) != rateMinorPerKm)
            throw new ArgumentOutOfRangeException(nameof(rateMinorPerKm), "Rate may use at most four decimal places.");

        var product = checked(kilometers * rateMinorPerKm);
        var amountMinor = RoundMinor(product);
        if (amountMinor == 0)
            throw new ArgumentOutOfRangeException(nameof(kilometers), "Driving amount must round to at least one minor unit.");
        return amountMinor;
    }
}
