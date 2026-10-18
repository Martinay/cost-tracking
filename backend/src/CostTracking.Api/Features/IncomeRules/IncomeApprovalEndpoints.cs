using System.Globalization;
using System.Text.Json;
using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Features.Expenses;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.IncomeRules;

public static class IncomeApprovalEndpoints
{
    public static IEndpointRouteBuilder MapIncomeApprovalEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/income-approvals", ListAsync)
            .Produces<IncomeApprovalListResponse>(StatusCodes.Status200OK, "application/json");
        endpoints.MapPost("/api/v1/income-rules/{ruleId}/occurrences/{scheduledDate}/approve", ApproveAsync)
            .Accepts<ApproveIncomeRequest>("application/json")
            .Produces<IncomeApprovalResponse>(StatusCodes.Status200OK, "application/json");
        endpoints.MapPost("/api/v1/income-rules/{ruleId}/occurrences/{scheduledDate}/reject", RejectAsync)
            .Accepts<RejectIncomeRequest>("application/json")
            .Produces<IncomeApprovalResponse>(StatusCodes.Status200OK, "application/json");
        return endpoints;
    }

    private static async Task<IResult> ListAsync(HttpContext context, JsonlEventStore store, CursorCodec cursorCodec,
        TimeProvider clock, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var events = await store.ReadAsync(owner, cancellationToken);
        var account = FinancialEndpointSupport.RequireAccount(owner, events);
        var today = FinancialEndpointSupport.OwnerToday(clock, account.TimeZone);
        var replay = IncomeRuleEventReplay.Read(events);
        var rules = replay.Rules.Values.ToArray();
        var fromText = context.Request.Query["from"].FirstOrDefault();
        var throughText = context.Request.Query["through"].FirstOrDefault();
        var from = fromText is null ? (rules.Length == 0 ? today : rules.Min(rule => rule.StartDate)) : FinancialEndpointSupport.ReadDate(fromText, "from");
        var requestedThrough = throughText is null ? today : FinancialEndpointSupport.ReadDate(throughText, "through");
        var through = requestedThrough > today ? today : requestedThrough;
        if (through < from)
            throw FinancialEndpointSupport.Error(400, "malformed_request", "The end date cannot precede the start date.", "through");
        FinancialEndpointSupport.ValidateWindow(from, through);

        var limit = ApiProtocol.ListLimit(context.Request.Query["limit"].FirstOrDefault());
        // Bind explicit filters while leaving omitted bounds stable; the signed as-of field
        // separately freezes the server-resolved window when a caller advances later.
        var filterFrom = fromText is null ? "*" : from.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var filterThrough = throughText is null ? "*" : requestedThrough.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var filter = $"from={filterFrom};through={filterThrough};limit={limit}";
        var offset = context.Request.Query["cursor"].FirstOrDefault() is { } token
            ? cursorCodec.Decode(token, owner, filter, account.StreamVersion, today)
            : "0";
        if (!int.TryParse(offset, NumberStyles.None, CultureInfo.InvariantCulture, out var skip) || skip < 0)
            throw FinancialEndpointSupport.Error(400, "invalid_cursor", "Cursor position is invalid.");

        IReadOnlyList<PendingIncomeItem> pending;
        try { pending = PendingIncome.Derive(rules, replay.Decisions, today, from, through); }
        catch (InvalidOperationException exception) when (exception.Message.Contains("candidate limit", StringComparison.OrdinalIgnoreCase))
        { throw FinancialEndpointSupport.Error(422, "occurrence_limit", "The selected income window contains too many scheduled candidates."); }
        catch (ArgumentOutOfRangeException exception)
        { throw FinancialEndpointSupport.Error(422, "interval_limit", exception.Message, "through"); }
        catch (ArgumentException exception)
        { throw FinancialEndpointSupport.Error(422, "interval_limit", exception.Message); }

        var page = pending.Skip(skip).Take(limit + 1).ToArray();
        var hasMore = page.Length > limit;
        var items = page.Take(limit).Select(item => new IncomeApprovalItem(item.RuleId, item.ScheduledDate,
            item.AmountMinor, item.Source, item.SplitMode.ToString(), item.Allocations)).ToArray();
        var nextCursor = hasMore ? cursorCodec.Encode(owner, filter, account.StreamVersion, today,
            checked(skip + limit).ToString(CultureInfo.InvariantCulture)) : null;
        var response = new IncomeApprovalListResponse(items, nextCursor, from, through, today, account.StreamVersion);
        return await AccountEndpoints.WriteAsync(context, StatusCodes.Status200OK, response, account.StreamVersion);
    }

    private static async Task<IResult> ApproveAsync(HttpContext context, string ruleId, string scheduledDate,
        JsonlEventStore store, TimeProvider clock, Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var id = IncomeRuleEndpoints.ParseRuleId(ruleId);
        var date = ParseScheduledDate(scheduledDate);
        var request = await ApiProtocol.ReadBodyAsync<ApproveIncomeRequest>(context.Request, cancellationToken);
        var route = $"/api/v1/income-rules/{id:D}/occurrences/{date:yyyy-MM-dd}/approve";
        var command = AccountEndpoints.Command(context, "POST", route, request);
        var result = await new CommandPipeline(store, clock, newId).ExecuteAsync(owner, command, events =>
        {
            var account = FinancialEndpointSupport.RequireAccount(owner, events);
            var today = FinancialEndpointSupport.OwnerToday(clock, account.TimeZone);
            var replay = IncomeRuleEventReplay.Read(events);
            var rule = replay.Rules.GetValueOrDefault(id) ?? throw FinancialEndpointSupport.NotFound();
            var revision = rule.RevisionFor(date);
            if (date > today) throw FinancialEndpointSupport.Error(422, "future_occurrence", "A future income occurrence cannot be decided.", "scheduledDate");
            if (revision is null || ScheduleExpansion.Expand(revision.Schedule, date, date).Count == 0)
                throw FinancialEndpointSupport.Error(422, "invalid_occurrence", "The date is not a scheduled occurrence for this rule.", "scheduledDate");
            if (request.ReceivedDate > today)
                throw FinancialEndpointSupport.Error(422, "future_financial_date", "Received date cannot be after today.", "receivedDate");

            var actualDefaults = IncomeRuleEndpoints.BuildDefaults(owner, events, request.AmountMinor,
                revision.Defaults.Source, request.Split, revision.Defaults);
            IncomeDecision decision;
            try
            {
                decision = IncomeDecision.Approve(rule, date, request.ReceivedDate, today,
                    new IncomeActuals(actualDefaults.AmountMinor, actualDefaults.SplitMode, actualDefaults.Allocations),
                    replay.Decisions.Where(item => item.RuleId == id).ToArray(),
                    HorseProjection.Replay(events).Where(horse => horse.Status is HorseStatus.Active or HorseStatus.Leased)
                        .Select(horse => horse.HorseId).ToHashSet());
            }
            catch (InvalidOperationException)
            { throw FinancialEndpointSupport.Error(409, "already_decided", "This income occurrence already has a final decision."); }
            catch (ArgumentException exception)
            { throw FinancialEndpointSupport.Error(422, "invalid_occurrence", exception.Message, "scheduledDate"); }

            return AccountEndpoints.Event("RecurringIncomeApproved", new
            {
                ruleId = id, scheduledDate = date, receivedDate = request.ReceivedDate,
                amountMinor = actualDefaults.AmountMinor, allocations = actualDefaults.Allocations,
                nextDueDate = decision.NextDueDate, splitMode = actualDefaults.SplitMode.ToString()
            });
        }, (accepted, _) => AccountEndpoints.Response(accepted.StreamVersion,
            new IncomeApprovalResponse(id, date, "Approved", $"income-rule/{id:D}/{date:yyyy-MM-dd}",
                IncomeRuleEventReplay.ReadNullableDate(accepted.Payload.GetProperty("nextDueDate")), accepted.StreamVersion)), cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    private static async Task<IResult> RejectAsync(HttpContext context, string ruleId, string scheduledDate,
        JsonlEventStore store, TimeProvider clock, Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var id = IncomeRuleEndpoints.ParseRuleId(ruleId);
        var date = ParseScheduledDate(scheduledDate);
        var request = await ApiProtocol.ReadBodyAsync<RejectIncomeRequest>(context.Request, cancellationToken);
        if (request is null) throw FinancialEndpointSupport.Error(400, "malformed_request", "A JSON object is required.");
        var route = $"/api/v1/income-rules/{id:D}/occurrences/{date:yyyy-MM-dd}/reject";
        var command = AccountEndpoints.Command(context, "POST", route, request);
        var result = await new CommandPipeline(store, clock, newId).ExecuteAsync(owner, command, events =>
        {
            var account = FinancialEndpointSupport.RequireAccount(owner, events);
            var today = FinancialEndpointSupport.OwnerToday(clock, account.TimeZone);
            var replay = IncomeRuleEventReplay.Read(events);
            var rule = replay.Rules.GetValueOrDefault(id) ?? throw FinancialEndpointSupport.NotFound();
            var revision = rule.RevisionFor(date);
            if (date > today) throw FinancialEndpointSupport.Error(422, "future_occurrence", "A future income occurrence cannot be decided.", "scheduledDate");
            if (revision is null || ScheduleExpansion.Expand(revision.Schedule, date, date).Count == 0)
                throw FinancialEndpointSupport.Error(422, "invalid_occurrence", "The date is not a scheduled occurrence for this rule.", "scheduledDate");
            IncomeDecision decision;
            try { decision = IncomeDecision.Reject(rule, date, today, replay.Decisions.Where(item => item.RuleId == id).ToArray()); }
            catch (InvalidOperationException)
            { throw FinancialEndpointSupport.Error(409, "already_decided", "This income occurrence already has a final decision."); }
            catch (ArgumentException exception)
            { throw FinancialEndpointSupport.Error(422, "invalid_occurrence", exception.Message, "scheduledDate"); }
            return AccountEndpoints.Event("RecurringIncomeRejected", new { ruleId = id, scheduledDate = date, nextDueDate = decision.NextDueDate });
        }, (accepted, _) => AccountEndpoints.Response(accepted.StreamVersion,
            new IncomeApprovalResponse(id, date, "Rejected", null,
                IncomeRuleEventReplay.ReadNullableDate(accepted.Payload.GetProperty("nextDueDate")), accepted.StreamVersion)), cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    private static DateOnly ParseScheduledDate(string value)
    {
        if (!DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date) ||
            date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) != value)
            throw FinancialEndpointSupport.Error(400, "malformed_request", "Scheduled date must use ISO calendar format.", "scheduledDate");
        return date;
    }

    public sealed record ApproveIncomeRequest(DateOnly ReceivedDate, long AmountMinor, SplitRequest Split);
    public sealed record RejectIncomeRequest;
    public sealed record IncomeApprovalItem(Guid RuleId, DateOnly ScheduledDate, long AmountMinor, string Source,
        string SplitMode, IReadOnlyList<Allocation> Allocations);
    public sealed record IncomeApprovalListResponse(IReadOnlyList<IncomeApprovalItem> Items, string? NextCursor,
        DateOnly From, DateOnly Through, DateOnly AsOfDate, long StreamVersion);
    public sealed record IncomeApprovalResponse(Guid RuleId, DateOnly ScheduledDate, string Decision,
        string? RealizedIncomeId, DateOnly? NextDueDate, long StreamVersion);
}
