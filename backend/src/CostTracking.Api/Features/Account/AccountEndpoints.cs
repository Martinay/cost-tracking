using System.Text.Json;
using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.Account;

public static class AccountEndpoints
{
    public static IEndpointRouteBuilder MapAccountEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/account", GetAsync)
            .Produces<AccountResponse>(StatusCodes.Status200OK, "application/json");
        endpoints.MapPut("/api/v1/account", ConfigureAsync)
            .Accepts<ConfigureAccountRequest>("application/json")
            .Produces<AccountResponse>(StatusCodes.Status200OK, "application/json");
        return endpoints;
    }

    private static async Task<IResult> GetAsync(HttpContext context, JsonlEventStore store, TimeProvider clock, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var events = await store.ReadAsync(owner, cancellationToken);
        var account = AccountProjection.Replay(owner, events);
        var body = new AccountResponse(account.Currency, account.TimeZone, account.StreamVersion, account.DrivingRateMinorPerKm,
            account.SettingsLocked, OwnerCalendar.Today(clock, account.TimeZone));
        return await WriteAsync(context, StatusCodes.Status200OK, body, account.StreamVersion);
    }

    private static async Task<IResult> ConfigureAsync(HttpContext context, JsonlEventStore store, TimeProvider clock,
        Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var request = await ApiProtocol.ReadBodyAsync<ConfigureAccountRequest>(context.Request, cancellationToken);
        var command = Command(context, "PUT", "/api/v1/account", request);
        var pipeline = new CommandPipeline(store, clock, newId);
        var result = await pipeline.ExecuteAsync(owner, command, events =>
        {
            try { AccountSettings.ValidateConfiguration(request.Currency, request.TimeZone); }
            catch (InvalidDataException exception)
            {
                throw new ApiException(StatusCodes.Status422UnprocessableEntity, "invalid_account_settings", "Currency or time zone is not supported.",
                    exception.Message.Contains("currency", StringComparison.OrdinalIgnoreCase) ? "currency" : "timeZone");
            }
            var current = AccountProjection.Replay(owner, events);
            if (current.SettingsLocked) throw new ApiException(StatusCodes.Status409Conflict, "settings_locked", "Account settings are locked after financial activity.");
            return Event("AccountConfigured", new { currency = request.Currency, timeZone = request.TimeZone });
        }, (accepted, prefix) =>
        {
            var account = AccountProjection.Replay(owner, prefix);
            return Response(accepted.StreamVersion, new AccountResponse(account.Currency, account.TimeZone, accepted.StreamVersion,
                account.DrivingRateMinorPerKm, account.SettingsLocked, OwnerCalendar.Today(clock, account.TimeZone)));
        }, cancellationToken);
        return await WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    internal static CommandRequest Command<T>(HttpContext context, string method, string route, T request)
    {
        var (key, version) = ApiProtocol.ReadCommand(context.Request);
        return new CommandRequest(method, route, JsonSerializer.SerializeToElement(request, ApiProtocol.JsonOptions), key, version);
    }

    internal static EventData Event<T>(string type, T payload) => new(type, JsonSerializer.SerializeToElement(payload, ApiProtocol.JsonOptions));
    internal static CommandResponse Response<T>(long version, T response) => new(StatusCodes.Status200OK,
        JsonSerializer.SerializeToElement(response, ApiProtocol.JsonOptions), version);

    internal static CommandResponse CreatedResponse<T>(long version, T response) => new(StatusCodes.Status201Created,
        JsonSerializer.SerializeToElement(response, ApiProtocol.JsonOptions), version);

    internal static async Task<IResult> WriteAsync(HttpContext context, int status, object body, long version)
    {
        await ApiProtocol.WriteAsync(context, status, body, version);
        return Results.Empty;
    }

    public sealed record ConfigureAccountRequest(string Currency, string TimeZone);
    public sealed record AccountResponse(string? Currency, string? TimeZone, long StreamVersion, decimal? DrivingRateMinorPerKm,
        bool SettingsLocked, DateOnly OwnerToday);
}
