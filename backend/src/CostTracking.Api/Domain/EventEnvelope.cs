using System.Text.Json;

namespace CostTracking.Api.Domain;

public sealed record EventEnvelope(Guid EventId, long StreamVersion, int SchemaVersion, string Type,
    string Subject, DateTimeOffset OccurredAt, Guid IdempotencyKey, string CommandHash, JsonElement Payload);
