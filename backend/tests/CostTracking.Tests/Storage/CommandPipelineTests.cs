using System.Text.Json;
using CostTracking.Api.Domain;
using CostTracking.Api.Storage;
using CostTracking.Tests.Fixtures;

namespace CostTracking.Tests.Storage;

public sealed class CommandPipelineTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "cost-pipeline-" + Guid.NewGuid().ToString("N"));
    private const string Subject = "user_Alice";
    private static readonly DateTimeOffset Now = new(2026, 9, 21, 12, 0, 0, TimeSpan.Zero);
    private static SubjectLock LocalLock() => new((_, _) => 0);
    private static JsonElement Body(string json = "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}") => JsonDocument.Parse(json).RootElement.Clone();
    private static CommandRequest Request(Guid key, long version = 0, string json = "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}") => new("POST", "/api/account", Body(json), key, version);
    private CommandPipeline Pipeline(JsonlEventStore? store = null) => new(store ?? new JsonlEventStore(root, LocalLock()), new FixedClock(Now), Guid.NewGuid);

    private static EventData Decide(IReadOnlyList<EventEnvelope> _) => new("AccountConfigured", Body());
    private static CommandResponse Respond(EventEnvelope accepted, IReadOnlyList<EventEnvelope> prefix) => new(200,
        JsonDocument.Parse($"{{\"version\":{prefix.Count},\"etag\":\"\\\"{prefix.Count}\\\"\"}}").RootElement.Clone(), prefix.Count);
    private static Task<CommandResponse> Execute(CommandPipeline pipeline, CommandRequest request, string subject = Subject,
        Func<IReadOnlyList<EventEnvelope>, EventData>? decide = null,
        Func<EventEnvelope, IReadOnlyList<EventEnvelope>, CommandResponse>? respond = null) =>
        pipeline.ExecuteAsync(subject, request, decide ?? Decide, respond ?? Respond);

    [Fact]
    public void Replay_rejects_gaps_wrong_subject_type_schema_and_duplicate_keys()
    {
        var first = EventStoreTests.Event(1, Subject);
        Assert.Throws<InvalidDataException>(() => AccountProjection.Replay(Subject, [first with { StreamVersion = 2 }]));
        Assert.Throws<InvalidDataException>(() => AccountProjection.Replay(Subject, [first with { Subject = "user_Bob" }]));
        Assert.Throws<InvalidDataException>(() => AccountProjection.Replay(Subject, [first with { Type = "UnknownEvent" }]));
        Assert.Throws<InvalidDataException>(() => AccountProjection.Replay(Subject, [first with { SchemaVersion = 2 }]));
        Assert.Throws<InvalidDataException>(() => AccountProjection.Replay(Subject,
            [first, EventStoreTests.Event(2, Subject) with { IdempotencyKey = first.IdempotencyKey }]));
    }

    [Fact]
    public void Replay_accepts_a_contiguous_stream()
    {
        var first = EventStoreTests.Event(1, Subject);
        var second = EventStoreTests.Event(2, Subject) with { IdempotencyKey = Guid.NewGuid() };
        var projection = AccountProjection.Replay(Subject, [first, second]);
        Assert.Equal(2, projection.StreamVersion);
        Assert.Equal([first, second], projection.Events);
    }

    [Fact]
    public void Hash_is_canonical_for_property_order_and_decimal_spelling_but_rejects_duplicate_properties()
    {
        Assert.Equal(CommandPipeline.Hash("post", "/api/account", Body("{\"a\":1,\"b\":2.0}")),
            CommandPipeline.Hash("POST", "/api/account", Body("{\"b\":2.00,\"a\":1.0}")));
        Assert.Throws<JsonException>(() => CommandPipeline.Hash("POST", "/api/account", Body("{\"a\":1,\"a\":2}")));
    }

    [Fact]
    public async Task Same_key_retry_returns_original_response_and_etag_after_later_command()
    {
        var pipeline = Pipeline(); var key = Guid.NewGuid();
        var original = await Execute(pipeline, Request(key));
        await Execute(pipeline, Request(Guid.NewGuid(), 1));
        var retry = await Execute(pipeline, Request(key, 0));
        AssertEquivalent(original, retry);
        Assert.Equal(1, retry.StreamVersion);
        Assert.Equal("\"1\"", retry.Body.GetProperty("etag").GetString());
    }

    [Fact]
    public async Task Reused_key_with_changed_body_conflicts_and_stale_version_conflicts()
    {
        var pipeline = Pipeline(); var key = Guid.NewGuid();
        await Execute(pipeline, Request(key));
        var changed = await Assert.ThrowsAsync<CommandConflictException>(() => Execute(pipeline, Request(key, 0, "{\"currency\":\"USD\"}")));
        Assert.Equal("idempotency_conflict", changed.Code);
        var stale = await Assert.ThrowsAsync<CommandConflictException>(() => Execute(pipeline, Request(Guid.NewGuid(), 0)));
        Assert.Equal("version_conflict", stale.Code);
    }

    [Fact]
    public async Task Same_version_divergent_commands_and_same_key_race_are_serialized()
    {
        var pipeline = Pipeline();
        var results = await Task.WhenAll(Enumerable.Range(0, 2).Select(i => Task.Run(async () =>
        {
            try { return (Response: await Execute(pipeline, Request(Guid.NewGuid(), 0, $"{{\"currency\":\"{(i == 0 ? "EUR" : "USD")}\"}}")), Error: (string?)null); }
            catch (CommandConflictException ex) { return (Response: (CommandResponse?)null, Error: ex.Code); }
        })));
        Assert.Single(results, x => x.Response is not null);
        Assert.Single(results, x => x.Error == "version_conflict");

        var fresh = Pipeline(); var sameKey = Guid.NewGuid();
        var retries = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => Execute(fresh, Request(sameKey, 1))));
        AssertEquivalent(retries[0], retries[1]);
        Assert.Equal(2, (await new JsonlEventStore(root, LocalLock()).ReadAsync(Subject)).Count);
    }

    private static void AssertEquivalent(CommandResponse expected, CommandResponse actual)
    {
        Assert.Equal(expected.StatusCode, actual.StatusCode);
        Assert.Equal(expected.StreamVersion, actual.StreamVersion);
        Assert.Equal(expected.Body.GetRawText(), actual.Body.GetRawText());
    }

    [Fact]
    public async Task Retry_after_response_loss_returns_durable_original_result()
    {
        var flushes = 0;
        var store = new JsonlEventStore(root, LocalLock(), file => { file.Flush(true); Interlocked.Increment(ref flushes); });
        var key = Guid.NewGuid(); var request = Request(key);
        await Assert.ThrowsAsync<IOException>(() => Execute(Pipeline(store), request, respond: (_, _) => throw new IOException("lost response")));
        Assert.Equal(1, flushes);
        var recovered = await Execute(Pipeline(new JsonlEventStore(root, LocalLock())), request);
        Assert.Equal(1, recovered.StreamVersion);
        Assert.Equal("\"1\"", recovered.Body.GetProperty("etag").GetString());
    }

    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }
}
