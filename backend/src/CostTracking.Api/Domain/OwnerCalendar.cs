namespace CostTracking.Api.Domain;

public static class OwnerCalendar
{
    public static DateOnly Today(TimeProvider clock, string? timeZone)
    {
        var now = clock.GetUtcNow();
        return timeZone is null ? DateOnly.FromDateTime(now.UtcDateTime) :
            DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(timeZone)).DateTime);
    }
}
