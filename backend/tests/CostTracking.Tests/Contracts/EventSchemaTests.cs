using System.Text.Json;
using System.Text.Json.Nodes;
using CostTracking.Api.Domain;
using CostTracking.Api.Storage;
using Json.Schema;

namespace CostTracking.Tests.Contracts;

public class EventSchemaTests
{
    private static readonly JsonSchema Schema = LoadSchema();
    private const string Valid = """
        {"eventId":"00000000-0000-4000-8000-000000000001","streamVersion":1,"schemaVersion":1,"type":"AccountConfigured","subject":"user_Alice","occurredAt":"2026-09-21T12:00:00Z","idempotencyKey":"00000000-0000-4000-8000-000000000002","commandHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","payload":{"currency":"EUR","timeZone":"Europe/Berlin"}}
        """;

    private static JsonSchema LoadSchema()
    {
        var assembly = typeof(Program).Assembly;
        var name = Assert.Single(assembly.GetManifestResourceNames(), n => n.EndsWith("events-v1.schema.json", StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(name)!;
        return JsonSchema.Build(JsonDocument.Parse(stream).RootElement, new BuildOptions { SchemaRegistry = new SchemaRegistry() });
    }

    public static bool IsValid(string json) => Schema.Evaluate(JsonDocument.Parse(json).RootElement,
        new EvaluationOptions { RequireFormatValidation = true }).IsValid;

    [Fact]
    public void Canonical_account_fixture_is_valid() => Assert.True(IsValid(Valid));

    [Theory]
    [InlineData("eventId", "not-a-uuid")]
    [InlineData("occurredAt", "not-a-timestamp")]
    [InlineData("subject", "org_123")]
    [InlineData("type", "UnknownEvent")]
    public void Invalid_formats_subjects_and_variants_are_rejected(string property, string value)
    {
        var node = JsonNode.Parse(Valid)!;
        node[property] = value;
        Assert.False(IsValid(node.ToJsonString()));
    }

    [Fact]
    public void Unknown_and_missing_fields_are_rejected()
    {
        var node = JsonNode.Parse(Valid)!.AsObject();
        node["balance"] = 100;
        Assert.False(IsValid(node.ToJsonString()));
        node.Remove("balance");
        node.Remove("commandHash");
        Assert.False(IsValid(node.ToJsonString()));
    }

    [Fact]
    public void Story_event_fixture_covers_all_variants_and_replays_their_projections()
    {
        var fixturePath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "Events", "story-events-v1.jsonl");
        var lines = File.ReadAllLines(fixturePath);
        var serializer = new EventSerializer();
        var events = lines.Select(line => serializer.Deserialize(System.Text.Encoding.UTF8.GetBytes(line))).ToArray();
        var expectedTypes = new[]
        {
            "AccountConfigured", "HorseRegistered", "HorseDetailsUpdated", "DrivingRateChanged", "ExpenseRecorded",
            "RecurringExpenseRuleCreated", "RecurringExpenseRuleUpdated", "RecurringExpenseOccurrenceOverridden",
            "IncomeRecorded", "RecurringIncomeRuleCreated", "RecurringIncomeRuleUpdated", "RecurringIncomeApproved",
            "RecurringIncomeRejected", "RecurringIncomeRuleStopped", "TaskLogged", "RecurringExpenseRuleStopped",
            "HorseStatusChanged"
        };

        Assert.Equal(expectedTypes, events.Select(item => item.Type));
        Assert.Equal(17, AccountProjection.Replay("user_Alice", events).StreamVersion);
        Assert.Equal(HorseStatus.Sold, Assert.Single(HorseProjection.Replay(events)).Status);
        Assert.Single(Assert.Single(ExpenseProjection.Replay(events)).Allocations);
        Assert.Equal(new[] { "OneTime", "Recurring" }, IncomeProjection.Replay(events).Select(item => item.Origin));
        Assert.Equal(45, Assert.Single(HorseTaskProjection.Replay(events)).Minutes);
    }

    [Fact]
    public void Each_story_event_variant_rejects_a_missing_required_payload_field()
    {
        var fixturePath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "Events", "story-events-v1.jsonl");
        var serializer = new EventSerializer();

        foreach (var line in File.ReadAllLines(fixturePath))
        {
            var node = JsonNode.Parse(line)!.AsObject();
            var payload = node["payload"]!.AsObject();
            var requiredField = payload.Last().Key;
            payload.Remove(requiredField);
            var invalid = node.ToJsonString();

            Assert.False(IsValid(invalid), $"Schema unexpectedly accepted {node["type"]} without {requiredField}.");
            Assert.Throws<InvalidDataException>(() => serializer.Deserialize(System.Text.Encoding.UTF8.GetBytes(invalid)));
        }
    }
}
