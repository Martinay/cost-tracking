namespace CostTracking.Api.Domain;

public sealed record DrivingCalculation(long AmountMinor, decimal Kilometers, decimal RateMinorPerKm);

public static class Driving
{
    public static DrivingCalculation Calculate(decimal kilometers, decimal rateMinorPerKm)
    {
        var amountMinor = FinancialValues.CalculateDrivingMinor(kilometers, rateMinorPerKm);
        return new DrivingCalculation(amountMinor, kilometers, rateMinorPerKm);
    }
}
