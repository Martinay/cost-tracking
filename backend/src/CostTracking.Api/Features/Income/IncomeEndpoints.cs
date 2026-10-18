using System.Globalization;
using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Features.Expenses;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.Income;

public static class IncomeEndpoints
{
    public static IEndpointRouteBuilder MapIncomeEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/v1/income", CreateAsync)
            .Accepts<CreateIncomeRequest>("application/json")
            .Produces<CreatedIncomeResponse>(StatusCodes.Status201Created, "application/json");
        endpoints.MapGet("/api/v1/income", ListAsync)
            .Produces<IncomeListResponse>(StatusCodes.Status200OK, "application/json");
        return endpoints;
    }

    private static async Task<IResult> CreateAsync(HttpContext context, JsonlEventStore store, TimeProvider clock,
        Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var request = await ApiProtocol.ReadBodyAsync<CreateIncomeRequest>(context.Request, cancellationToken);
        var command = AccountEndpoints.Command(context, "POST", "/api/v1/income", request);
        var result = await new CommandPipeline(store, clock, newId).ExecuteAsync(owner, command, events =>
        {
            var prepared = FinancialEndpointSupport.PrepareIncome(owner, events, request, clock);
            return AccountEndpoints.Event("IncomeRecorded", new
            {
                incomeId = newId(), receivedDate = prepared.Date, amountMinor = prepared.Amount,
                source = prepared.Source, allocations = prepared.Allocations, splitMode = prepared.SplitMode.ToString()
            });
        }, (accepted, prefix) =>
        {
            var record = IncomeProjection.Replay(prefix).Single(value => value.StreamVersion == accepted.StreamVersion);
            return AccountEndpoints.CreatedResponse(accepted.StreamVersion,
                new { incomeId = Guid.ParseExact(record.Id, "D"), allocations = record.Allocations, streamVersion = accepted.StreamVersion });
        }, cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    private static async Task<IResult> ListAsync(HttpContext context, JsonlEventStore store, CursorCodec cursorCodec,
        TimeProvider clock, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var events = await store.ReadAsync(owner, cancellationToken);
        var account = AccountProjection.Replay(owner, events);
        var from = FinancialEndpointSupport.ReadDate(context.Request.Query["from"].FirstOrDefault(), "from");
        var through = FinancialEndpointSupport.ReadDate(context.Request.Query["to"].FirstOrDefault(), "to");
        FinancialEndpointSupport.ValidateWindow(from, through);
        var horseId = FinancialEndpointSupport.ReadId(context.Request.Query["horseId"].FirstOrDefault(), "horseId");
        var sourceFilter = context.Request.Query["source"].FirstOrDefault();
        var limit = ApiProtocol.ListLimit(context.Request.Query["limit"].FirstOrDefault());
        var filter = $"from={from:yyyy-MM-dd};to={through:yyyy-MM-dd};horseId={FinancialEndpointSupport.Canonical(horseId)};source={sourceFilter ?? "*"};limit={limit}";
        var today = FinancialEndpointSupport.OwnerToday(clock, account.TimeZone);
        var offset = context.Request.Query["cursor"].FirstOrDefault() is { } cursor
            ? cursorCodec.Decode(cursor, owner, filter, account.StreamVersion, today)
            : "0";
        if (!int.TryParse(offset, NumberStyles.None, CultureInfo.InvariantCulture, out var skip) || skip < 0)
            throw FinancialEndpointSupport.Error(400, "invalid_cursor", "Cursor position is invalid.");
        var horses = HorseProjection.Replay(events).ToDictionary(item => item.HorseId);
        if (horseId is { } selected && !horses.ContainsKey(selected)) throw FinancialEndpointSupport.NotFound();
        var matches = IncomeProjection.Replay(events).Where(item => item.ReceivedDate >= from && item.ReceivedDate <= through)
            .Where(item => sourceFilter is null || item.Source == sourceFilter)
            .Where(item => horseId is null || item.Allocations.Any(allocation => allocation.HorseId == horseId.Value))
            .OrderBy(item => item.ReceivedDate).ThenBy(item => item.Id, StringComparer.Ordinal).ToArray();
        var page = matches.Skip(skip).Take(limit + 1).ToArray();
        var hasMore = page.Length > limit;
        var items = page.Take(limit).Select(item => new
        {
            id = item.Id, receivedDate = item.ReceivedDate, item.AmountMinor, item.Source,
            splitMode = item.SplitMode.ToString(), allocations = item.Allocations, origin = item.Origin,
            ruleId = item.RuleId, scheduledDate = item.ScheduledDate,
            contributionMinor = horseId is { } target ? item.Allocations.Single(value => value.HorseId == target).AmountMinor : item.AmountMinor
        }).ToArray();
        var nextCursor = hasMore ? cursorCodec.Encode(owner, filter, account.StreamVersion, today,
            checked(skip + limit).ToString(CultureInfo.InvariantCulture)) : null;
        return await AccountEndpoints.WriteAsync(context, 200,
            new { items, nextCursor, streamVersion = account.StreamVersion }, account.StreamVersion);
    }

    public sealed record CreateIncomeRequest(DateOnly ReceivedDate, long AmountMinor, string Source, SplitRequest Split);
    public sealed record CreatedIncomeResponse(Guid IncomeId, IReadOnlyList<Allocation> Allocations, long StreamVersion);
    public sealed record IncomeListItem(string Id, DateOnly ReceivedDate, long AmountMinor, string Source, string SplitMode,
        IReadOnlyList<Allocation> Allocations, string Origin, Guid? RuleId, DateOnly? ScheduledDate, long ContributionMinor);
    public sealed record IncomeListResponse(IReadOnlyList<IncomeListItem> Items, string? NextCursor, long StreamVersion);
}
