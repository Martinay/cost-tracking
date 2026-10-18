using System.Globalization;
using System.Text.Json;
using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.Horses;

public static class HorseEndpoints
{
    private static readonly HashSet<string> PatchFields = new(["name", "breed", "dateOfBirth"], StringComparer.Ordinal);

    public static IEndpointRouteBuilder MapHorseEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/horses", ListAsync)
            .Produces<HorseListResponse>(StatusCodes.Status200OK, "application/json");
        endpoints.MapPost("/api/v1/horses", CreateAsync)
            .Accepts<CreateHorseRequest>("application/json")
            .Produces<CreatedHorseResponse>(StatusCodes.Status201Created, "application/json");
        endpoints.MapGet("/api/v1/horses/{horseId}", GetAsync)
            .Produces<Horse>(StatusCodes.Status200OK, "application/json");
        endpoints.MapPatch("/api/v1/horses/{horseId}", PatchAsync)
            .Accepts<HorseDetailsPatchRequest>("application/json")
            .Produces<Horse>(StatusCodes.Status200OK, "application/json");
        endpoints.MapPut("/api/v1/horses/{horseId}/status", SetStatusAsync)
            .Accepts<SetHorseStatusRequest>("application/json")
            .Produces<Horse>(StatusCodes.Status200OK, "application/json");
        return endpoints;
    }

    private static async Task<IResult> ListAsync(HttpContext context, JsonlEventStore store, CursorCodec cursorCodec,
        TimeProvider clock, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var events = await store.ReadAsync(owner, cancellationToken);
        var projection = AccountProjection.Replay(owner, events);
        var horses = HorseProjection.Replay(events);
        var filter = context.Request.Query["status"].FirstOrDefault();
        if (filter is not null && (!Enum.TryParse<HorseStatus>(filter, ignoreCase: false, out var parsedStatus) || parsedStatus.ToString() != filter))
            throw new ApiException(StatusCodes.Status400BadRequest, "malformed_request", "Horse status filter is invalid.", "status");
        var limit = ApiProtocol.ListLimit(context.Request.Query["limit"].FirstOrDefault());
        var today = OwnerToday(clock, projection.TimeZone);
        var filterKey = $"status={filter ?? "*"}";
        var cursor = context.Request.Query["cursor"].FirstOrDefault();
        var after = cursor is null ? null : cursorCodec.Decode(cursor, owner, filterKey, projection.StreamVersion, today);
        var filtered = horses.Where(horse => filter is null || horse.Status.ToString() == filter)
            .Where(horse => after is null || StringComparer.Ordinal.Compare(HorsePosition(horse), after) > 0).ToArray();
        var page = filtered.Take(limit + 1).ToArray();
        var hasMore = page.Length > limit;
        var items = page.Take(limit).Select(horse => horse with { StreamVersion = projection.StreamVersion }).ToArray();
        var nextCursor = hasMore ? cursorCodec.Encode(owner, filterKey, projection.StreamVersion, today, HorsePosition(items[^1])) : null;
        return await AccountEndpoints.WriteAsync(context, StatusCodes.Status200OK,
            new { items, nextCursor, streamVersion = projection.StreamVersion }, projection.StreamVersion);
    }

    private static async Task<IResult> CreateAsync(HttpContext context, JsonlEventStore store, TimeProvider clock,
        Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var request = await ApiProtocol.ReadBodyAsync<CreateHorseRequest>(context.Request, cancellationToken);
        var horseId = newId();
        var command = AccountEndpoints.Command(context, "POST", "/api/v1/horses", request);
        var pipeline = new CommandPipeline(store, clock, newId);
        var result = await pipeline.ExecuteAsync(owner, command, events =>
        {
            if (HorseProjection.Replay(events).Any(horse => horse.HorseId == horseId))
                throw new ApiException(StatusCodes.Status409Conflict, "horse_exists", "The horse already exists.");
            ValidateBirthDate(request.DateOfBirth, AccountProjection.Replay(owner, events).TimeZone, clock);
            var name = NormalizeName(request.Name);
            var breed = NormalizeBreed(request.Breed);
            return AccountEndpoints.Event("HorseRegistered", new
            {
                horseId, name, breed, dateOfBirth = request.DateOfBirth?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), status = request.Status.ToString()
            });
        }, (accepted, _) => AccountEndpoints.CreatedResponse(accepted.StreamVersion, new { horseId = accepted.Payload.GetProperty("horseId").GetGuid(), streamVersion = accepted.StreamVersion }),
            cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    private static async Task<IResult> GetAsync(HttpContext context, string horseId, JsonlEventStore store,
        CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var events = await store.ReadAsync(owner, cancellationToken);
        var version = events.Count;
        var horse = Find(HorseProjection.Replay(events), horseId);
        return await AccountEndpoints.WriteAsync(context, StatusCodes.Status200OK, horse with { StreamVersion = version }, version);
    }

    private static async Task<IResult> PatchAsync(HttpContext context, string horseId, JsonlEventStore store,
        TimeProvider clock, Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var body = await ApiProtocol.ReadBodyAsync<JsonElement>(context.Request, cancellationToken);
        if (body.ValueKind != JsonValueKind.Object) throw new ApiException(400, "malformed_request", "Horse details must be an object.");
        var fields = body.EnumerateObject().ToArray();
        if (fields.Length == 0 || fields.Any(field => !PatchFields.Contains(field.Name)))
            throw new ApiException(400, "malformed_request", "PATCH must contain only name, breed, or dateOfBirth and cannot be empty.");
        var id = ParseId(horseId);
        var command = AccountEndpoints.Command(context, "PATCH", $"/api/v1/horses/{id:D}", body);
        var pipeline = new CommandPipeline(store, clock, newId);
        var result = await pipeline.ExecuteAsync(owner, command, events =>
        {
            var horse = HorseProjection.Replay(events).FirstOrDefault(value => value.HorseId == id)
                ?? throw NotFound();
            var name = body.TryGetProperty("name", out var nameValue) ? NormalizeName(ReadString(nameValue, "name")) : horse.Name;
            var breed = body.TryGetProperty("breed", out var breedValue) ? NormalizeBreed(ReadString(breedValue, "breed")) : horse.Breed;
            var date = body.TryGetProperty("dateOfBirth", out var dateValue) ? ReadNullableDate(dateValue) : horse.DateOfBirth;
            ValidateBirthDate(date, AccountProjection.Replay(owner, events).TimeZone, clock);
            return AccountEndpoints.Event("HorseDetailsUpdated", new
            {
                horseId = id, name, breed, dateOfBirth = date?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), status = horse.Status.ToString()
            });
        }, (accepted, prefix) =>
        {
            var horse = HorseProjection.Replay(prefix).Single(value => value.HorseId == id);
            return AccountEndpoints.Response(accepted.StreamVersion, horse);
        }, cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    private static async Task<IResult> SetStatusAsync(HttpContext context, string horseId, JsonlEventStore store,
        TimeProvider clock, Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var request = await ApiProtocol.ReadBodyAsync<SetHorseStatusRequest>(context.Request, cancellationToken);
        var id = ParseId(horseId);
        var command = AccountEndpoints.Command(context, "PUT", $"/api/v1/horses/{id:D}/status", request);
        var pipeline = new CommandPipeline(store, clock, newId);
        var result = await pipeline.ExecuteAsync(owner, command, events =>
        {
            var current = HorseProjection.Replay(events).FirstOrDefault(value => value.HorseId == id) ?? throw NotFound();
            if (current.Status == request.Status)
                throw new ApiException(StatusCodes.Status409Conflict, "status_unchanged", "The horse already has this status.");
            return AccountEndpoints.Event("HorseStatusChanged", new { horseId = id, status = request.Status.ToString() });
        }, (accepted, prefix) => AccountEndpoints.Response(accepted.StreamVersion,
            HorseProjection.Replay(prefix).Single(value => value.HorseId == id)), cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    private static Horse Find(IReadOnlyList<Horse> horses, string value)
    {
        var id = ParseId(value);
        return horses.FirstOrDefault(horse => horse.HorseId == id) ?? throw NotFound();
    }

    private static Guid ParseId(string value) => Guid.TryParseExact(value, "D", out var id)
        ? id
        : throw NotFound();

    private static ApiException NotFound() => new(StatusCodes.Status404NotFound, "not_found", "Resource unavailable.");

    private static string NormalizeName(string? value)
    {
        if (value is null) throw new ApiException(400, "malformed_request", "Name must be a string.", "name");
        var result = value.Trim();
        if (result.Length is < 1 or > 100) throw new ApiException(422, "invalid_horse", "Name must contain 1 to 100 characters.", "name");
        return result;
    }

    private static string NormalizeBreed(string? value)
    {
        if (value is null) throw new ApiException(400, "malformed_request", "Breed must be a string.", "breed");
        var result = value.Trim();
        if (result.Length > 100) throw new ApiException(422, "invalid_horse", "Breed cannot exceed 100 characters.", "breed");
        return result;
    }

    private static void ValidateBirthDate(DateOnly? value, string? timeZone, TimeProvider clock)
    {
        if (value is null) return;
        var now = clock.GetUtcNow();
        var today = timeZone is null ? DateOnly.FromDateTime(now.UtcDateTime) :
            DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(timeZone)).DateTime);
        if (value.Value > today) throw new ApiException(422, "invalid_horse", "Date of birth cannot be in the future.", "dateOfBirth");
    }

    private static string ReadString(JsonElement value, string field)
    {
        if (value.ValueKind != JsonValueKind.String) throw new ApiException(400, "malformed_request", "Field must be a string.", field);
        return value.GetString()!;
    }

    private static DateOnly? ReadNullableDate(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Null) return null;
        if (value.ValueKind != JsonValueKind.String || !DateOnly.TryParseExact(value.GetString(), "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var date))
            throw new ApiException(400, "malformed_request", "Date must use YYYY-MM-DD.", "dateOfBirth");
        return date;
    }

    private static DateOnly OwnerToday(TimeProvider clock, string? timeZone)
    {
        var now = clock.GetUtcNow();
        return timeZone is null ? DateOnly.FromDateTime(now.UtcDateTime) :
            DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(timeZone)).DateTime);
    }

    private static string HorsePosition(Horse horse) => horse.HorseId.ToString("D").ToLowerInvariant();

    public sealed record CreateHorseRequest(string Name, string Breed, DateOnly? DateOfBirth, HorseStatus Status);
    public sealed record SetHorseStatusRequest(HorseStatus Status);
    public sealed record HorseDetailsPatchRequest(string? Name = null, string? Breed = null, DateOnly? DateOfBirth = null);
    public sealed record CreatedHorseResponse(Guid HorseId, long StreamVersion);
    public sealed record HorseListResponse(IReadOnlyList<Horse> Items, string? NextCursor, long StreamVersion);
}
