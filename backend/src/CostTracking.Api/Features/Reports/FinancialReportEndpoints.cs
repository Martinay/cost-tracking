using System.Globalization;
using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Features.Expenses;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.Reports;

public static class FinancialReportEndpoints
{
    public static IEndpointRouteBuilder MapFinancialReportEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/reports/monthly-pnl", MonthlyAsync)
            .Produces<MonthlyReportResponse>(StatusCodes.Status200OK, "application/json");
        endpoints.MapGet("/api/v1/reports/lifetime", LifetimeAsync)
            .Produces<LifetimeReportResponse>(StatusCodes.Status200OK, "application/json");
        return endpoints;
    }

    private static async Task<IResult> MonthlyAsync(HttpContext context, JsonlEventStore store, TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var events = await store.ReadAsync(owner, cancellationToken);
        var account = FinancialEndpointSupport.RequireAccount(owner, events);
        var monthText = context.Request.Query["month"].FirstOrDefault();
        if (monthText is null || !DateOnly.TryParseExact(monthText + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var firstDay) || firstDay.ToString("yyyy-MM", CultureInfo.InvariantCulture) != monthText)
            throw FinancialEndpointSupport.Error(400, "malformed_request", "Month must use YYYY-MM format.", "month");
        var lastDay = new DateOnly(firstDay.Year, firstDay.Month, DateTime.DaysInMonth(firstDay.Year, firstDay.Month));
        var horseId = FinancialEndpointSupport.ReadId(context.Request.Query["horseId"].FirstOrDefault(), "horseId");
        var today = OwnerCalendar.Today(clock, account.TimeZone);
        var report = FinancialReports.Monthly(events, owner, today, firstDay, lastDay);
        if (horseId is { } id && report.Items.All(item => item.HorseId != id)) throw FinancialEndpointSupport.NotFound();
        var items = report.Items.Where(item => horseId is null || item.HorseId == horseId.Value)
            .Select(item => new { item.HorseId, incomeMinor = item.IncomeMinor, expenseMinor = item.ExpenseMinor, netMinor = item.NetMinor }).ToArray();
        return await AccountEndpoints.WriteAsync(context, 200,
            new { report.Currency, month = monthText, items, streamVersion = report.StreamVersion }, report.StreamVersion);
    }

    private static async Task<IResult> LifetimeAsync(HttpContext context, JsonlEventStore store, CursorCodec cursorCodec,
        TimeProvider clock, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var events = await store.ReadAsync(owner, cancellationToken);
        var account = FinancialEndpointSupport.RequireAccount(owner, events);
        var asOfDate = OwnerCalendar.Today(clock, account.TimeZone);
        var horseId = FinancialEndpointSupport.ReadId(context.Request.Query["horseId"].FirstOrDefault(), "horseId");
        var limit = ApiProtocol.ListLimit(context.Request.Query["limit"].FirstOrDefault());
        var filter = $"lifetime;horseId={FinancialEndpointSupport.Canonical(horseId)};limit={limit}";
        var firstDate = EarliestFinancialDate(events, asOfDate);
        var position = context.Request.Query["cursor"].FirstOrDefault() is { } cursor
            ? cursorCodec.Decode(cursor, owner, filter, account.StreamVersion, asOfDate)
            : $"{firstDate:yyyy-MM-dd}|0";
        var parts = position.Split('|');
        if (parts.Length != 2 || !DateOnly.TryParseExact(parts[0], "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var windowFrom) || windowFrom < firstDate || windowFrom > asOfDate ||
            !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var skip) || skip < 0)
            throw FinancialEndpointSupport.Error(400, "invalid_cursor", "Cursor position is invalid.");
        var (windowThrough, report) = LifetimeWindowReport(events, owner, asOfDate, windowFrom);
        if (horseId is { } id && report.Items.All(item => item.HorseId != id)) throw FinancialEndpointSupport.NotFound();
        var page = report.Items.Where(item => horseId is null || item.HorseId == horseId.Value).Skip(skip).Take(limit + 1).ToArray();
        var hasMoreHorses = page.Length > limit;
        var items = page.Take(limit).Select(item => new
        {
            item.HorseId, incomeMinor = item.IncomeMinor, expenseMinor = item.ExpenseMinor, netMinor = item.NetMinor
        }).ToArray();
        var complete = !hasMoreHorses && windowThrough == asOfDate;
        var nextPosition = hasMoreHorses
            ? $"{windowFrom:yyyy-MM-dd}|{checked(skip + limit)}"
            : windowThrough < asOfDate ? $"{windowThrough.AddDays(1):yyyy-MM-dd}|0" : null;
        var nextCursor = nextPosition is null ? null : cursorCodec.Encode(owner, filter, account.StreamVersion, asOfDate, nextPosition);
        return await AccountEndpoints.WriteAsync(context, 200,
            new { report.Currency, asOfDate, items, streamVersion = report.StreamVersion, complete, nextCursor },
            report.StreamVersion);
    }

    private static DateOnly EarliestFinancialDate(IReadOnlyList<EventEnvelope> events, DateOnly fallback)
    {
        var dates = new List<DateOnly>();
        foreach (var value in events)
        {
            var payload = value.Payload;
            var dateProperty = value.Type switch
            {
                "ExpenseRecorded" => "expenseDate",
                "IncomeRecorded" => "receivedDate",
                "RecurringExpenseRuleCreated" or "RecurringIncomeRuleCreated" => null,
                "RecurringIncomeApproved" => "receivedDate",
                _ => null
            };
            if (dateProperty is not null)
                dates.Add(DateOnly.ParseExact(payload.GetProperty(dateProperty).GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture));
            else if (value.Type is "RecurringExpenseRuleCreated" or "RecurringIncomeRuleCreated")
            {
                var schedule = payload.GetProperty("schedule");
                dates.Add(DateOnly.ParseExact(schedule.GetProperty("startDate").GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture));
            }
        }
        return dates.Count == 0 ? fallback : dates.Min();
    }

    private static (DateOnly Through, MonthlyFinancialReport Report) LifetimeWindowReport(
        IReadOnlyList<EventEnvelope> events, string owner, DateOnly asOfDate, DateOnly from)
    {
        DateOnly through;
        try { through = from.AddYears(5).AddDays(-1); }
        catch (ArgumentOutOfRangeException) { through = DateOnly.MaxValue; }
        if (through > asOfDate) through = asOfDate;
        while (true)
        {
            try { return (through, FinancialReports.Monthly(events, owner, asOfDate, from, through)); }
            catch (ArgumentOutOfRangeException exception) when (exception.ParamName == "maxCandidates")
            {
                if (through == from) throw FinancialEndpointSupport.Error(422, "occurrence_limit", "Even a single-date lifetime window exceeds the occurrence budget.");
                var days = through.DayNumber - from.DayNumber;
                through = from.AddDays(Math.Max(0, days / 2));
            }
        }
    }

    public sealed record ReportBalance(Guid HorseId, long IncomeMinor, long ExpenseMinor, long NetMinor);
    public sealed record MonthlyReportResponse(string Currency, string Month, IReadOnlyList<ReportBalance> Items, long StreamVersion);
    public sealed record LifetimeReportResponse(string Currency, DateOnly AsOfDate, IReadOnlyList<ReportBalance> Items,
        long StreamVersion, bool Complete, string? NextCursor);
}
