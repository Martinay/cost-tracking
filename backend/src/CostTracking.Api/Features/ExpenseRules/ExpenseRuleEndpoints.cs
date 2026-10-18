using System.Globalization;
using System.Text.Json;
using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Features.Expenses;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.ExpenseRules;

public static class ExpenseRuleEndpoints
{
    public static IEndpointRouteBuilder MapExpenseRuleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/expense-rules", ListAsync)
            .Produces<ExpenseRuleListResponse>(StatusCodes.Status200OK, "application/json");
        endpoints.MapPost("/api/v1/expense-rules", CreateAsync)
            .Accepts<CreateExpenseRuleRequest>("application/json")
            .Produces<ExpenseRuleCommandResponse>(StatusCodes.Status201Created, "application/json");
        endpoints.MapPatch("/api/v1/expense-rules/{ruleId}", ReviseAsync)
            .Accepts<ReviseExpenseRuleRequest>("application/json")
            .Produces<ExpenseRuleCommandResponse>(StatusCodes.Status200OK, "application/json");
        endpoints.MapPost("/api/v1/expense-rules/{ruleId}/stop", StopAsync)
            .Accepts<StopExpenseRuleRequest>("application/json")
            .Produces<ExpenseRuleStopResponse>(StatusCodes.Status200OK, "application/json");
        return endpoints;
    }

    private static async Task<IResult> ListAsync(HttpContext context, JsonlEventStore store, CursorCodec cursorCodec,
        TimeProvider clock, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var events = await store.ReadAsync(owner, cancellationToken);
        var account = FinancialEndpointSupport.RequireAccount(owner, events);
        var asOfDate = FinancialEndpointSupport.OwnerToday(clock, account.TimeZone);
        var limit = ApiProtocol.ListLimit(context.Request.Query["limit"].FirstOrDefault());
        var filter = $"expense-rules;limit={limit}";
        var position = context.Request.Query["cursor"].FirstOrDefault() is { } cursor
            ? cursorCodec.Decode(cursor, owner, filter, account.StreamVersion, asOfDate)
            : null;
        var rules = RecurringExpenseProjection.Read(events).Rules.Values
            .Where(rule => position is null || StringComparer.Ordinal.Compare(RulePosition(rule.RuleId), position) > 0)
            .OrderBy(rule => RulePosition(rule.RuleId), StringComparer.Ordinal).ToArray();
        var page = rules.Take(limit + 1).ToArray();
        var hasMore = page.Length > limit;
        var items = page.Take(limit).Select(rule => ToResponse(rule, asOfDate)).ToArray();
        var nextCursor = hasMore ? cursorCodec.Encode(owner, filter, account.StreamVersion, asOfDate, RulePosition(items[^1].RuleId)) : null;
        return await AccountEndpoints.WriteAsync(context, StatusCodes.Status200OK,
            new { items, nextCursor, streamVersion = account.StreamVersion }, account.StreamVersion);
    }

    private static async Task<IResult> CreateAsync(HttpContext context, JsonlEventStore store, TimeProvider clock,
        Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var request = await ApiProtocol.ReadBodyAsync<CreateExpenseRuleRequest>(context.Request, cancellationToken);
        var command = AccountEndpoints.Command(context, "POST", "/api/v1/expense-rules", request);
        var result = await new CommandPipeline(store, clock, newId).ExecuteAsync(owner, command, events =>
        {
            var account = FinancialEndpointSupport.RequireAccount(owner, events);
            var schedule = BuildSchedule(request.Schedule);
            var defaults = BuildDefaults(owner, events, request.AmountMinor, request.Category, request.Description,
                request.Split, previous: null);
            var ruleId = newId();
            var initial = new RuleRevision(schedule.StartDate, schedule, defaults);
            _ = RecurringExpenseRule.Create(ruleId, initial, FinancialEndpointSupport.OwnerToday(clock, account.TimeZone));
            return AccountEndpoints.Event("RecurringExpenseRuleCreated", RulePayload(ruleId, initial));
        }, (accepted, _) => AccountEndpoints.CreatedResponse(accepted.StreamVersion,
            new ExpenseRuleCommandResponse(accepted.Payload.GetProperty("ruleId").GetGuid(), accepted.StreamVersion)), cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    private static async Task<IResult> ReviseAsync(HttpContext context, string ruleId, JsonlEventStore store,
        TimeProvider clock, Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var id = ParseRuleId(ruleId);
        var request = await ApiProtocol.ReadBodyAsync<ReviseExpenseRuleRequest>(context.Request, cancellationToken);
        var command = AccountEndpoints.Command(context, "PATCH", $"/api/v1/expense-rules/{id:D}", request);
        var result = await new CommandPipeline(store, clock, newId).ExecuteAsync(owner, command, events =>
        {
            var account = FinancialEndpointSupport.RequireAccount(owner, events);
            var replay = RecurringExpenseProjection.Read(events);
            var rule = replay.Rules.GetValueOrDefault(id) ?? throw FinancialEndpointSupport.NotFound();
            var schedule = BuildSchedule(request.Schedule);
            var priorDefaults = rule.RevisionFor(request.EffectiveFrom)?.Defaults ?? rule.Revisions[^1].Defaults;
            var defaults = BuildDefaults(owner, events, request.AmountMinor, request.Category, request.Description,
                request.Split, priorDefaults);
            var revision = new RuleRevision(request.EffectiveFrom, schedule, defaults);
            var today = FinancialEndpointSupport.OwnerToday(clock, account.TimeZone);
            var protectedDates = replay.Overrides.Where(item => item.RuleId == id).Select(item => item.ScheduledDate).ToArray();
            if (rule.LastDate.HasValue) throw FinancialEndpointSupport.Error(409, "rule_stopped", "A stopped rule cannot be revised.");
            if (request.EffectiveFrom <= rule.Revisions[^1].EffectiveFrom || request.EffectiveFrom <= today)
                throw FinancialEndpointSupport.Error(422, "invalid_schedule", "A revision must start after today and after queued revisions.", "effectiveFrom");
            if (protectedDates.Any(date => request.EffectiveFrom <= date))
                throw FinancialEndpointSupport.Error(409, "protected_occurrence", "A revision cannot change a protected occurrence.", "effectiveFrom");
            var revised = rule.Revise(revision, today, protectedDates);
            _ = revised;
            return AccountEndpoints.Event("RecurringExpenseRuleUpdated", RulePayload(id, revision));
        }, (accepted, _) => AccountEndpoints.Response(accepted.StreamVersion,
            new ExpenseRuleCommandResponse(id, accepted.StreamVersion)), cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    private static async Task<IResult> StopAsync(HttpContext context, string ruleId, JsonlEventStore store,
        TimeProvider clock, Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var id = ParseRuleId(ruleId);
        var request = await ApiProtocol.ReadBodyAsync<StopExpenseRuleRequest>(context.Request, cancellationToken);
        var command = AccountEndpoints.Command(context, "POST", $"/api/v1/expense-rules/{id:D}/stop", request);
        var result = await new CommandPipeline(store, clock, newId).ExecuteAsync(owner, command, events =>
        {
            var account = FinancialEndpointSupport.RequireAccount(owner, events);
            var replay = RecurringExpenseProjection.Read(events);
            var rule = replay.Rules.GetValueOrDefault(id) ?? throw FinancialEndpointSupport.NotFound();
            var today = FinancialEndpointSupport.OwnerToday(clock, account.TimeZone);
            if (rule.LastDate.HasValue) throw FinancialEndpointSupport.Error(409, "rule_stopped", "A stopped rule is terminal.");
            var protectedDates = replay.Overrides.Where(item => item.RuleId == id).Select(item => item.ScheduledDate).ToArray();
            if (protectedDates.Any(date => request.LastDate < date))
                throw FinancialEndpointSupport.Error(409, "protected_occurrence", "The stop date cannot precede a protected occurrence.", "lastDate");
            if (request.LastDate < today || request.LastDate < rule.StartDate || rule.Revisions.Any(item => request.LastDate < item.EffectiveFrom))
                throw FinancialEndpointSupport.Error(422, "invalid_stop_date", "The stop date must include today, the rule start, and queued revisions.", "lastDate");
            _ = rule.Stop(request.LastDate, today, protectedDates);
            return AccountEndpoints.Event("RecurringExpenseRuleStopped", new { ruleId = id, lastDate = request.LastDate });
        }, (accepted, _) => AccountEndpoints.Response(accepted.StreamVersion,
            new ExpenseRuleStopResponse(id, request.LastDate, accepted.StreamVersion)), cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    internal static Schedule BuildSchedule(ScheduleRequest request)
    {
        try
        {
            ArgumentNullException.ThrowIfNull(request);
            return new Schedule(request.Cadence, request.Interval, request.Weekdays, request.DayOfMonth, request.StartDate, request.EndDate);
        }
        catch (ArgumentException exception) { throw FinancialEndpointSupport.Error(422, "invalid_schedule", exception.Message, "schedule"); }
    }

    internal static ExpenseRuleDefaults BuildDefaults(string owner, IReadOnlyList<EventEnvelope> events, long amount,
        string category, string description, SplitRequest split, ExpenseRuleDefaults? previous)
    {
        if (split is null) throw FinancialEndpointSupport.Error(422, "invalid_split", "A split is required.", "split");
        IReadOnlyList<Allocation> allocations;
        SplitMode mode;
        try
        {
            if (!Enum.TryParse<SplitMode>(split.Mode, false, out mode) || !Enum.IsDefined(mode) || mode.ToString() != split.Mode)
                throw new ArgumentException("Split mode is invalid.");
            allocations = mode switch
            {
                SplitMode.Equal when split.HorseIds is { } ids && split.Shares is null => AllocationCalculator.Equal(amount, ids),
                SplitMode.Custom when split.Shares is { } shares && split.HorseIds is null => AllocationCalculator.Custom(amount,
                    shares.Select(item => new CustomShare(item.HorseId, item.Weight)).ToArray()),
                _ => throw new ArgumentException("Split fields do not match the selected mode.")
            };
        }
        catch (Exception exception) when (exception is ArgumentException or OverflowException)
        { throw FinancialEndpointSupport.Error(422, "invalid_split", "Split targets, weights, amount, or mode are invalid.", "split"); }

        var horses = HorseProjection.Replay(events).ToDictionary(horse => horse.HorseId);
        if (allocations.Any(item => !horses.ContainsKey(item.HorseId))) throw FinancialEndpointSupport.NotFound();
        var sameTargets = previous is not null && previous.SplitMode == mode && SplitTargets(previous.Allocations).SequenceEqual(SplitTargets(allocations));
        var eligible = horses.Values.Where(horse => horse.Status is HorseStatus.Active or HorseStatus.Leased).Select(horse => horse.HorseId).ToHashSet();
        if (!sameTargets && allocations.Any(item => !eligible.Contains(item.HorseId)))
            throw FinancialEndpointSupport.Error(422, "inactive_horse", "New recurring allocation targets require active or leased horses.", "split");
        try { return new ExpenseRuleDefaults(amount, category, description, mode, allocations); }
        catch (ArgumentException exception) { throw FinancialEndpointSupport.Error(422, "invalid_rule_defaults", exception.Message); }
    }

    internal static object RulePayload(Guid ruleId, RuleRevision revision) => new
    {
        ruleId, effectiveFrom = revision.EffectiveFrom, schedule = revision.Schedule,
        defaults = revision.Defaults
    };

    private static ExpenseRuleResponse ToResponse(RecurringExpenseRule rule, DateOnly asOfDate)
    {
        var selected = rule.RevisionFor(asOfDate) ?? rule.Revisions.First(revision => revision.EffectiveFrom >= asOfDate || revision == rule.Revisions[0]);
        var revisions = rule.Revisions.Select(revision => new RuleRevisionResponse(revision.EffectiveFrom, revision.Schedule,
            revision.Defaults)).ToArray();
        return new ExpenseRuleResponse(rule.RuleId, rule.StartDate, selected.EffectiveFrom, selected.Schedule, selected.Defaults,
            revisions, rule.LastDate);
    }

    private static string RulePosition(Guid id) => id.ToString("D").ToLowerInvariant();
    private static IEnumerable<(Guid HorseId, int Weight)> SplitTargets(IEnumerable<Allocation> allocations) =>
        allocations.OrderBy(item => item.HorseId.ToString("D").ToLowerInvariant(), StringComparer.Ordinal).Select(item => (item.HorseId, item.Weight));

    internal static Guid ParseRuleId(string value) => Guid.TryParseExact(value, "D", out var id) && id != Guid.Empty
        ? id : throw FinancialEndpointSupport.Error(400, "malformed_request", "Rule ID must be a nonempty UUID.", "ruleId");

    public sealed record ScheduleRequest(Cadence Cadence, int Interval, IReadOnlyList<int> Weekdays, int? DayOfMonth,
        DateOnly StartDate, DateOnly? EndDate);
    public sealed record CreateExpenseRuleRequest(ScheduleRequest Schedule, long AmountMinor, string Category,
        string Description, SplitRequest Split);
    public sealed record ReviseExpenseRuleRequest(DateOnly EffectiveFrom, ScheduleRequest Schedule, long AmountMinor,
        string Category, string Description, SplitRequest Split);
    public sealed record StopExpenseRuleRequest(DateOnly LastDate);
    public sealed record RuleRevisionResponse(DateOnly EffectiveFrom, Schedule Schedule, ExpenseRuleDefaults Defaults);
    public sealed record ExpenseRuleResponse(Guid RuleId, DateOnly StartDate, DateOnly EffectiveFrom, Schedule Schedule,
        ExpenseRuleDefaults Defaults, IReadOnlyList<RuleRevisionResponse> Revisions, DateOnly? LastDate);
    public sealed record ExpenseRuleCommandResponse(Guid RuleId, long StreamVersion);
    public sealed record ExpenseRuleStopResponse(Guid RuleId, DateOnly LastDate, long StreamVersion);
    public sealed record ExpenseRuleListResponse(IReadOnlyList<ExpenseRuleResponse> Items, string? NextCursor, long StreamVersion);
}
