using System.Globalization;
using System.Text.Json;
using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Features.Expenses;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.IncomeRules;

public static class IncomeRuleEndpoints
{
    public static IEndpointRouteBuilder MapIncomeRuleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/v1/income-rules", ListAsync)
            .Produces<IncomeRuleListResponse>(StatusCodes.Status200OK, "application/json");
        endpoints.MapPost("/api/v1/income-rules", CreateAsync)
            .Accepts<CreateIncomeRuleRequest>("application/json")
            .Produces<IncomeRuleCommandResponse>(StatusCodes.Status201Created, "application/json");
        endpoints.MapPatch("/api/v1/income-rules/{ruleId}", ReviseAsync)
            .Accepts<ReviseIncomeRuleRequest>("application/json")
            .Produces<IncomeRuleCommandResponse>(StatusCodes.Status200OK, "application/json");
        endpoints.MapPost("/api/v1/income-rules/{ruleId}/stop", StopAsync)
            .Accepts<StopIncomeRuleRequest>("application/json")
            .Produces<IncomeRuleStopResponse>(StatusCodes.Status200OK, "application/json");
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
        var filter = $"income-rules;limit={limit}";
        var position = context.Request.Query["cursor"].FirstOrDefault() is { } cursor
            ? cursorCodec.Decode(cursor, owner, filter, account.StreamVersion, asOfDate)
            : null;
        var rules = IncomeRuleEventReplay.Read(events).Rules.Values
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
        var request = await ApiProtocol.ReadBodyAsync<CreateIncomeRuleRequest>(context.Request, cancellationToken);
        var command = AccountEndpoints.Command(context, "POST", "/api/v1/income-rules", request);
        var result = await new CommandPipeline(store, clock, newId).ExecuteAsync(owner, command, events =>
        {
            var account = FinancialEndpointSupport.RequireAccount(owner, events);
            var schedule = BuildSchedule(request.Schedule);
            var defaults = BuildDefaults(owner, events, request.AmountMinor, request.Source, request.Split, previous: null);
            var id = newId();
            var revision = new IncomeRuleRevision(schedule.StartDate, schedule, defaults);
            _ = RecurringIncomeRule.Create(id, revision, FinancialEndpointSupport.OwnerToday(clock, account.TimeZone));
            return AccountEndpoints.Event("RecurringIncomeRuleCreated", RulePayload(id, revision));
        }, (accepted, _) => AccountEndpoints.CreatedResponse(accepted.StreamVersion,
            new IncomeRuleCommandResponse(accepted.Payload.GetProperty("ruleId").GetGuid(), accepted.StreamVersion)), cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    private static async Task<IResult> ReviseAsync(HttpContext context, string ruleId, JsonlEventStore store,
        TimeProvider clock, Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var id = ParseRuleId(ruleId);
        var request = await ApiProtocol.ReadBodyAsync<ReviseIncomeRuleRequest>(context.Request, cancellationToken);
        var command = AccountEndpoints.Command(context, "PATCH", $"/api/v1/income-rules/{id:D}", request);
        var result = await new CommandPipeline(store, clock, newId).ExecuteAsync(owner, command, events =>
        {
            var account = FinancialEndpointSupport.RequireAccount(owner, events);
            var replay = IncomeRuleEventReplay.Read(events);
            var rule = replay.Rules.GetValueOrDefault(id) ?? throw FinancialEndpointSupport.NotFound();
            if (rule.LastDate.HasValue) throw FinancialEndpointSupport.Error(409, "rule_stopped", "A stopped income rule cannot be revised.");
            var schedule = BuildSchedule(request.Schedule);
            var previousDefaults = rule.RevisionFor(request.EffectiveFrom)?.Defaults ?? rule.Revisions[^1].Defaults;
            var defaults = BuildDefaults(owner, events, request.AmountMinor, request.Source, request.Split, previousDefaults);
            var revision = new IncomeRuleRevision(request.EffectiveFrom, schedule, defaults);
            var today = FinancialEndpointSupport.OwnerToday(clock, account.TimeZone);
            var protectedDates = replay.Decisions.Where(item => item.RuleId == id).Select(item => item.ScheduledDate).ToArray();
            if (request.EffectiveFrom <= rule.Revisions[^1].EffectiveFrom || request.EffectiveFrom <= today)
                throw FinancialEndpointSupport.Error(422, "invalid_schedule", "A revision must start after today and after queued revisions.", "effectiveFrom");
            if (protectedDates.Any(date => request.EffectiveFrom <= date))
                throw FinancialEndpointSupport.Error(409, "protected_occurrence", "A revision cannot change a decided income occurrence.", "effectiveFrom");
            try { _ = rule.Revise(revision, today, protectedDates); }
            catch (ArgumentException exception)
            { throw FinancialEndpointSupport.Error(422, "invalid_schedule", exception.Message, "schedule"); }
            return AccountEndpoints.Event("RecurringIncomeRuleUpdated", RulePayload(id, revision));
        }, (accepted, _) => AccountEndpoints.Response(accepted.StreamVersion,
            new IncomeRuleCommandResponse(id, accepted.StreamVersion)), cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    private static async Task<IResult> StopAsync(HttpContext context, string ruleId, JsonlEventStore store,
        TimeProvider clock, Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var id = ParseRuleId(ruleId);
        var request = await ApiProtocol.ReadBodyAsync<StopIncomeRuleRequest>(context.Request, cancellationToken);
        var command = AccountEndpoints.Command(context, "POST", $"/api/v1/income-rules/{id:D}/stop", request);
        var result = await new CommandPipeline(store, clock, newId).ExecuteAsync(owner, command, events =>
        {
            var account = FinancialEndpointSupport.RequireAccount(owner, events);
            var replay = IncomeRuleEventReplay.Read(events);
            var rule = replay.Rules.GetValueOrDefault(id) ?? throw FinancialEndpointSupport.NotFound();
            if (rule.LastDate.HasValue) throw FinancialEndpointSupport.Error(409, "rule_stopped", "A stopped income rule is terminal.");
            var today = FinancialEndpointSupport.OwnerToday(clock, account.TimeZone);
            var protectedDates = replay.Decisions.Where(item => item.RuleId == id).Select(item => item.ScheduledDate).ToArray();
            if (protectedDates.Any(date => request.LastDate < date))
                throw FinancialEndpointSupport.Error(409, "protected_occurrence", "The stop date cannot precede a decided income occurrence.", "lastDate");
            if (request.LastDate < today || request.LastDate < rule.StartDate || rule.Revisions.Any(item => request.LastDate < item.EffectiveFrom))
                throw FinancialEndpointSupport.Error(422, "invalid_stop_date", "The stop date must include today, the rule start, and queued revisions.", "lastDate");
            _ = rule.Stop(request.LastDate, today, protectedDates);
            return AccountEndpoints.Event("RecurringIncomeRuleStopped", new { ruleId = id, lastDate = request.LastDate });
        }, (accepted, _) => AccountEndpoints.Response(accepted.StreamVersion,
            new IncomeRuleStopResponse(id, request.LastDate, accepted.StreamVersion)), cancellationToken);
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

    internal static IncomeRuleDefaults BuildDefaults(string owner, IReadOnlyList<EventEnvelope> events, long amount,
        string source, SplitRequest split, IncomeRuleDefaults? previous)
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
            throw FinancialEndpointSupport.Error(422, "inactive_horse", "Changed income splits require active or leased horses.", "split");
        string normalizedSource;
        try { normalizedSource = FinancialEndpointSupport.ValidateSource(source); }
        catch (ApiException) { throw; }
        try { return new IncomeRuleDefaults(amount, normalizedSource, mode, allocations); }
        catch (ArgumentException exception) { throw FinancialEndpointSupport.Error(422, "invalid_rule_defaults", exception.Message); }
    }

    internal static object RulePayload(Guid ruleId, IncomeRuleRevision revision) => new
    {
        ruleId, effectiveFrom = revision.EffectiveFrom, schedule = revision.Schedule, defaults = revision.Defaults
    };

    internal static Guid ParseRuleId(string value) => Guid.TryParseExact(value, "D", out var id) && id != Guid.Empty
        ? id : throw FinancialEndpointSupport.Error(400, "malformed_request", "Rule ID must be a nonempty UUID.", "ruleId");

    private static IncomeRuleResponse ToResponse(RecurringIncomeRule rule, DateOnly asOfDate)
    {
        var selected = rule.RevisionFor(asOfDate) ?? rule.Revisions.First(revision => revision.EffectiveFrom >= asOfDate || revision == rule.Revisions[0]);
        var revisions = rule.Revisions.Select(revision => new IncomeRuleRevisionResponse(revision.EffectiveFrom,
            revision.Schedule, revision.Defaults)).ToArray();
        return new IncomeRuleResponse(rule.RuleId, rule.StartDate, selected.EffectiveFrom, selected.Schedule,
            selected.Defaults, revisions, rule.LastDate);
    }

    private static string RulePosition(Guid id) => id.ToString("D").ToLowerInvariant();
    private static IEnumerable<(Guid HorseId, int Weight)> SplitTargets(IEnumerable<Allocation> allocations) =>
        allocations.OrderBy(item => item.HorseId.ToString("D").ToLowerInvariant(), StringComparer.Ordinal)
            .Select(item => (item.HorseId, item.Weight));

    public sealed record ScheduleRequest(Cadence Cadence, int Interval, IReadOnlyList<int> Weekdays, int? DayOfMonth,
        DateOnly StartDate, DateOnly? EndDate);
    public sealed record CreateIncomeRuleRequest(ScheduleRequest Schedule, long AmountMinor, string Source, SplitRequest Split);
    public sealed record ReviseIncomeRuleRequest(DateOnly EffectiveFrom, ScheduleRequest Schedule, long AmountMinor,
        string Source, SplitRequest Split);
    public sealed record StopIncomeRuleRequest(DateOnly LastDate);
    public sealed record IncomeRuleRevisionResponse(DateOnly EffectiveFrom, Schedule Schedule, IncomeRuleDefaults Defaults);
    public sealed record IncomeRuleResponse(Guid RuleId, DateOnly StartDate, DateOnly EffectiveFrom, Schedule Schedule,
        IncomeRuleDefaults Defaults, IReadOnlyList<IncomeRuleRevisionResponse> Revisions, DateOnly? LastDate);
    public sealed record IncomeRuleCommandResponse(Guid RuleId, long StreamVersion);
    public sealed record IncomeRuleStopResponse(Guid RuleId, DateOnly LastDate, long StreamVersion);
    public sealed record IncomeRuleListResponse(IReadOnlyList<IncomeRuleResponse> Items, string? NextCursor, long StreamVersion);
}

internal sealed record IncomeRuleReplay(Dictionary<Guid, RecurringIncomeRule> Rules, List<IncomeDecision> Decisions);

internal static class IncomeRuleEventReplay
{
    public static IncomeRuleReplay Read(IReadOnlyList<EventEnvelope> events)
    {
        var rules = new Dictionary<Guid, RecurringIncomeRule>();
        var decisions = new List<IncomeDecision>();
        foreach (var envelope in events)
        {
            var payload = envelope.Payload;
            switch (envelope.Type)
            {
                case "RecurringIncomeRuleCreated":
                {
                    var id = payload.GetProperty("ruleId").GetGuid();
                    var revision = ReadRevision(payload);
                    rules.Add(id, RecurringIncomeRule.Create(id, revision, revision.EffectiveFrom));
                    break;
                }
                case "RecurringIncomeRuleUpdated":
                {
                    var id = payload.GetProperty("ruleId").GetGuid();
                    if (!rules.TryGetValue(id, out var rule)) throw new InvalidDataException("Income rule update references a missing rule.");
                    var revision = ReadRevision(payload);
                    var protectedDates = decisions.Where(item => item.RuleId == id).Select(item => item.ScheduledDate).ToArray();
                    var today = revision.EffectiveFrom == DateOnly.MinValue ? DateOnly.MinValue : revision.EffectiveFrom.AddDays(-1);
                    rules[id] = rule.Revise(revision, today, protectedDates);
                    break;
                }
                case "RecurringIncomeRuleStopped":
                {
                    var id = payload.GetProperty("ruleId").GetGuid();
                    if (!rules.TryGetValue(id, out var rule)) throw new InvalidDataException("Income rule stop references a missing rule.");
                    var lastDate = ReadDate(payload.GetProperty("lastDate"));
                    var protectedDates = decisions.Where(item => item.RuleId == id).Select(item => item.ScheduledDate).ToArray();
                    rules[id] = rule.Stop(lastDate, lastDate, protectedDates);
                    break;
                }
                case "RecurringIncomeApproved":
                {
                    var id = payload.GetProperty("ruleId").GetGuid();
                    if (!rules.TryGetValue(id, out var rule)) throw new InvalidDataException("Income approval references a missing rule.");
                    var scheduledDate = ReadDate(payload.GetProperty("scheduledDate"));
                    var allocations = payload.GetProperty("allocations").Deserialize<Allocation[]>(ApiProtocol.JsonOptions)!;
                    var actuals = new IncomeActuals(payload.GetProperty("amountMinor").GetInt64(),
                        Enum.Parse<SplitMode>(payload.GetProperty("splitMode").GetString()!, false), allocations);
                    var eligibleIds = RegisteredHorseIds(events, envelope.StreamVersion);
                    var decision = IncomeDecision.Approve(rule, scheduledDate, ReadDate(payload.GetProperty("receivedDate")),
                        DateOnly.MaxValue, actuals, decisions.Where(item => item.RuleId == id).ToArray(), eligibleIds);
                    if (decision.NextDueDate != ReadNullableDate(payload.GetProperty("nextDueDate")))
                        throw new InvalidDataException("Stored next due hint does not match the accepted decision order.");
                    decisions.Add(decision);
                    break;
                }
                case "RecurringIncomeRejected":
                {
                    var id = payload.GetProperty("ruleId").GetGuid();
                    if (!rules.TryGetValue(id, out var rule)) throw new InvalidDataException("Income rejection references a missing rule.");
                    var scheduledDate = ReadDate(payload.GetProperty("scheduledDate"));
                    var decision = IncomeDecision.Reject(rule, scheduledDate, DateOnly.MaxValue,
                        decisions.Where(item => item.RuleId == id).ToArray());
                    if (decision.NextDueDate != ReadNullableDate(payload.GetProperty("nextDueDate")))
                        throw new InvalidDataException("Stored next due hint does not match the accepted decision order.");
                    decisions.Add(decision);
                    break;
                }
            }
        }
        return new IncomeRuleReplay(rules, decisions);
    }

    public static IncomeRuleRevision ReadRevision(JsonElement payload) => new(ReadDate(payload.GetProperty("effectiveFrom")),
        payload.GetProperty("schedule").Deserialize<Schedule>(ApiProtocol.JsonOptions)!, ReadDefaults(payload.GetProperty("defaults")));

    public static IncomeRuleDefaults ReadDefaults(JsonElement payload) => new(payload.GetProperty("amountMinor").GetInt64(),
        payload.GetProperty("source").GetString()!, Enum.Parse<SplitMode>(payload.GetProperty("splitMode").GetString()!, false),
        payload.GetProperty("allocations").Deserialize<Allocation[]>(ApiProtocol.JsonOptions)!);

    public static DateOnly ReadDate(JsonElement value) => DateOnly.ParseExact(value.GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture);
    public static DateOnly? ReadNullableDate(JsonElement value) => value.ValueKind == JsonValueKind.Null ? null : ReadDate(value);

    private static IReadOnlyCollection<Guid> RegisteredHorseIds(IReadOnlyList<EventEnvelope> events, long beforeVersion) =>
        events.Where(value => value.StreamVersion < beforeVersion && value.Type == "HorseRegistered")
            .Select(value => value.Payload.GetProperty("horseId").GetGuid()).ToHashSet();
}
