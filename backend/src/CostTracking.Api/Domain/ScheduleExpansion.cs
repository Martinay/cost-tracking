namespace CostTracking.Api.Domain;

public static class ScheduleExpansion
{
    public static IReadOnlyList<DateOnly> Expand(Schedule schedule, DateOnly from, DateOnly through)
    {
        ArgumentNullException.ThrowIfNull(schedule);
        if (through < from) throw new ArgumentException("The end of the query window cannot precede its start.", nameof(through));
        if (through > MaximumThrough(from))
            throw new ArgumentOutOfRangeException(nameof(through), "Schedule query windows may span at most five calendar years minus one day.");

        var firstDate = from > schedule.StartDate ? from : schedule.StartDate;
        var lastDate = schedule.EndDate is { } end && end < through ? end : through;
        if (firstDate > lastDate) return Array.Empty<DateOnly>();

        var dates = new List<DateOnly>();
        switch (schedule.Cadence)
        {
            case Cadence.Daily:
                AddSteppedDays(dates, schedule.StartDate, firstDate, lastDate, schedule.Interval);
                break;
            case Cadence.Weekly:
                AddSteppedDays(dates, schedule.StartDate, firstDate, lastDate, checked(schedule.Interval * 7));
                break;
            case Cadence.Weekdays:
                AddWeekdays(dates, schedule.Weekdays, firstDate, lastDate);
                break;
            case Cadence.Monthly:
                AddMonths(dates, schedule, firstDate, lastDate);
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(schedule), "Unsupported schedule cadence.");
        }
        return dates.AsReadOnly();
    }

    /// <summary>Returns the first date strictly after the owner day, respecting revision boundaries and inclusive stops.</summary>
    public static DateOnly? NextScheduled(IEnumerable<(DateOnly EffectiveFrom, Schedule Schedule)> revisions, DateOnly? lastDate, DateOnly after)
    {
        if (after == DateOnly.MaxValue) return null;
        var ordered = revisions.OrderBy(r => r.EffectiveFrom).ToArray();
        for (var index = 0; index < ordered.Length; index++)
        {
            var revision = ordered[index];
            var start = after.AddDays(1);
            if (revision.EffectiveFrom > start) start = revision.EffectiveFrom;
            if (revision.Schedule.StartDate > start) start = revision.Schedule.StartDate;
            var end = lastDate ?? DateOnly.MaxValue;
            if (revision.Schedule.EndDate is { } stop && stop < end) end = stop;
            if (index + 1 < ordered.Length && ordered[index + 1].EffectiveFrom.AddDays(-1) < end) end = ordered[index + 1].EffectiveFrom.AddDays(-1);
            while (start <= end)
            {
                var through = MaximumThrough(start);
                if (through > end) through = end;
                var dates = Expand(revision.Schedule, start, through);
                if (dates.Count > 0) return dates[0];
                if (through == DateOnly.MaxValue) break;
                start = through.AddDays(1);
            }
        }
        return null;
    }

    private static DateOnly MaximumThrough(DateOnly from)
    {
        try { return from.AddYears(5).AddDays(-1); }
        catch (ArgumentOutOfRangeException) { return DateOnly.MaxValue; }
    }

    private static void AddSteppedDays(List<DateOnly> dates, DateOnly anchor, DateOnly firstDate, DateOnly lastDate, int stepDays)
    {
        var delta = firstDate.DayNumber - anchor.DayNumber;
        var steps = delta <= 0 ? 0L : ((long)delta + stepDays - 1) / stepDays;
        var firstOffset = checked(steps * stepDays);
        if (firstOffset > DateOnly.MaxValue.DayNumber - anchor.DayNumber) return;
        var candidate = anchor.AddDays(checked((int)firstOffset));
        if (candidate < firstDate) candidate = candidate.AddDays(stepDays);

        while (candidate <= lastDate)
        {
            dates.Add(candidate);
            var remainingDays = lastDate.DayNumber - candidate.DayNumber;
            if (remainingDays < stepDays) break;
            candidate = candidate.AddDays(stepDays);
        }
    }

    private static void AddWeekdays(List<DateOnly> dates, IReadOnlyList<int> weekdays, DateOnly firstDate, DateOnly lastDate)
    {
        var selected = weekdays.ToHashSet();
        for (var dayNumber = firstDate.DayNumber; dayNumber <= lastDate.DayNumber; dayNumber++)
        {
            var candidate = DateOnly.FromDayNumber(dayNumber);
            var isoWeekday = ((int)candidate.DayOfWeek + 6) % 7 + 1;
            if (selected.Contains(isoWeekday)) dates.Add(candidate);
        }
    }

    private static void AddMonths(List<DateOnly> dates, Schedule schedule, DateOnly firstDate, DateOnly lastDate)
    {
        var anchorMonth = schedule.StartDate.Year * 12 + schedule.StartDate.Month - 1;
        var firstMonth = firstDate.Year * 12 + firstDate.Month - 1;
        var monthsFromAnchor = firstMonth - anchorMonth;
        var steps = monthsFromAnchor <= 0 ? 0L : ((long)monthsFromAnchor + schedule.Interval - 1) / schedule.Interval;
        var monthOffset = checked(steps * schedule.Interval);
        if (monthOffset > int.MaxValue - anchorMonth) return;
        var monthIndex = anchorMonth + (int)monthOffset;

        while (monthIndex <= DateOnly.MaxValue.Year * 12 + DateOnly.MaxValue.Month - 1)
        {
            var year = monthIndex / 12;
            var month = monthIndex % 12 + 1;
            var day = Math.Min(schedule.DayOfMonth!.Value, DateTime.DaysInMonth(year, month));
            var candidate = new DateOnly(year, month, day);
            if (candidate >= schedule.StartDate && candidate >= firstDate)
            {
                if (candidate > lastDate) break;
                dates.Add(candidate);
            }
            if (monthIndex > int.MaxValue - schedule.Interval) break;
            monthIndex += schedule.Interval;
        }
    }
}
