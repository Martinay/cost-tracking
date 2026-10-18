using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Features.Expenses;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.Reports;

public static class BreakdownReportEndpoints
{
    public static IEndpointRouteBuilder MapBreakdownReportEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/reports/breakdown", GetAsync)
            .Produces<BreakdownReportResponse>(StatusCodes.Status200OK, "application/json");
        return endpoints;
    }

    private static async Task<IResult> GetAsync(HttpContext context, JsonlEventStore store, TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var events = await store.ReadAsync(owner, cancellationToken);
        var account = FinancialEndpointSupport.RequireAccount(owner, events);
        var asOfDate = FinancialEndpointSupport.OwnerToday(clock, account.TimeZone);
        var fromText = context.Request.Query["from"].FirstOrDefault();
        var throughText = context.Request.Query["to"].FirstOrDefault();
        if (fromText is null || throughText is null)
            throw FinancialEndpointSupport.Error(400, "malformed_request", "Both from and to dates are required.", "from");
        var from = FinancialEndpointSupport.ReadDate(fromText, "from");
        var through = FinancialEndpointSupport.ReadDate(throughText, "to");
        FinancialEndpointSupport.ValidateWindow(from, through);
        var horseId = FinancialEndpointSupport.ReadId(context.Request.Query["horseId"].FirstOrDefault(), "horseId");
        if (!StringComparer.Ordinal.Equals(context.Request.Query["kind"].FirstOrDefault(), "expense") &&
            !StringComparer.Ordinal.Equals(context.Request.Query["kind"].FirstOrDefault(), "income"))
            throw FinancialEndpointSupport.Error(400, "malformed_request", "Kind must be expense or income.", "kind");
        var kind = context.Request.Query["kind"].FirstOrDefault()!;
        if (horseId is { } selected && HorseProjection.Replay(events).All(item => item.HorseId != selected))
            throw FinancialEndpointSupport.NotFound();

        var totals = new Dictionary<string, List<long>>(StringComparer.Ordinal);
        if (kind == "expense")
        {
            foreach (var item in ExpenseProjection.Replay(events).Where(item => item.ExpenseDate >= from && item.ExpenseDate <= through))
                Add(totals, item.Category.ToString(), AmountFor(item.Allocations, item.AmountMinor, horseId));

            var recurrence = RecurringExpenseProjection.Read(events);
            try
            {
                foreach (var item in ExpenseOccurrences.Expand(recurrence.Rules.Values.ToArray(), recurrence.Overrides, from, through))
                {
                    if (item.Skipped) continue;
                    if (horseId is { } target && item.Allocations.All(allocation => allocation.HorseId != target)) continue;
                    var contribution = AmountFor(item.Allocations, item.AmountMinor, horseId);
                    Add(totals, item.Category, contribution);
                }
            }
            catch (ArgumentOutOfRangeException exception) when (exception.ParamName == "maxCandidates")
            { throw FinancialEndpointSupport.Error(422, "occurrence_limit", "The selected report window contains too many recurring expense candidates."); }
        }
        else
        {
            foreach (var item in IncomeProjection.Replay(events).Where(item => item.ReceivedDate >= from && item.ReceivedDate <= through))
                Add(totals, item.Source, AmountFor(item.Allocations, item.AmountMinor, horseId));
        }

        var items = totals.OrderBy(item => item.Key, StringComparer.Ordinal)
            .Select(item => new BreakdownItem(item.Key, FinancialValues.SumSafe(item.Value))).ToArray();
        var total = FinancialValues.SumSafe(items.Select(item => item.AmountMinor));
        return await AccountEndpoints.WriteAsync(context, StatusCodes.Status200OK,
            new BreakdownReportResponse(account.Currency!, items, total, account.StreamVersion, asOfDate), account.StreamVersion);
    }

    private static long AmountFor(IReadOnlyList<Allocation> allocations, long amountMinor, Guid? horseId)
    {
        if (horseId is not { } selected) return amountMinor;
        var allocation = allocations.SingleOrDefault(item => item.HorseId == selected);
        return allocation?.AmountMinor ?? 0;
    }

    private static void Add(Dictionary<string, List<long>> totals, string label, long amountMinor)
    {
        if (!totals.TryGetValue(label, out var amounts))
        {
            amounts = [];
            totals.Add(label, amounts);
        }
        amounts.Add(amountMinor);
    }

    public sealed record BreakdownItem(string Label, long AmountMinor);
    public sealed record BreakdownReportResponse(string Currency, IReadOnlyList<BreakdownItem> Items,
        long TotalMinor, long StreamVersion, DateOnly AsOfDate);
}
