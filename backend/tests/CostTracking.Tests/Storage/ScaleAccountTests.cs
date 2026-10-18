using CostTracking.Api.Domain;
using CostTracking.Api.Storage;
using CostTracking.Tests.Fixtures;
using System.Security.Cryptography;
using System.Text.Json;

namespace CostTracking.Tests.Storage;

public sealed class ScaleAccountTests
{
    [Fact]
    public void Scale_fixture_replays_one_hundred_horses_and_five_thousand_diversified_changes()
    {
        var events = ScaleAccount.Create();

        Assert.Equal(5_176, events.Count);
        Assert.Equal(5_176, AccountProjection.Replay(ScaleAccount.Subject, events).StreamVersion);
        Assert.Equal(100, HorseProjection.Replay(events).Count);
        Assert.Equal(1_500, ExpenseProjection.Replay(events).Count);
        Assert.Equal(1_750, IncomeProjection.Replay(events).Count);
        Assert.Equal(1_000, HorseTaskProjection.Replay(events).Count);
        Assert.Equal(500, events.Count(item => item.Type == "RecurringExpenseOccurrenceOverridden"));
        Assert.Equal(250, events.Count(item => item.Type == "RecurringIncomeApproved"));
        Assert.Equal(250, events.Count(item => item.Type == "RecurringIncomeRejected"));
        Assert.Equal(5_176, events.Select(item => item.IdempotencyKey).Distinct().Count());
        Assert.Equal(75, events.Count(item => item.Type is "RecurringExpenseRuleCreated" or "RecurringIncomeRuleCreated"));
        Assert.Equal(500, ExpenseProjection.Replay(events).Count(item => item.Driving is not null));

        var serializer = new EventSerializer();
        foreach (var item in events)
        {
            var roundTrip = serializer.Deserialize(serializer.Serialize(item));
            Assert.Equal(item.EventId, roundTrip.EventId);
            Assert.Equal(item.StreamVersion, roundTrip.StreamVersion);
            Assert.Equal(item.IdempotencyKey, roundTrip.IdempotencyKey);
            Assert.Equal(item.Type, roundTrip.Type);
            Assert.Equal(item.Payload.GetRawText(), roundTrip.Payload.GetRawText());
        }

        var month = FinancialReports.Monthly(events, ScaleAccount.Subject, new DateOnly(2026, 9, 21),
            new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30));
        Assert.Equal(new DateOnly(2026, 9, 1), month.From);
        Assert.True(month.Items.Count > 0);
        Assert.True(month.Items.Sum(item => item.IncomeMinor) > 0);
        Assert.True(month.Items.Sum(item => item.ExpenseMinor) > 0);
    }

    [Fact]
    public void Authoritative_replay_remains_equivalent_after_the_five_thousand_change_boundary()
    {
        var baseline = ScaleAccount.Create();
        var horseId = HorseProjection.Replay(baseline).First().HorseId;
        using var payload = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            taskId = Guid.Parse("10000000-0000-4000-8000-000000999999"),
            horseId,
            taskDate = new DateOnly(2026, 9, 21),
            taskType = "PaddockDuty",
            minutes = 0,
            quantity = 1m,
            quantityUnit = "feed portions",
            notes = "Boundary replay"
        }));
        var boundaryEvent = new EventEnvelope(
            Guid.Parse("10000000-0000-4000-8000-000000999998"),
            ScaleAccount.AcceptedChangeCount + 1 + 176,
            1,
            "TaskLogged",
            ScaleAccount.Subject,
            new DateTimeOffset(2026, 9, 21, 12, 0, 0, TimeSpan.Zero).AddSeconds(ScaleAccount.AcceptedChangeCount + 1),
            Guid.Parse("10000000-0000-4000-8000-000000999997"),
            Convert.ToHexStringLower(SHA256.HashData("scale-boundary"u8)),
            payload.RootElement.Clone());
        var beyondBoundary = baseline.Append(boundaryEvent).ToArray();

        var serializer = new EventSerializer();
        var replayed = beyondBoundary.Select(item => serializer.Deserialize(serializer.Serialize(item))).ToArray();
        Assert.Equal(5_001, replayed.Length - 176);
        Assert.Equal(5_177, AccountProjection.Replay(ScaleAccount.Subject, replayed).StreamVersion);
        Assert.Equal(1_001, HorseTaskProjection.Replay(replayed).Count);

        var before = FinancialReports.Monthly(baseline, ScaleAccount.Subject, ScaleAccount.AsOfDate,
            ScaleAccount.WindowFrom, ScaleAccount.WindowThrough);
        var after = FinancialReports.Monthly(replayed, ScaleAccount.Subject, ScaleAccount.AsOfDate,
            ScaleAccount.WindowFrom, ScaleAccount.WindowThrough);
        Assert.Equal(before.Currency, after.Currency);
        Assert.Equal(before.Items, after.Items);
        Assert.Equal(5_176, before.StreamVersion);
        Assert.Equal(5_177, after.StreamVersion);
    }
}
