using System.Text.Json;
using CostTracking.Api.Domain;

namespace CostTracking.Tests.Domain;

public sealed class TaskTests
{
    private static readonly Guid HorseA = Guid.Parse("00000000-0000-0000-0000-000000000041");

    [Fact]
    public void Task_accepts_minutes_only_and_quantity_only_effort()
    {
        var horse = Horse(HorseStatus.Active);
        var minutesOnly = HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Riding, 45, null, null, "", 1);
        var quantityOnly = HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 2), TaskType.PaddockDuty, 0, 2.5m, "hours", "Rotation", 2);

        Assert.Equal(45, minutesOnly.Minutes);
        Assert.Null(minutesOnly.Quantity);
        Assert.Equal(0, quantityOnly.Minutes);
        Assert.Equal(2.5m, quantityOnly.Quantity);
        Assert.Equal("hours", quantityOnly.QuantityUnit);
    }

    [Fact]
    public void Task_requires_nonempty_identity_and_an_active_or_leased_horse()
    {
        var horse = Horse(HorseStatus.Active);
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.Empty, horse, D(2026, 10, 1), TaskType.Riding, 1, null, null, "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), null!, D(2026, 10, 1), TaskType.Riding, 1, null, null, "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), Horse(HorseStatus.Retired), D(2026, 10, 1), TaskType.Riding, 1, null, null, "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), Horse(HorseStatus.Sold), D(2026, 10, 1), TaskType.Riding, 1, null, null, "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), horse with { HorseId = Guid.Empty }, D(2026, 10, 1), TaskType.Riding, 1, null, null, "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Riding, 1, null, null, "", 0));
        Assert.NotNull(HorseTask.Create(Guid.NewGuid(), Horse(HorseStatus.Leased), D(2026, 10, 1), TaskType.Riding, 1, null, null, "", 1));
    }

    [Fact]
    public void Task_requires_positive_minutes_or_quantity_and_paired_nonempty_unit()
    {
        var horse = Horse(HorseStatus.Active);
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Riding, 0, null, null, "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Riding, -1, null, null, "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Riding, 0, 0m, "hours", "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Riding, 0, -0.1m, "hours", "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Riding, 0, 1m, null, "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Riding, 0, null, "hours", "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Riding, 0, 1m, "  ", "", 1));
    }

    [Fact]
    public void Task_enforces_safe_integer_minutes_quantity_unit_notes_and_exact_type()
    {
        var horse = Horse(HorseStatus.Active);
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Riding, 9_007_199_254_740_992L, null, null, "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), (TaskType)99, 1, null, null, "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Riding, 1, 1m, new string('u', 31), "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Riding, 1, 1m, " hours ", "", 1));
        Assert.ThrowsAny<ArgumentException>(() => HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Riding, 1, null, null, new string('n', 1001), 1));
        Assert.Equal(9_007_199_254_740_991L,
            HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Other, 9_007_199_254_740_991L, null, null, "", 1).Minutes);
        Assert.Equal(30, HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Other, 1, 1m, new string('u', 30), "", 1).QuantityUnit!.Length);
        Assert.Equal(1000, HorseTask.Create(Guid.NewGuid(), horse, D(2026, 10, 1), TaskType.Other, 1, null, null, new string('n', 1000), 1).Notes.Length);
    }

    [Fact]
    public void Replay_returns_task_rows_in_stable_date_then_id_order_and_survives_later_horse_inactivation()
    {
        var highId = Guid.Parse("00000000-0000-0000-0000-000000000099");
        var lowId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        var earliestId = Guid.Parse("00000000-0000-0000-0000-000000000050");
        var tasks = HorseTaskProjection.Replay([
            Event(1, TaskPayload(highId, HorseA, "2026-10-02", "Riding", 30, null, null, "")),
            Event(2, new { horseId = HorseA, status = "Sold" }, "HorseStatusChanged"),
            Event(3, TaskPayload(lowId, HorseA, "2026-10-02", "Grooming", 0, 1.5m, "hours", "Care")),
            Event(4, TaskPayload(earliestId, HorseA, "2026-10-01", "Groundwork", 15, null, null, "Warm up"))
        ]);

        Assert.Equal([D(2026, 10, 1), D(2026, 10, 2), D(2026, 10, 2)], tasks.Select(task => task.TaskDate));
        Assert.Equal([Guid.Parse("00000000-0000-0000-0000-000000000001"), highId], tasks.Skip(1).Select(task => task.TaskId));
        Assert.Equal(earliestId, tasks[0].TaskId);
        Assert.Equal(3, tasks[1].StreamVersion);
        Assert.Equal(1, tasks[2].StreamVersion);
    }

    [Fact]
    public void Replay_rejects_duplicate_task_ids_and_malformed_or_financially_invalid_task_payloads()
    {
        var id = Guid.NewGuid();
        Assert.Throws<InvalidDataException>(() => HorseTaskProjection.Replay([
            Event(1, TaskPayload(id, HorseA, "2026-10-01", "Riding", 1, null, null, "")),
            Event(2, TaskPayload(id, HorseA, "2026-10-02", "Riding", 1, null, null, ""))]));
        Assert.Throws<InvalidDataException>(() => HorseTaskProjection.Replay([Event(1, TaskPayload(Guid.NewGuid(), HorseA, "2026-10-01", "riding", 1, null, null, ""))]));
        Assert.Throws<InvalidDataException>(() => HorseTaskProjection.Replay([Event(1, TaskPayload(Guid.NewGuid(), HorseA, "2026-10-01", "Riding", 0, null, null, ""))]));
    }

    [Fact]
    public void Task_events_do_not_lock_settings_or_change_financial_account_values()
    {
        var configured = Event(1, new { currency = "EUR", timeZone = "Europe/Berlin" }, "AccountConfigured");
        var task = Event(2, TaskPayload(Guid.NewGuid(), HorseA, "2026-10-01", "Riding", 60, null, null, ""));
        var before = new AccountProjection([configured]);
        var after = new AccountProjection([configured, task]);

        Assert.False(before.SettingsLocked);
        Assert.False(after.SettingsLocked);
        Assert.Equal(before.Currency, after.Currency);
        Assert.Equal(before.TimeZone, after.TimeZone);
        Assert.Equal(before.DrivingRateMinorPerKm, after.DrivingRateMinorPerKm);
    }

    private static Horse Horse(HorseStatus status) => new(HorseA, "Fern", "Arabian", null, status, 1);

    private static object TaskPayload(Guid taskId, Guid horseId, string date, string type, long minutes, decimal? quantity, string? unit, string notes) => new
    {
        taskId,
        horseId,
        taskDate = date,
        taskType = type,
        minutes,
        quantity,
        quantityUnit = unit,
        notes
    };

    private static EventEnvelope Event(long streamVersion, object payload, string type = "TaskLogged")
    {
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(payload));
        return new EventEnvelope(Guid.NewGuid(), streamVersion, 1, type, "user_123", DateTimeOffset.UnixEpoch,
            Guid.NewGuid(), new string('a', 64), json.RootElement.Clone());
    }

    private static DateOnly D(int year, int month, int day) => new(year, month, day);
}
