using System.Text.Json.Serialization;

namespace CostTracking.Api.Domain;

[JsonConverter(typeof(JsonStringEnumConverter<Cadence>))]
public enum Cadence { Daily, Weekly, Weekdays, Monthly }

/// <summary>A validated date-only recurrence anchored to its original start date/month.</summary>
public sealed record Schedule
{
    public Cadence Cadence { get; }
    public int Interval { get; }
    public IReadOnlyList<int> Weekdays { get; }
    public int? DayOfMonth { get; }
    public DateOnly StartDate { get; }
    public DateOnly? EndDate { get; }

    public Schedule(Cadence cadence, int interval, IReadOnlyList<int> weekdays, int? dayOfMonth,
        DateOnly startDate, DateOnly? endDate)
    {
        ArgumentNullException.ThrowIfNull(weekdays);
        if (!Enum.IsDefined(cadence)) throw new ArgumentOutOfRangeException(nameof(cadence));
        if (interval is < 1 or > 366) throw new ArgumentOutOfRangeException(nameof(interval), "Interval must be between 1 and 366.");
        if (endDate.HasValue && endDate.Value < startDate)
            throw new ArgumentException("Schedule end date cannot precede its start date.", nameof(endDate));

        var normalizedWeekdays = weekdays.ToArray();
        if (cadence == Cadence.Weekdays)
        {
            if (interval != 1) throw new ArgumentException("Weekdays cadence requires interval 1.", nameof(interval));
            if (normalizedWeekdays.Length == 0 || normalizedWeekdays.Any(day => day is < 1 or > 7) ||
                normalizedWeekdays.Distinct().Count() != normalizedWeekdays.Length)
                throw new ArgumentException("Weekdays cadence requires distinct ISO weekdays from 1 to 7.", nameof(weekdays));
            if (dayOfMonth.HasValue) throw new ArgumentException("Weekdays cadence cannot specify dayOfMonth.", nameof(dayOfMonth));
        }
        else
        {
            if (normalizedWeekdays.Length != 0)
                throw new ArgumentException("Only Weekdays cadence may specify weekdays.", nameof(weekdays));
            if (cadence == Cadence.Monthly)
            {
                if (dayOfMonth is null or < 1 or > 31) throw new ArgumentOutOfRangeException(nameof(dayOfMonth), "Monthly cadence requires dayOfMonth from 1 to 31.");
            }
            else if (dayOfMonth.HasValue)
                throw new ArgumentException("Only Monthly cadence may specify dayOfMonth.", nameof(dayOfMonth));
        }

        Cadence = cadence;
        Interval = interval;
        Weekdays = Array.AsReadOnly(normalizedWeekdays);
        DayOfMonth = dayOfMonth;
        StartDate = startDate;
        EndDate = endDate;
    }
}
