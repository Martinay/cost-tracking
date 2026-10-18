using System.Globalization;
using System.Text.Json;
using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.History;

public static class HistoryEndpoints
{
    public static IEndpointRouteBuilder MapHistoryEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/history", GetAsync)
            .Produces<HistoryResponse>(StatusCodes.Status200OK, "application/json");
        return endpoints;
    }

    private static async Task<IResult> GetAsync(HttpContext context, JsonlEventStore store, CursorCodec cursorCodec,
        TimeProvider clock, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var events = await store.ReadAsync(owner, cancellationToken);
        var account = AccountProjection.Replay(owner, events);
        var horseId = ReadFilterId(context.Request.Query["horseId"].FirstOrDefault(), "horseId");
        var ruleId = ReadFilterId(context.Request.Query["ruleId"].FirstOrDefault(), "ruleId");
        var filterKey = $"horseId={horseId?.ToString("D").ToLowerInvariant() ?? "*"};ruleId={ruleId?.ToString("D").ToLowerInvariant() ?? "*"}";
        var today = OwnerToday(clock, account.TimeZone);
        var position = context.Request.Query["cursor"].FirstOrDefault() is { } cursor
            ? cursorCodec.Decode(cursor, owner, filterKey, account.StreamVersion, today)
            : "0";
        if (horseId.HasValue && HorseProjection.Replay(events).All(horse => horse.HorseId != horseId.Value)) throw NotFound();
        if (ruleId.HasValue && events.All(value => !ReferencesId(value.Payload, "ruleId", ruleId.Value))) throw NotFound();
        if (!long.TryParse(position, NumberStyles.None, CultureInfo.InvariantCulture, out var afterVersion) ||
            afterVersion < 0 || afterVersion > account.StreamVersion)
            throw new ApiException(400, "invalid_cursor", "Cursor is invalid for this query.");
        var limit = ApiProtocol.ListLimit(context.Request.Query["limit"].FirstOrDefault());
        var matching = events.Where(value => value.StreamVersion > afterVersion)
            .Where(value => horseId is null || ReferencesId(value.Payload, "horseId", horseId.Value))
            .Where(value => ruleId is null || ReferencesId(value.Payload, "ruleId", ruleId.Value)).ToArray();
        var page = matching.Take(limit + 1).ToArray();
        var hasMore = page.Length > limit;
        var items = page.Take(limit).Select(Summary).ToArray();
        var nextCursor = hasMore
            ? cursorCodec.Encode(owner, filterKey, account.StreamVersion, today, items[^1].StreamVersion.ToString(CultureInfo.InvariantCulture))
            : null;
        return await AccountEndpoints.WriteAsync(context, StatusCodes.Status200OK,
            new { items, nextCursor, streamVersion = account.StreamVersion }, account.StreamVersion);
    }

    private static HistoryItem Summary(EventEnvelope value)
    {
        var payload = value.Payload;
        return value.Type switch
        {
            "AccountConfigured" => Item(value, "Account settings updated", new
            {
                currency = payload.GetProperty("currency").GetString(), timeZone = payload.GetProperty("timeZone").GetString()
            }),
            "DrivingRateChanged" => Item(value, "Driving rate changed", new
            {
                rateMinorPerKm = payload.GetProperty("rateMinorPerKm").GetDecimal()
            }),
            "HorseRegistered" => Item(value, "Horse registered", HorseChanges(payload)),
            "HorseDetailsUpdated" => Item(value, "Horse details updated", HorseChanges(payload)),
            "HorseStatusChanged" => Item(value, "Horse status changed", new
            {
                horseId = payload.GetProperty("horseId").GetGuid(), status = payload.GetProperty("status").GetString()
            }),
            "ExpenseRecorded" => Item(value, "Expense recorded", new
            {
                expenseId = payload.GetProperty("expenseId").GetGuid(), expenseDate = payload.GetProperty("expenseDate").GetString(),
                amountMinor = payload.GetProperty("amountMinor").GetInt64(), category = payload.GetProperty("category").GetString(),
                description = payload.GetProperty("description").GetString(), splitMode = payload.GetProperty("splitMode").GetString(),
                allocations = payload.GetProperty("allocations"), driving = payload.GetProperty("driving")
            }),
            "IncomeRecorded" => Item(value, "Income recorded", new
            {
                incomeId = payload.GetProperty("incomeId").GetGuid(), receivedDate = payload.GetProperty("receivedDate").GetString(),
                amountMinor = payload.GetProperty("amountMinor").GetInt64(), source = payload.GetProperty("source").GetString(),
                splitMode = payload.GetProperty("splitMode").GetString(), allocations = payload.GetProperty("allocations")
            }),
            "TaskLogged" => Item(value, "Task recorded", new
            {
                taskId = payload.GetProperty("taskId").GetGuid(), horseId = payload.GetProperty("horseId").GetGuid(),
                taskDate = payload.GetProperty("taskDate").GetString(), taskType = payload.GetProperty("taskType").GetString(),
                minutes = payload.GetProperty("minutes").GetInt64(), quantity = payload.GetProperty("quantity"),
                quantityUnit = payload.GetProperty("quantityUnit"), notes = payload.GetProperty("notes").GetString()
            }),
            "RecurringExpenseRuleCreated" => Item(value, "Recurring expense rule created", new
            {
                ruleId = payload.GetProperty("ruleId").GetGuid(), effectiveFrom = payload.GetProperty("effectiveFrom").GetString(),
                schedule = payload.GetProperty("schedule"), defaults = payload.GetProperty("defaults")
            }),
            "RecurringExpenseRuleUpdated" => Item(value, "Recurring expense rule updated", new
            {
                ruleId = payload.GetProperty("ruleId").GetGuid(), effectiveFrom = payload.GetProperty("effectiveFrom").GetString(),
                schedule = payload.GetProperty("schedule"), defaults = payload.GetProperty("defaults")
            }),
            "RecurringExpenseRuleStopped" => Item(value, "Recurring expense rule stopped", new
            {
                ruleId = payload.GetProperty("ruleId").GetGuid(), lastDate = payload.GetProperty("lastDate").GetString()
            }),
            "RecurringExpenseOccurrenceOverridden" => Item(value, "Recurring expense occurrence changed", new
            {
                ruleId = payload.GetProperty("ruleId").GetGuid(), scheduledDate = payload.GetProperty("scheduledDate").GetString(),
                action = payload.GetProperty("action").GetString(), changed = payload.GetProperty("changed")
            }),
            "RecurringIncomeRuleCreated" => Item(value, "Recurring income rule created", new
            {
                ruleId = payload.GetProperty("ruleId").GetGuid(), effectiveFrom = payload.GetProperty("effectiveFrom").GetString(),
                schedule = payload.GetProperty("schedule"), defaults = payload.GetProperty("defaults")
            }),
            "RecurringIncomeRuleUpdated" => Item(value, "Recurring income rule updated", new
            {
                ruleId = payload.GetProperty("ruleId").GetGuid(), effectiveFrom = payload.GetProperty("effectiveFrom").GetString(),
                schedule = payload.GetProperty("schedule"), defaults = payload.GetProperty("defaults")
            }),
            "RecurringIncomeRuleStopped" => Item(value, "Recurring income rule stopped", new
            {
                ruleId = payload.GetProperty("ruleId").GetGuid(), lastDate = payload.GetProperty("lastDate").GetString()
            }),
            "RecurringIncomeApproved" => Item(value, "Income occurrence approved", new
            {
                ruleId = payload.GetProperty("ruleId").GetGuid(), scheduledDate = payload.GetProperty("scheduledDate").GetString(),
                realizedIncomeId = $"income-rule/{payload.GetProperty("ruleId").GetGuid():D}/{payload.GetProperty("scheduledDate").GetString()}",
                receivedDate = payload.GetProperty("receivedDate").GetString(), amountMinor = payload.GetProperty("amountMinor").GetInt64(),
                allocations = payload.GetProperty("allocations"), nextDueDate = payload.GetProperty("nextDueDate"),
                splitMode = payload.GetProperty("splitMode").GetString()
            }),
            "RecurringIncomeRejected" => Item(value, "Income occurrence rejected", new
            {
                ruleId = payload.GetProperty("ruleId").GetGuid(), scheduledDate = payload.GetProperty("scheduledDate").GetString(),
                nextDueDate = payload.GetProperty("nextDueDate")
            }),
            _ => throw new InvalidDataException("History event type is not implemented by this runtime.")
        };
    }

    private static HistoryItem Item<T>(EventEnvelope value, string summary, T changes) =>
        new(value.EventId, value.StreamVersion, value.Type, value.OccurredAt, summary,
            JsonSerializer.SerializeToElement(changes, ApiProtocol.JsonOptions));

    private static object HorseChanges(JsonElement payload) => new
    {
        horseId = payload.GetProperty("horseId").GetGuid(),
        name = payload.GetProperty("name").GetString(),
        breed = payload.GetProperty("breed").GetString(),
        dateOfBirth = payload.GetProperty("dateOfBirth").ValueKind == JsonValueKind.Null ? null : payload.GetProperty("dateOfBirth").GetString(),
        status = payload.GetProperty("status").GetString()
    };

    private static Guid? ReadFilterId(string? value, string field)
    {
        if (value is null) return null;
        if (!Guid.TryParseExact(value, "D", out var id)) throw new ApiException(400, "malformed_request", "Filter must be a UUID.", field);
        return id;
    }

    private static bool ReferencesId(JsonElement payload, string field, Guid id)
    {
        if (payload.ValueKind == JsonValueKind.Array) return payload.EnumerateArray().Any(value => ReferencesId(value, field, id));
        if (payload.ValueKind != JsonValueKind.Object) return false;
        foreach (var property in payload.EnumerateObject())
        {
            if (property.NameEquals(field) && property.Value.ValueKind == JsonValueKind.String && property.Value.TryGetGuid(out var value) && value == id)
                return true;
            if ((property.Value.ValueKind is JsonValueKind.Object or JsonValueKind.Array) && ReferencesId(property.Value, field, id))
                return true;
        }
        return false;
    }

    private static ApiException NotFound() => new(StatusCodes.Status404NotFound, "not_found", "Resource unavailable.");

    private static DateOnly OwnerToday(TimeProvider clock, string? timeZone)
    {
        var now = clock.GetUtcNow();
        return timeZone is null ? DateOnly.FromDateTime(now.UtcDateTime) :
            DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(timeZone)).DateTime);
    }

    public sealed record HistoryItem(Guid EventId, long StreamVersion, string Type, DateTimeOffset OccurredAt,
        string Summary, JsonElement Changes);
    public sealed record HistoryResponse(IReadOnlyList<HistoryItem> Items, string? NextCursor, long StreamVersion);
}
