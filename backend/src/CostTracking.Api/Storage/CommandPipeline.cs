using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CostTracking.Api.Domain;

namespace CostTracking.Api.Storage;

public sealed record CommandRequest(string Method, string Route, JsonElement Body, Guid Key, long ExpectedVersion);
public sealed record EventData(string Type, JsonElement Payload);
public sealed record CommandResponse(int StatusCode, JsonElement Body, long StreamVersion);
public sealed class CommandConflictException(string code, long version) : Exception(code)
{
    public string Code { get; } = code;
    public long StreamVersion { get; } = version;
}

/// <summary>Commits one event or reconstructs the original response before checking a retry's stale version.</summary>
public sealed class CommandPipeline(JsonlEventStore store, TimeProvider clock, Func<Guid> newId)
{
    public static string Hash(string method, string route, JsonElement body)
    {
        EventSerializer.RejectDuplicates(body);
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartArray();
            writer.WriteStringValue(method.ToUpperInvariant());
            writer.WriteStringValue(route);
            Canonicalize(writer, body);
            writer.WriteEndArray();
        }
        return Convert.ToHexStringLower(SHA256.HashData(buffer.ToArray()));
    }

    private static void Canonicalize(Utf8JsonWriter writer, JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in value.EnumerateObject().OrderBy(p => p.Name, StringComparer.Ordinal))
                {
                    writer.WritePropertyName(property.Name);
                    Canonicalize(writer, property.Value);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in value.EnumerateArray()) Canonicalize(writer, item);
                writer.WriteEndArray();
                break;
            case JsonValueKind.Number:
                if (!value.TryGetDecimal(out var number)) throw new JsonException("Number exceeds supported precision.");
                writer.WriteRawValue(number.ToString("G29", CultureInfo.InvariantCulture));
                break;
            default:
                value.WriteTo(writer);
                break;
        }
    }

    public Task<CommandResponse> ExecuteAsync(string subject, CommandRequest request,
        Func<IReadOnlyList<EventEnvelope>, EventData> decide,
        Func<EventEnvelope, IReadOnlyList<EventEnvelope>, CommandResponse> respond,
        CancellationToken cancellationToken = default)
    {
        var hash = Hash(request.Method, request.Route, request.Body);
        return store.WithLockAsync(subject, stream =>
        {
            var existing = stream.Events.FirstOrDefault(e => e.IdempotencyKey == request.Key);
            if (existing is not null)
            {
                if (existing.CommandHash != hash) throw new CommandConflictException("idempotency_conflict", stream.Events.Count);
                return respond(existing, Array.AsReadOnly(stream.Events.Take(checked((int)existing.StreamVersion)).ToArray()));
            }
            if (request.ExpectedVersion != stream.Events.Count)
                throw new CommandConflictException("version_conflict", stream.Events.Count);
            var data = decide(stream.Events);
            var accepted = new EventEnvelope(newId(), stream.Events.Count + 1L, 1, data.Type, subject,
                clock.GetUtcNow(), request.Key, hash, data.Payload.Clone());
            stream.Append(accepted);
            return respond(accepted, stream.Events);
        }, cancellationToken);
    }
}
