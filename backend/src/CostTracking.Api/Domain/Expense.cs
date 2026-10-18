using System.Text.Json;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Domain;

public enum ExpenseCategory { Stabling, Veterinary, Farrier, Feed, Equipment, Training, Driving, Other }

public sealed record DrivingDetails(decimal Kilometers, decimal RateMinorPerKm);

public sealed record ExpenseRecord(Guid ExpenseId, DateOnly ExpenseDate, long AmountMinor, ExpenseCategory Category,
    string Description, SplitMode SplitMode, IReadOnlyList<Allocation> Allocations, DrivingDetails? Driving,
    long StreamVersion);

public static class ExpenseProjection
{
    public static IReadOnlyList<ExpenseRecord> Replay(IEnumerable<EventEnvelope> events) => events
        .Where(value => value.Type == "ExpenseRecorded")
        .Select(value =>
        {
            var payload = value.Payload;
            var allocations = ReadAllocations(payload.GetProperty("allocations"));
            return new ExpenseRecord(payload.GetProperty("expenseId").GetGuid(), ReadDate(payload, "expenseDate"),
                payload.GetProperty("amountMinor").GetInt64(), Enum.Parse<ExpenseCategory>(payload.GetProperty("category").GetString()!, false),
                payload.GetProperty("description").GetString()!, Enum.Parse<SplitMode>(payload.GetProperty("splitMode").GetString()!, false),
                allocations, ReadDriving(payload.GetProperty("driving")), value.StreamVersion);
        }).ToArray();

    internal static IReadOnlyList<Allocation> ReadAllocations(JsonElement value) => value.EnumerateArray().Select(item =>
        new Allocation(item.GetProperty("horseId").GetGuid(), item.GetProperty("weight").GetInt32(), item.GetProperty("amountMinor").GetInt64())).ToArray();

    internal static DateOnly ReadDate(JsonElement payload, string name) => DateOnly.ParseExact(payload.GetProperty(name).GetString()!,
        "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

    private static DrivingDetails? ReadDriving(JsonElement value) => value.ValueKind == JsonValueKind.Null ? null :
        new DrivingDetails(value.GetProperty("kilometers").GetDecimal(), value.GetProperty("rateMinorPerKm").GetDecimal());
}
