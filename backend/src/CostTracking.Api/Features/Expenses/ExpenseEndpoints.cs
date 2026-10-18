using System.Globalization;
using System.Text.Json;
using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.Expenses;

public static class ExpenseEndpoints
{
    public static IEndpointRouteBuilder MapExpenseEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/v1/expenses", CreateAsync)
            .Accepts<CreateExpenseRequest>("application/json")
            .Produces<CreatedExpenseResponse>(StatusCodes.Status201Created, "application/json");
        endpoints.MapGet("/api/v1/expenses", ListAsync)
            .Produces<ExpenseListResponse>(StatusCodes.Status200OK, "application/json");
        return endpoints;
    }

    private static async Task<IResult> CreateAsync(HttpContext context, JsonlEventStore store, TimeProvider clock,
        Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var request = await ApiProtocol.ReadBodyAsync<CreateExpenseRequest>(context.Request, cancellationToken);
        var command = AccountEndpoints.Command(context, "POST", "/api/v1/expenses", request);
        var pipeline = new CommandPipeline(store, clock, newId);
        var result = await pipeline.ExecuteAsync(owner, command, events =>
        {
            var prepared = FinancialEndpointSupport.PrepareExpense(owner, events, request, clock);
            var payload = new
            {
                expenseId = newId(), expenseDate = prepared.Date, amountMinor = prepared.Amount,
                category = prepared.Category.ToString(), description = prepared.Description, allocations = prepared.Allocations,
                driving = (object?)null, splitMode = prepared.SplitMode.ToString()
            };
            return AccountEndpoints.Event("ExpenseRecorded", payload);
        }, (accepted, prefix) =>
        {
            var record = ExpenseProjection.Replay(prefix).Single(value => value.StreamVersion == accepted.StreamVersion);
            return AccountEndpoints.CreatedResponse(accepted.StreamVersion,
                new { expenseId = record.ExpenseId, allocations = record.Allocations, streamVersion = accepted.StreamVersion });
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
        var category = context.Request.Query["category"].FirstOrDefault();
        if (category is not null && (!Enum.TryParse<ExpenseCategory>(category, false, out var parsed) ||
            !Enum.IsDefined(parsed) || parsed.ToString() != category))
            throw FinancialEndpointSupport.Error(400, "malformed_request", "Category filter is invalid.", "category");
        var limit = ApiProtocol.ListLimit(context.Request.Query["limit"].FirstOrDefault());
        var filter = $"from={from:yyyy-MM-dd};to={through:yyyy-MM-dd};horseId={FinancialEndpointSupport.Canonical(horseId)};category={category ?? "*"};limit={limit}";
        var today = FinancialEndpointSupport.OwnerToday(clock, account.TimeZone);
        var offset = context.Request.Query["cursor"].FirstOrDefault() is { } cursor
            ? cursorCodec.Decode(cursor, owner, filter, account.StreamVersion, today)
            : "0";
        if (!int.TryParse(offset, NumberStyles.None, CultureInfo.InvariantCulture, out var skip) || skip < 0)
            throw FinancialEndpointSupport.Error(400, "invalid_cursor", "Cursor position is invalid.");
        var horses = HorseProjection.Replay(events).ToDictionary(item => item.HorseId);
        if (horseId is { } selected && !horses.ContainsKey(selected)) throw FinancialEndpointSupport.NotFound();
        var matches = ExpenseProjection.Replay(events).Where(item => item.ExpenseDate >= from && item.ExpenseDate <= through)
            .Where(item => category is null || item.Category.ToString() == category)
            .Where(item => horseId is null || item.Allocations.Any(allocation => allocation.HorseId == horseId.Value))
            .Select(item => new ExpenseListItem(item.ExpenseId.ToString("D").ToLowerInvariant(), item.ExpenseDate,
                item.AmountMinor, item.Category.ToString(), item.Description, item.SplitMode.ToString(), item.Allocations,
                "OneTime", null, null, null, false,
                horseId is { } target ? item.Allocations.Single(value => value.HorseId == target).AmountMinor : item.AmountMinor,
                item.Driving))
            .ToList();
        var recurrence = RecurringExpenseProjection.Read(events);
        try
        {
            var occurrences = ExpenseOccurrences.Expand(recurrence.Rules.Values.ToArray(), recurrence.Overrides, from, through);
            matches.AddRange(occurrences.Where(item => category is null || item.Category == category)
                .Where(item => horseId is null || item.Allocations.Any(allocation => allocation.HorseId == horseId.Value))
                .Select(item => new ExpenseListItem(item.Id, item.ScheduledDate, item.AmountMinor, item.Category,
                    item.Description, item.SplitMode.ToString(), item.Allocations, item.Origin, item.RuleId,
                    item.ScheduledDate, item.OccurrenceState, item.Skipped,
                    horseId is { } target ? (item.Skipped ? 0 : item.Allocations.Single(value => value.HorseId == target).AmountMinor) : item.ContributionMinor,
                    null)));
        }
        catch (ArgumentOutOfRangeException exception)
        {
            throw FinancialEndpointSupport.Error(422, "occurrence_limit", exception.Message);
        }
        var page = matches.OrderBy(item => item.ExpenseDate).ThenBy(item => item.Id, StringComparer.Ordinal)
            .Skip(skip).Take(limit + 1).ToArray();
        var hasMore = page.Length > limit;
        var items = page.Take(limit).ToArray();
        var nextCursor = hasMore ? cursorCodec.Encode(owner, filter, account.StreamVersion, today,
            checked(skip + limit).ToString(CultureInfo.InvariantCulture)) : null;
        return await AccountEndpoints.WriteAsync(context, 200,
            new { items, nextCursor, streamVersion = account.StreamVersion }, account.StreamVersion);
    }

    public sealed record CreateExpenseRequest(DateOnly ExpenseDate, long AmountMinor, string Category, string Description, SplitRequest Split);
    public sealed record CreatedExpenseResponse(Guid ExpenseId, IReadOnlyList<Allocation> Allocations, long StreamVersion);
    public sealed record ExpenseListItem(string Id, DateOnly ExpenseDate, long AmountMinor, string Category, string Description,
        string SplitMode, IReadOnlyList<Allocation> Allocations, string Origin, Guid? RuleId, DateOnly? ScheduledDate,
        string? OccurrenceState, bool Skipped, long ContributionMinor, DrivingDetails? Driving);
    public sealed record ExpenseListResponse(IReadOnlyList<ExpenseListItem> Items, string? NextCursor, long StreamVersion);
}
