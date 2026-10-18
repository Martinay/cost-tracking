using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Features.Expenses;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.Reports;

public static class ActivityReportEndpoints
{
    public static IEndpointRouteBuilder MapActivityReportEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/reports/activity", GetAsync)
            .Produces<ActivityReportResponse>(StatusCodes.Status200OK, "application/json");
        return endpoints;
    }

    private static async Task<IResult> GetAsync(HttpContext context, JsonlEventStore store, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var events = await store.ReadAsync(owner, cancellationToken);
        var account = AccountProjection.Replay(owner, events);
        var fromText = context.Request.Query["from"].FirstOrDefault();
        var throughText = context.Request.Query["to"].FirstOrDefault();
        if (fromText is null || throughText is null)
            throw FinancialEndpointSupport.Error(400, "malformed_request", "Both from and to dates are required.", "from");
        var from = FinancialEndpointSupport.ReadDate(fromText, "from");
        var through = FinancialEndpointSupport.ReadDate(throughText, "to");
        FinancialEndpointSupport.ValidateWindow(from, through);
        var horseId = FinancialEndpointSupport.ReadId(context.Request.Query["horseId"].FirstOrDefault(), "horseId");
        if (horseId is { } selected && HorseProjection.Replay(events).All(item => item.HorseId != selected))
            throw FinancialEndpointSupport.NotFound();

        var items = HorseTaskProjection.Replay(events)
            .Where(item => item.TaskDate >= from && item.TaskDate <= through)
            .Where(item => horseId is null || item.HorseId == horseId.Value)
            .GroupBy(item => item.TaskType)
            .OrderBy(group => group.Key)
            .Select(group => new { taskType = group.Key.ToString(), count = group.Count(), minutes = group.Aggregate(0L, (sum, item) => checked(sum + item.Minutes)) })
            .ToArray();
        return await AccountEndpoints.WriteAsync(context, 200,
            new { items, streamVersion = account.StreamVersion }, account.StreamVersion);
    }

    public sealed record ActivitySummary(string TaskType, int Count, long Minutes);
    public sealed record ActivityReportResponse(IReadOnlyList<ActivitySummary> Items, long StreamVersion);
}
