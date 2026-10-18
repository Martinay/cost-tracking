using CostTracking.Api.Domain;

namespace CostTracking.Tests.Domain;

public sealed class FinancialValuesTests
{
    [Theory]
    [MemberData(nameof(DrivingCases))]
    public void Driving_amount_multiplies_decimal_inputs_and_rounds_once_away_from_zero(
        decimal kilometers, decimal rateMinorPerKm, long expectedMinor)
    {
        Assert.Equal(expectedMinor, FinancialValues.CalculateDrivingMinor(kilometers, rateMinorPerKm));
    }

    public static IEnumerable<object[]> DrivingCases =>
    [
        [10.25m, 50.0000m, 513L],
        [1m, 0.5m, 1L],
        [10.125m, 30m, 304L]
    ];

    [Theory]
    [MemberData(nameof(NonpositiveCases))]
    public void Driving_amount_rejects_nonpositive_distance_or_rate(decimal kilometers, decimal rateMinorPerKm)
    {
        AssertInvalid(() => FinancialValues.CalculateDrivingMinor(kilometers, rateMinorPerKm));
    }

    public static IEnumerable<object[]> NonpositiveCases =>
    [
        [0m, 1m],
        [-0.001m, 1m],
        [1m, 0m],
        [1m, -0.5m]
    ];

    [Fact]
    public void Driving_amount_rejects_a_positive_product_that_rounds_to_zero()
    {
        AssertInvalid(() => FinancialValues.CalculateDrivingMinor(0.001m, 0.1m));
    }

    [Theory]
    [MemberData(nameof(ExcessPrecisionCases))]
    public void Driving_amount_rejects_distance_over_three_or_rate_over_four_decimal_places(
        decimal kilometers, decimal rateMinorPerKm)
    {
        AssertInvalid(() => FinancialValues.CalculateDrivingMinor(kilometers, rateMinorPerKm));
    }

    public static IEnumerable<object[]> ExcessPrecisionCases =>
    [
        [0.0001m, 1m],
        [1m, 1.00001m]
    ];

    [Fact]
    public void Driving_amount_rejects_results_outside_the_safe_integer_range()
    {
        AssertInvalid(() => FinancialValues.CalculateDrivingMinor(9_007_199_254_740_992m, 1m));
        AssertInvalid(() => FinancialValues.CalculateDrivingMinor(decimal.MaxValue, 2m));
    }

    private static void AssertInvalid(Action action)
    {
        var exception = Record.Exception(action);
        Assert.NotNull(exception);
        Assert.True(exception is ArgumentException or OverflowException,
            $"Expected an argument/overflow validation error, received {exception.GetType().Name}.");
    }
}
