using System.Text.Json;
using CostTracking.Api.Domain;

namespace CostTracking.Tests.Domain;

public sealed class AccountHorseProjectionTests
{
    private const string Subject = "user_ProjectionTests";
    private static readonly Guid HorseId = Guid.Parse("10000000-0000-4000-8000-000000000001");

    [Fact]
    public void Account_settings_replay_starts_empty_and_clears_rate_only_when_currency_changes()
    {
        var empty = AccountProjection.Replay(Subject, []);
        Assert.Null(empty.Currency);
        Assert.Null(empty.TimeZone);
        Assert.Null(empty.DrivingRateMinorPerKm);
        Assert.False(empty.SettingsLocked);
        Assert.Equal(0, empty.StreamVersion);

        var sameCurrency = AccountProjection.Replay(Subject,
        [
            Event(1, "AccountConfigured", new { currency = "EUR", timeZone = "Europe/Berlin" }),
            Event(2, "DrivingRateChanged", new { rateMinorPerKm = 30m }),
            Event(3, "AccountConfigured", new { currency = "EUR", timeZone = "Europe/Paris" })
        ]);
        Assert.Equal("Europe/Paris", sameCurrency.TimeZone);
        Assert.Equal(30m, sameCurrency.DrivingRateMinorPerKm);
        Assert.False(sameCurrency.SettingsLocked);

        var changedCurrency = AccountProjection.Replay(Subject,
        [
            Event(1, "AccountConfigured", new { currency = "EUR", timeZone = "Europe/Berlin" }),
            Event(2, "DrivingRateChanged", new { rateMinorPerKm = 30m }),
            Event(3, "AccountConfigured", new { currency = "USD", timeZone = "America/New_York" })
        ]);
        Assert.Equal("USD", changedCurrency.Currency);
        Assert.Null(changedCurrency.DrivingRateMinorPerKm);
        Assert.False(changedCurrency.SettingsLocked);
    }

    [Fact]
    public void Horse_and_task_events_do_not_freeze_account_settings()
    {
        var account = AccountProjection.Replay(Subject,
        [
            Event(1, "AccountConfigured", new { currency = "EUR", timeZone = "Europe/Berlin" }),
            Event(2, "HorseRegistered", HorsePayload("Active"))
        ]);

        Assert.False(account.SettingsLocked);
        Assert.Equal(2, account.StreamVersion);
        Assert.Equal("EUR", account.Currency);

        // TaskLogged is in the canonical contract but intentionally not deserializable until its validation slice lands.
        var taskOnly = new AccountProjection(
        [
            Event(1, "AccountConfigured", new { currency = "EUR", timeZone = "Europe/Berlin" }),
            Event(2, "TaskLogged", new
            {
                taskId = Guid.NewGuid(), horseId = HorseId, taskDate = "2026-10-08", taskType = "Riding",
                minutes = 45, quantity = (decimal?)null, quantityUnit = (string?)null, notes = "schooling"
            })
        ]);
        Assert.False(taskOnly.SettingsLocked);
    }

    [Theory]
    [InlineData("ExpenseRecorded")]
    [InlineData("IncomeRecorded")]
    public void First_financial_event_freezes_account_settings(string eventType)
    {
        object financial = eventType == "ExpenseRecorded"
            ? new
            {
                expenseId = Guid.NewGuid(), expenseDate = "2026-10-08", amountMinor = 100,
                category = "Other", description = "feed", allocations = new[] { new { horseId = HorseId, weight = 1_000_000, amountMinor = 100 } },
                driving = (object?)null, splitMode = "Equal"
            }
            : new
            {
                incomeId = Guid.NewGuid(), receivedDate = "2026-10-08", amountMinor = 100,
                source = "Prize", allocations = new[] { new { horseId = HorseId, weight = 1_000_000, amountMinor = 100 } },
                splitMode = "Equal"
            };

        // These schema-known variants remain outside EventSerializer's implemented whitelist until their feature slices.
        // Exercise the projection predicate over an already validated immutable prefix without weakening that whitelist.
        var account = new AccountProjection(
        [
            Event(1, "AccountConfigured", new { currency = "EUR", timeZone = "Europe/Berlin" }),
            Event(2, eventType, financial)
        ]);

        Assert.True(account.SettingsLocked);
    }

    [Fact]
    public void Horse_replay_applies_details_and_each_distinct_status_transition_in_stream_order()
    {
        var horses = HorseProjection.Replay(
        [
            Event(1, "HorseRegistered", HorsePayload("Active")),
            Event(2, "HorseStatusChanged", new { horseId = HorseId, status = "Leased" }),
            Event(3, "HorseDetailsUpdated", HorsePayload("Leased", name: "Misty Blue", breed: "Arabian", dateOfBirth: (string?)null)),
            Event(4, "HorseStatusChanged", new { horseId = HorseId, status = "Retired" }),
            Event(5, "HorseStatusChanged", new { horseId = HorseId, status = "Sold" }),
            Event(6, "HorseStatusChanged", new { horseId = HorseId, status = "Active" })
        ]);

        var horse = Assert.Single(horses);
        Assert.Equal(HorseId, horse.HorseId);
        Assert.Equal("Misty Blue", horse.Name);
        Assert.Equal("Arabian", horse.Breed);
        Assert.Null(horse.DateOfBirth);
        Assert.Equal(HorseStatus.Active, horse.Status);
        Assert.Equal(6, horse.StreamVersion);
    }

    [Fact]
    public void Horse_replay_rejects_duplicate_registration_unknown_references_and_same_status_events()
    {
        var registered = Event(1, "HorseRegistered", HorsePayload("Active"));
        Assert.Throws<InvalidDataException>(() => HorseProjection.Replay([registered, Event(2, "HorseRegistered", HorsePayload("Active"))]));
        Assert.Throws<InvalidDataException>(() => HorseProjection.Replay([Event(1, "HorseStatusChanged", new { horseId = HorseId, status = "Sold" })]));
        Assert.Throws<InvalidDataException>(() => HorseProjection.Replay([registered,
            Event(2, "HorseDetailsUpdated", HorsePayload("Sold", name: "Misty", breed: "Arabian"))]));
        Assert.Throws<InvalidDataException>(() => HorseProjection.Replay([registered,
            Event(2, "HorseStatusChanged", new { horseId = HorseId, status = "Active" })]));
    }

    private static object HorsePayload(string status, string name = "Misty", string breed = "Arabian", string? dateOfBirth = "2018-05-01") =>
        new { horseId = HorseId, name, breed, dateOfBirth, status };

    private static EventEnvelope Event<T>(long version, string type, T payload) => new(
        Guid.NewGuid(), version, 1, type, Subject, DateTimeOffset.Parse("2026-10-08T12:00:00Z"), Guid.NewGuid(),
        new string('a', 64), JsonSerializer.SerializeToElement(payload));
}
