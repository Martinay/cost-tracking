using System.Text.Json;
using System.Text.Json.Serialization;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Domain;

[JsonConverter(typeof(JsonStringEnumConverter<HorseStatus>))]
public enum HorseStatus { Active, Leased, Retired, Sold }

public sealed record Horse(Guid HorseId, string Name, string Breed, DateOnly? DateOfBirth, HorseStatus Status,
    long StreamVersion);

/// <summary>Rebuilds current horse records from the accepted account event prefix.</summary>
public static class HorseProjection
{
    public static IReadOnlyList<Horse> Replay(IEnumerable<EventEnvelope> events)
    {
        var horses = new Dictionary<Guid, Horse>();
        foreach (var value in events)
        {
            var payload = value.Payload;
            switch (value.Type)
            {
                case "HorseRegistered":
                    var id = payload.GetProperty("horseId").GetGuid();
                    if (horses.ContainsKey(id)) throw new InvalidDataException("Horse is already registered.");
                    horses.Add(id, new Horse(id, payload.GetProperty("name").GetString()!, payload.GetProperty("breed").GetString()!,
                        ReadDate(payload.GetProperty("dateOfBirth")), Enum.Parse<HorseStatus>(payload.GetProperty("status").GetString()!, false),
                        value.StreamVersion));
                    break;
                case "HorseDetailsUpdated":
                    var existing = Require(payload, horses);
                    var updatedStatus = Enum.Parse<HorseStatus>(payload.GetProperty("status").GetString()!, false);
                    if (existing.Status != updatedStatus) throw new InvalidDataException("Horse detail updates cannot change status.");
                    horses[existing.HorseId] = existing with
                    {
                        Name = payload.GetProperty("name").GetString()!,
                        Breed = payload.GetProperty("breed").GetString()!,
                        DateOfBirth = ReadDate(payload.GetProperty("dateOfBirth")),
                        StreamVersion = value.StreamVersion
                    };
                    break;
                case "HorseStatusChanged":
                    var statusHorse = Require(payload, horses);
                    var nextStatus = Enum.Parse<HorseStatus>(payload.GetProperty("status").GetString()!, false);
                    if (statusHorse.Status == nextStatus) throw new InvalidDataException("Horse status event does not change the current status.");
                    horses[statusHorse.HorseId] = statusHorse with
                    {
                        Status = nextStatus,
                        StreamVersion = value.StreamVersion
                    };
                    break;
            }
        }
        return horses.Values.OrderBy(horse => horse.HorseId.ToString("D").ToLowerInvariant(), StringComparer.Ordinal).ToArray();
    }

    private static Horse Require(JsonElement payload, IReadOnlyDictionary<Guid, Horse> horses)
    {
        var id = payload.GetProperty("horseId").GetGuid();
        return horses.TryGetValue(id, out var value) ? value : throw new InvalidDataException("Horse event references an unregistered horse.");
    }

    private static DateOnly? ReadDate(JsonElement value) => value.ValueKind == JsonValueKind.Null
        ? null
        : DateOnly.ParseExact(value.GetString()!, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
}
