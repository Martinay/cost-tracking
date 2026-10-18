using CostTracking.Api.Domain;

namespace CostTracking.Tests.Domain;

public sealed class ScheduleTests
{
    [Fact]
    public void Daily_cadence_steps_by_calendar_days_from_the_original_start_and_includes_bounds()
    {
        var schedule = New(Cadence.Daily, interval: 2, start: D(2026, 10, 5), end: D(2026, 10, 12));

        var dates = ScheduleExpansion.Expand(schedule, D(2026, 10, 6), D(2026, 10, 12));

        Assert.Equal([D(2026, 10, 7), D(2026, 10, 9), D(2026, 10, 11)], dates);
        Assert.Empty(ScheduleExpansion.Expand(schedule, D(2026, 10, 13), D(2026, 10, 14)));
    }

    [Fact]
    public void Weekly_cadence_occurs_on_the_start_weekday_every_interval_weeks()
    {
        var schedule = New(Cadence.Weekly, interval: 2, start: D(2026, 10, 7)); // Wednesday

        var dates = ScheduleExpansion.Expand(schedule, D(2026, 10, 1), D(2026, 11, 4));

        Assert.Equal([D(2026, 10, 7), D(2026, 10, 21), D(2026, 11, 4)], dates);
    }

    [Fact]
    public void Weekdays_cadence_emits_only_selected_iso_weekdays_on_or_after_start()
    {
        var schedule = New(Cadence.Weekdays, interval: 1, start: D(2026, 10, 2), weekdays: [1, 5]); // Friday

        var dates = ScheduleExpansion.Expand(schedule, D(2026, 10, 1), D(2026, 10, 9));

        Assert.Equal([D(2026, 10, 2), D(2026, 10, 5), D(2026, 10, 9)], dates);
    }

    [Theory]
    [InlineData(2024, 29)]
    [InlineData(2023, 28)]
    public void Monthly_cadence_clamps_day_31_to_each_month_end(int year, int februaryDay)
    {
        var schedule = New(Cadence.Monthly, interval: 1, start: D(year, 1, 1), dayOfMonth: 31);

        var dates = ScheduleExpansion.Expand(schedule, D(year, 1, 1), D(year, 3, 31));

        Assert.Equal([D(year, 1, 31), D(year, 2, februaryDay), D(year, 3, 31)], dates);
    }

    [Fact]
    public void Monthly_cadence_keeps_the_start_month_anchor_and_excludes_candidate_before_start()
    {
        var schedule = New(Cadence.Monthly, interval: 2, start: D(2026, 1, 31), dayOfMonth: 30);

        var dates = ScheduleExpansion.Expand(schedule, D(2026, 1, 1), D(2026, 7, 31));

        Assert.Equal([D(2026, 3, 30), D(2026, 5, 30), D(2026, 7, 30)], dates);
    }

    [Fact]
    public void Date_only_daily_expansion_has_no_dst_gaps_or_duplicate_dates()
    {
        var schedule = New(Cadence.Daily, interval: 1, start: D(2026, 3, 27));

        var dates = ScheduleExpansion.Expand(schedule, D(2026, 3, 27), D(2026, 4, 2));

        Assert.Equal(7, dates.Count);
        Assert.Equal(7, dates.Distinct().Count());
        Assert.Equal(D(2026, 3, 29), dates[2]);
        Assert.Equal(D(2026, 4, 2), dates[^1]);
    }

    [Fact]
    public void Schedule_validates_cadence_specific_fields_and_interval_bounds()
    {
        AssertInvalid(() => New(Cadence.Daily, interval: 0, start: D(2026, 1, 1)));
        AssertInvalid(() => New(Cadence.Weekly, interval: 367, start: D(2026, 1, 1)));
        AssertInvalid(() => New(Cadence.Weekdays, interval: 2, start: D(2026, 1, 1), weekdays: [1]));
        AssertInvalid(() => New(Cadence.Weekdays, interval: 1, start: D(2026, 1, 1)));
        AssertInvalid(() => New(Cadence.Weekdays, interval: 1, start: D(2026, 1, 1), weekdays: [1, 1]));
        AssertInvalid(() => New(Cadence.Weekdays, interval: 1, start: D(2026, 1, 1), weekdays: [0]));
        AssertInvalid(() => New(Cadence.Weekly, interval: 1, start: D(2026, 1, 1), weekdays: [1]));
        AssertInvalid(() => New(Cadence.Monthly, interval: 1, start: D(2026, 1, 1)));
        AssertInvalid(() => New(Cadence.Monthly, interval: 1, start: D(2026, 1, 1), dayOfMonth: 0));
        AssertInvalid(() => New(Cadence.Daily, interval: 1, start: D(2026, 1, 1), dayOfMonth: 31));
        AssertInvalid(() => New(Cadence.Monthly, interval: 1, start: D(2026, 1, 1), dayOfMonth: 31, weekdays: [1]));
        AssertInvalid(() => New(Cadence.Daily, interval: 1, start: D(2026, 1, 2), end: D(2026, 1, 1)));
    }

    [Fact]
    public void Expansion_clamps_to_inclusive_schedule_end_and_rejects_invalid_or_overbudget_windows()
    {
        var schedule = New(Cadence.Daily, interval: 1, start: D(2026, 1, 1), end: D(2026, 1, 3));

        Assert.Equal([D(2026, 1, 1), D(2026, 1, 2), D(2026, 1, 3)],
            ScheduleExpansion.Expand(schedule, D(2026, 1, 1), D(2026, 1, 10)));
        AssertInvalid(() => ScheduleExpansion.Expand(schedule, D(2026, 1, 3), D(2026, 1, 2)));
        AssertInvalid(() => ScheduleExpansion.Expand(schedule, D(2026, 1, 1), D(2031, 1, 1)));

        var leapStart = D(2024, 2, 29);
        var leapSchedule = New(Cadence.Daily, interval: 1, start: leapStart);
        AssertInvalid(() => ScheduleExpansion.Expand(leapSchedule, leapStart, D(2029, 2, 28)));
        Assert.Empty(ScheduleExpansion.Expand(schedule, D(2026, 1, 4), D(2026, 1, 10)));
    }

    private static Schedule New(Cadence cadence, int interval, DateOnly start, DateOnly? end = null,
        int[]? weekdays = null, int? dayOfMonth = null) =>
        new(cadence, interval, weekdays ?? [], dayOfMonth, start, end);

    private static DateOnly D(int year, int month, int day) => new(year, month, day);

    private static void AssertInvalid(Action action)
    {
        var exception = Record.Exception(action);
        Assert.NotNull(exception);
        Assert.True(exception is ArgumentException or InvalidOperationException,
            $"Expected a schedule/window validation error, received {exception.GetType().Name}.");
    }
}
