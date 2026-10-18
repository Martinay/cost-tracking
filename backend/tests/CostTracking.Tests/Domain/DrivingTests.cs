using CostTracking.Api.Domain;

namespace CostTracking.Tests.Domain;

public sealed class DrivingTests
{
    [Theory]
    [InlineData(10.25, 50, 513)]
    [InlineData(1, 0.5, 1)]
    [InlineData(1.005, 100, 101)]
    public void Calculation_rounds_once_away_from_zero_and_retains_used_provenance(decimal kilometers, decimal rate, long expected)
    {
        var calculation = Driving.Calculate(kilometers, rate);

        Assert.Equal(expected, calculation.AmountMinor);
        Assert.Equal(kilometers, calculation.Kilometers);
        Assert.Equal(rate, calculation.RateMinorPerKm);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(-1, 1)]
    [InlineData(1.0001, 1)]
    [InlineData(1, 0)]
    [InlineData(1, -1)]
    [InlineData(1, 1.00001)]
    public void Calculation_rejects_nonpositive_or_overprecision_inputs(decimal kilometers, decimal rate)
    {
        Assert.ThrowsAny<ArgumentException>(() => Driving.Calculate(kilometers, rate));
    }

    [Fact]
    public void Calculation_rejects_rounded_zero_and_unsafe_product()
    {
        Assert.ThrowsAny<ArgumentException>(() => Driving.Calculate(0.001m, 0.0001m));
        Assert.Throws<OverflowException>(() => Driving.Calculate(FinancialValues.MaximumSafeInteger, 2));
    }
}
