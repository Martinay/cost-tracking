using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Features.Expenses;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.ExpenseRules;

public static class ExpenseOccurrenceEndpoints
{
    public static IEndpointRouteBuilder MapExpenseOccurrenceEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPut("/api/v1/expense-rules/{ruleId}/occurrences/{scheduledDate}", OverrideAsync)
            .Accepts<OverrideExpenseOccurrenceRequest>("application/json")
            .Produces<ExpenseOccurrenceCommandResponse>(StatusCodes.Status200OK, "application/json");
        return endpoints;
    }

    private static async Task<IResult> OverrideAsync(HttpContext context, string ruleId, string scheduledDate,
        JsonlEventStore store, TimeProvider clock, Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var id = ExpenseRuleEndpoints.ParseRuleId(ruleId);
        if (!DateOnly.TryParseExact(scheduledDate, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var date) || date.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture) != scheduledDate)
            throw FinancialEndpointSupport.Error(400, "malformed_request", "Scheduled date must use ISO calendar format.", "scheduledDate");
        var request = await ApiProtocol.ReadBodyAsync<OverrideExpenseOccurrenceRequest>(context.Request, cancellationToken);
        var command = AccountEndpoints.Command(context, "PUT", $"/api/v1/expense-rules/{id:D}/occurrences/{scheduledDate}", request);
        var result = await new CommandPipeline(store, clock, newId).ExecuteAsync(owner, command, events =>
        {
            var account = FinancialEndpointSupport.RequireAccount(owner, events);
            var replay = RecurringExpenseProjection.Read(events);
            var rule = replay.Rules.GetValueOrDefault(id) ?? throw FinancialEndpointSupport.NotFound();
            if (!Enum.TryParse<ExpenseOccurrenceAction>(request.Action, false, out var action) ||
                !Enum.IsDefined(action) || action.ToString() != request.Action)
                throw FinancialEndpointSupport.Error(422, "invalid_occurrence", "Occurrence action must be Changed or Skipped.", "action");

            ExpenseRuleDefaults? changed = null;
            if (request.Changed is not null)
            {
                var revision = rule.RevisionFor(date);
                if (revision is null) throw FinancialEndpointSupport.Error(422, "invalid_occurrence", "The scheduled date is not part of this rule.", "scheduledDate");
                changed = ExpenseRuleEndpoints.BuildDefaults(owner, events, request.Changed.AmountMinor,
                    request.Changed.Category, request.Changed.Description, request.Changed.Split, revision.Defaults);
            }

            var eligible = HorseProjection.Replay(events).Where(horse => horse.Status is HorseStatus.Active or HorseStatus.Leased)
                .Select(horse => horse.HorseId).ToHashSet();
            try
            {
                var created = ExpenseOccurrenceOverride.Create(newId(), events.Count + 1, rule, date, action, changed,
                    replay.Overrides.Where(item => item.RuleId == id && item.ScheduledDate == date).ToArray(), eligible);
                return AccountEndpoints.Event("RecurringExpenseOccurrenceOverridden", new
                {
                    ruleId = created.RuleId, scheduledDate = created.ScheduledDate,
                    action = created.Action.ToString(), changed = created.Changed
                });
            }
            catch (ArgumentException exception)
            {
                if (exception.Message.Contains("eligible horses", StringComparison.OrdinalIgnoreCase))
                    throw FinancialEndpointSupport.Error(422, "inactive_horse", exception.Message, "changed.split");
                throw FinancialEndpointSupport.Error(422, "invalid_occurrence", exception.Message, "scheduledDate");
            }
        }, (accepted, _) => AccountEndpoints.Response(accepted.StreamVersion,
            new ExpenseOccurrenceCommandResponse(id, date, request.Action, accepted.StreamVersion)), cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    public sealed record ChangedOccurrenceRequest(long AmountMinor, string Category, string Description, SplitRequest Split);
    public sealed record OverrideExpenseOccurrenceRequest(string Action, ChangedOccurrenceRequest? Changed);
    public sealed record ExpenseOccurrenceCommandResponse(Guid RuleId, DateOnly ScheduledDate, string Action, long StreamVersion);
}
