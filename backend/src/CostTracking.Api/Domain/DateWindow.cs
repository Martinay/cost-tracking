namespace CostTracking.Api.Domain;

public static class DateWindow
{
    public static DateOnly MaximumThrough(DateOnly from)
    {
        try { return from.AddYears(5).AddDays(-1); }
        catch (ArgumentOutOfRangeException) { return DateOnly.MaxValue; }
    }

    public static void Validate(DateOnly from, DateOnly through)
    {
        if (through < from) throw new ArgumentException("The query end date cannot precede its start date.", nameof(through));
        if (through > MaximumThrough(from))
            throw new ArgumentOutOfRangeException(nameof(through), "Date queries may span at most five calendar years.");
    }
}
