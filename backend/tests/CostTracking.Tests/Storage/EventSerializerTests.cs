using System.Text;
using System.Text.Json;
using CostTracking.Api.Storage;
using CostTracking.Tests.Contracts;

namespace CostTracking.Tests.Storage;

public class EventSerializerTests
{
    [Fact]
    public void Round_trip_is_one_compact_schema_valid_event()
    {
        var serializer = new EventSerializer();
        var value = EventStoreTests.Event();
        var bytes = serializer.Serialize(value);
        Assert.True(EventSchemaTests.IsValid(Encoding.UTF8.GetString(bytes)));
        Assert.DoesNotContain((byte)'\n', bytes);
        var restored = serializer.Deserialize(bytes);
        Assert.Equal(value.EventId, restored.EventId);
        Assert.Equal(value.Payload.GetRawText(), restored.Payload.GetRawText());
    }

    [Theory]
    [InlineData("ZZZ", "Europe/Berlin")]
    [InlineData("EUR", "not-a-zone")]
    [InlineData("EUR", "W. Europe Standard Time")]
    public void Rejects_invalid_account_configuration_semantics(string currency, string timeZone)
    {
        var value = EventStoreTests.Event() with { Payload = JsonSerializer.SerializeToElement(new { currency, timeZone }) };
        Assert.Throws<InvalidDataException>(() => new EventSerializer().Serialize(value));
    }

    [Fact]
    public void Rejects_duplicate_properties_invalid_utf8_unknown_type_and_non_utc_timestamp()
    {
        var serializer = new EventSerializer();
        Assert.Throws<InvalidDataException>(() => serializer.Serialize(EventStoreTests.Event() with { Type = "Unknown" }));
        Assert.Throws<InvalidDataException>(() => serializer.Serialize(EventStoreTests.Event() with { OccurredAt = DateTimeOffset.Parse("2026-09-21T14:00:00+02:00") }));
        var valid = Encoding.UTF8.GetString(serializer.Serialize(EventStoreTests.Event()));
        Assert.Throws<InvalidDataException>(() => serializer.Deserialize(Encoding.UTF8.GetBytes(valid.Replace("\"schemaVersion\":1", "\"schemaVersion\":1,\"schemaVersion\":1"))));
        Assert.Throws<InvalidDataException>(() => serializer.Deserialize([0xff]));
    }

    [Theory]
    [InlineData("HorseRegistered")]
    [InlineData("ExpenseRecorded")]
    [InlineData("IncomeRecorded")]
    public void Entity_event_identifiers_must_not_be_the_nil_uuid(string type)
    {
        var horseId = Guid.NewGuid();
        object payload = type switch
        {
            "HorseRegistered" => new { horseId = Guid.Empty, name = "Misty", breed = "Arabian", dateOfBirth = (string?)null, status = "Active" },
            "ExpenseRecorded" => new { expenseId = Guid.Empty, expenseDate = "2026-09-21", amountMinor = 100L, category = "Feed",
                description = "Hay", allocations = new[] { new { horseId, weight = 1_000_000, amountMinor = 100L } }, splitMode = "Equal", driving = (object?)null },
            _ => new { incomeId = Guid.Empty, receivedDate = "2026-09-21", amountMinor = 100L, source = "Lessons",
                allocations = new[] { new { horseId, weight = 1_000_000, amountMinor = 100L } }, splitMode = "Equal" }
        };
        var value = EventStoreTests.Event() with { Type = type, Payload = JsonSerializer.SerializeToElement(payload) };

        Assert.Throws<InvalidDataException>(() => new EventSerializer().Serialize(value));
    }

    [Fact]
    public void Task_logged_accepts_valid_quantity_only_and_rejects_invalid_effort_pairing()
    {
        var serializer = new EventSerializer();
        var valid = EventStoreTests.Event() with
        {
            Type = "TaskLogged",
            Payload = JsonSerializer.SerializeToElement(new
            {
                taskId = Guid.NewGuid(), horseId = Guid.NewGuid(), taskDate = "2026-10-01", taskType = "PaddockDuty",
                minutes = 0, quantity = 2.5m, quantityUnit = "hours", notes = "Rotation"
            })
        };

        Assert.Equal("TaskLogged", serializer.Deserialize(serializer.Serialize(valid)).Type);

        var invalid = valid with { Payload = JsonSerializer.SerializeToElement(new
        {
            taskId = Guid.NewGuid(), horseId = Guid.NewGuid(), taskDate = "2026-10-01", taskType = "Riding",
            minutes = 0, quantity = (decimal?)null, quantityUnit = (string?)null, notes = ""
        }) };
        Assert.Throws<InvalidDataException>(() => serializer.Serialize(invalid));
    }

    [Theory]
    [InlineData("RecurringExpenseRuleCreated")]
    [InlineData("RecurringExpenseRuleUpdated")]
    [InlineData("RecurringExpenseRuleStopped")]
    [InlineData("RecurringExpenseOccurrenceOverridden")]
    public void Recurring_expense_events_round_trip_through_the_canonical_serializer(string type)
    {
        var payload = type switch
        {
            "RecurringExpenseRuleCreated" or "RecurringExpenseRuleUpdated" => new
            {
                ruleId = Guid.NewGuid(), effectiveFrom = "2026-10-01",
                schedule = new { cadence = "Monthly", interval = 1, weekdays = Array.Empty<int>(), dayOfMonth = 1, startDate = "2026-10-01", endDate = (string?)null },
                defaults = new { amountMinor = 100L, category = "Feed", description = "Hay", splitMode = "Equal", allocations = new[] { new { horseId = Guid.NewGuid(), weight = 1_000_000, amountMinor = 100L } } }
            },
            "RecurringExpenseRuleStopped" => (object)new { ruleId = Guid.NewGuid(), lastDate = "2026-12-01" },
            _ => new { ruleId = Guid.NewGuid(), scheduledDate = "2026-11-01", action = "Skipped", changed = (object?)null }
        };
        var value = EventStoreTests.Event() with { Type = type, Payload = JsonSerializer.SerializeToElement(payload) };

        Assert.Equal(type, new EventSerializer().Deserialize(new EventSerializer().Serialize(value)).Type);
    }

    [Theory]
    [InlineData("RecurringExpenseRuleCreated", "invalid")]
    [InlineData("RecurringExpenseOccurrenceOverridden", "invalid")]
    public void Recurring_expense_events_reject_invalid_semantic_enum_values(string type, string invalid)
    {
        object payload = type == "RecurringExpenseRuleCreated"
            ? new { ruleId = Guid.NewGuid(), effectiveFrom = "2026-10-01", schedule = new { cadence = invalid, interval = 1, weekdays = Array.Empty<int>(), dayOfMonth = 1, startDate = "2026-10-01", endDate = (string?)null }, defaults = new { amountMinor = 100L, category = "Feed", description = "Hay", splitMode = "Equal", allocations = new[] { new { horseId = Guid.NewGuid(), weight = 1_000_000, amountMinor = 100L } } } }
            : new { ruleId = Guid.NewGuid(), scheduledDate = "2026-11-01", action = invalid, changed = (object?)null };
        var value = EventStoreTests.Event() with { Type = type, Payload = JsonSerializer.SerializeToElement(payload) };

        Assert.Throws<InvalidDataException>(() => new EventSerializer().Serialize(value));
    }

    [Theory]
    [InlineData("RecurringIncomeRuleCreated")]
    [InlineData("RecurringIncomeRuleUpdated")]
    [InlineData("RecurringIncomeRuleStopped")]
    [InlineData("RecurringIncomeApproved")]
    [InlineData("RecurringIncomeRejected")]
    public void Recurring_income_events_round_trip_through_the_canonical_serializer(string type)
    {
        var ruleId = Guid.NewGuid();
        var horseId = Guid.NewGuid();
        object payload = type switch
        {
            "RecurringIncomeRuleCreated" or "RecurringIncomeRuleUpdated" => new
            {
                ruleId, effectiveFrom = "2026-10-01",
                schedule = new { cadence = "Monthly", interval = 1, weekdays = Array.Empty<int>(), dayOfMonth = 1, startDate = "2026-10-01", endDate = (string?)null },
                defaults = new { amountMinor = 100L, source = "Lessons", splitMode = "Equal", allocations = new[] { new { horseId, weight = 1_000_000, amountMinor = 100L } } }
            },
            "RecurringIncomeRuleStopped" => new { ruleId, lastDate = "2026-12-01" },
            "RecurringIncomeApproved" => new { ruleId, scheduledDate = "2026-10-01", receivedDate = "2026-10-01", amountMinor = 100L,
                allocations = new[] { new { horseId, weight = 1_000_000, amountMinor = 100L } }, nextDueDate = (string?)null, splitMode = "Equal" },
            _ => new { ruleId, scheduledDate = "2026-10-01", nextDueDate = (string?)null }
        };
        var value = EventStoreTests.Event() with { Type = type, Payload = JsonSerializer.SerializeToElement(payload) };

        Assert.Equal(type, new EventSerializer().Deserialize(new EventSerializer().Serialize(value)).Type);
    }

    [Theory]
    [InlineData("RecurringExpenseRuleCreated")]
    [InlineData("RecurringIncomeRuleCreated")]
    public void Initial_recurring_rule_event_must_start_on_its_effective_date(string type)
    {
        var ruleId = Guid.NewGuid();
        var horseId = Guid.NewGuid();
        object payload = type == "RecurringExpenseRuleCreated"
            ? new
            {
                ruleId, effectiveFrom = "2026-10-02",
                schedule = new { cadence = "Daily", interval = 1, weekdays = Array.Empty<int>(), dayOfMonth = (int?)null, startDate = "2026-10-01", endDate = (string?)null },
                defaults = new { amountMinor = 100L, category = "Feed", description = "Hay", splitMode = "Equal", allocations = new[] { new { horseId, weight = 1_000_000, amountMinor = 100L } } }
            }
            : new
            {
                ruleId, effectiveFrom = "2026-10-02",
                schedule = new { cadence = "Daily", interval = 1, weekdays = Array.Empty<int>(), dayOfMonth = (int?)null, startDate = "2026-10-01", endDate = (string?)null },
                defaults = new { amountMinor = 100L, source = "Lessons", splitMode = "Equal", allocations = new[] { new { horseId, weight = 1_000_000, amountMinor = 100L } } }
            };
        var value = EventStoreTests.Event() with { Type = type, Payload = JsonSerializer.SerializeToElement(payload) };

        Assert.Throws<InvalidDataException>(() => new EventSerializer().Serialize(value));
    }
}
