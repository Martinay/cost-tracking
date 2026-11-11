using System.Text.Json;
using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Features.Expenses;
using CostTracking.Api.Features.Income;
using CostTracking.Api.Features.Driving;
using CostTracking.Api.Features.ExpenseRules;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.Previews;

public static class FinancialPreviewEndpoints
{
    public static IEndpointRouteBuilder MapFinancialPreviewEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/v1/previews/financial", PreviewAsync)
            .Accepts<FinancialPreviewRequest>("application/json")
            .Produces<FinancialPreviewResponse>(StatusCodes.Status200OK, "application/json");
        return endpoints;
    }

    private static async Task<IResult> PreviewAsync(HttpContext context, JsonlEventStore store, TimeProvider clock,
        CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var request = await ApiProtocol.ReadBodyAsync<FinancialPreviewRequest>(context.Request, cancellationToken);
        var events = await store.ReadAsync(owner, cancellationToken);
        var account = FinancialEndpointSupport.RequireAccount(owner, events);
        var streamVersion = events.Count;
        if (request.Kind == "ExpenseOccurrenceChange")
        {
            var occurrencePreview = PreviewOccurrenceChange(owner, events, account.Currency, streamVersion, request);
            return await AccountEndpoints.WriteAsync(context, StatusCodes.Status200OK, occurrencePreview, streamVersion);
        }
        if (request.Kind is "ExpenseCorrection" or "IncomeCorrection")
        {
            var correctionKind = request.Kind == "ExpenseCorrection" ? "Expense" : "Income";
            if (request.RecordId is not { } id) throw FinancialEndpointSupport.Error(400, "malformed_request", "Correction record ID is required.");
            var replacement = JsonSerializer.SerializeToElement(CorrectionEndpoints.Prepare(owner, events, id, correctionKind, request.Values, "Preview", clock), ApiProtocol.JsonOptions);
            var oldExpense = correctionKind == "Expense" ? ExpenseProjection.Replay(events).Single(item => item.ExpenseId == id) : null;
            var oldIncome = correctionKind == "Income" ? IncomeProjection.Replay(events).Single(item => item.Id == id.ToString("D")) : null;
            var newDate = ExpenseProjection.ReadDate(replacement, correctionKind == "Expense" ? "expenseDate" : "receivedDate");
            var oldDate = oldExpense?.ExpenseDate ?? oldIncome!.ReceivedDate;
            var allocationsNew = ExpenseProjection.ReadAllocations(replacement.GetProperty("allocations"));
            var effects = (oldExpense?.Allocations ?? oldIncome!.Allocations).Select(a => new MonthlyEffect(oldDate.ToString("yyyy-MM"), a.HorseId, correctionKind == "Income" ? -a.AmountMinor : 0, correctionKind == "Expense" ? -a.AmountMinor : 0, correctionKind == "Income" ? -a.AmountMinor : a.AmountMinor))
                .Concat(allocationsNew.Select(a => new MonthlyEffect(newDate.ToString("yyyy-MM"), a.HorseId, correctionKind == "Income" ? a.AmountMinor : 0, correctionKind == "Expense" ? a.AmountMinor : 0, correctionKind == "Income" ? a.AmountMinor : -a.AmountMinor)))
                .GroupBy(e => (e.Month, e.HorseId)).Select(g => new MonthlyEffect(g.Key.Month, g.Key.HorseId, g.Sum(e=>e.IncomeDeltaMinor), g.Sum(e=>e.ExpenseDeltaMinor), g.Sum(e=>e.NetDeltaMinor))).ToArray();
            var responseCorrection = new FinancialPreviewResponse(account.Currency, newDate, replacement.GetProperty("amountMinor").GetInt64(), replacement.GetProperty("splitMode").GetString()!, allocationsNew, effects, streamVersion,
                oldExpense is not null && replacement.GetProperty("driving").ValueKind == JsonValueKind.Object ? replacement.GetProperty("driving").Deserialize<DrivingDetails>(ApiProtocol.JsonOptions) : null);
            return await AccountEndpoints.WriteAsync(context, 200, responseCorrection, streamVersion);
        }
        DateOnly? exampleDate = null;
        if (request.ExampleOccurrence && request.ExampleSchedule is { } schedule)
        {
            var from = request.EffectiveFrom is { } effective && effective > schedule.StartDate ? effective : schedule.StartDate;
            var end = schedule.EndDate ?? DateOnly.MaxValue;
            while (from <= end)
            {
                var through = from.Year > 9994 ? DateOnly.MaxValue : from.AddYears(5).AddDays(-1);
                if (through > end) through = end;
                exampleDate = ScheduleExpansion.Expand(schedule, from, through).Cast<DateOnly?>().FirstOrDefault();
                if (exampleDate.HasValue || through == DateOnly.MaxValue) break;
                from = through.AddDays(1);
            }
            if (exampleDate is null) throw FinancialEndpointSupport.Error(422,"invalid_schedule","This schedule has no occurrence on or after the selected date.");
        }
        DateOnly date;
        long amount;
        SplitMode mode;
        IReadOnlyList<Allocation> allocations;
        string kind;
        DrivingDetails? driving = null;
        switch (request.Kind)
        {
            case "Expense":
                var expenseRequest = Deserialize<ExpenseEndpoints.CreateExpenseRequest>(request.Values);
                if (exampleDate.HasValue) expenseRequest = expenseRequest with { ExpenseDate = exampleDate.Value };
                var expense = FinancialEndpointSupport.PrepareExpense(owner, events, expenseRequest, clock, request.ExampleOccurrence);
                date = expense.Date; amount = expense.Amount; mode = expense.SplitMode; allocations = expense.Allocations; kind = "Expense";
                break;
            case "Income":
                var incomeRequest = Deserialize<IncomeEndpoints.CreateIncomeRequest>(request.Values);
                if (exampleDate.HasValue) incomeRequest = incomeRequest with { ReceivedDate = exampleDate.Value };
                var income = FinancialEndpointSupport.PrepareIncome(owner, events, incomeRequest, clock, request.ExampleOccurrence);
                date = income.Date; amount = income.Amount; mode = income.SplitMode; allocations = income.Allocations; kind = "Income";
                break;
            case "Driving":
                var drivingRequest = Deserialize<DrivingEndpoints.CreateDrivingRequest>(request.Values);
                if (drivingRequest.ExpenseDate > FinancialEndpointSupport.OwnerToday(clock, account.TimeZone))
                    throw FinancialEndpointSupport.Error(422, "future_financial_date", "Expense date cannot be after today.", "expenseDate");
                var rate = drivingRequest.RateMinorPerKm ?? account.DrivingRateMinorPerKm;
                if (rate is null)
                    throw FinancialEndpointSupport.Error(422, "driving_rate_required", "Set a driving rate or provide one for this trip.", "rateMinorPerKm");
                DrivingCalculation calculation;
                try { calculation = CostTracking.Api.Domain.Driving.Calculate(drivingRequest.Kilometers, rate.Value); }
                catch (ArgumentException)
                {
                    throw FinancialEndpointSupport.Error(422, "invalid_driving_values", "Distance and rate must be positive and within supported precision; the rounded amount must be positive.");
                }
                catch (OverflowException)
                {
                    throw FinancialEndpointSupport.Error(422, "invalid_driving_values", "Calculated driving amount exceeds the supported range.");
                }
                var drivingAllocations = FinancialEndpointSupport.Allocate(events, calculation.AmountMinor, drivingRequest.Split);
                _ = FinancialEndpointSupport.ValidateDescription(drivingRequest.Description);
                date = drivingRequest.ExpenseDate; amount = calculation.AmountMinor;
                mode = Enum.Parse<SplitMode>(drivingRequest.Split.Mode, false); allocations = drivingAllocations; kind = "Expense";
                driving = new DrivingDetails(calculation.Kilometers, calculation.RateMinorPerKm);
                break;
            default:
                throw FinancialEndpointSupport.Error(400, "malformed_request", "Preview kind is invalid.", "kind");
        }
        var month = date.ToString("yyyy-MM", System.Globalization.CultureInfo.InvariantCulture);
        var monthlyEffect = allocations.Select(item => new
        {
            month,
            horseId = item.HorseId,
            incomeDeltaMinor = kind == "Income" ? item.AmountMinor : 0L,
            expenseDeltaMinor = kind == "Expense" ? item.AmountMinor : 0L,
            netDeltaMinor = kind == "Income" ? item.AmountMinor : -item.AmountMinor
        }).ToArray();
        var response = new
        {
            currency = account.Currency,
            date,
            amountMinor = amount,
            splitMode = mode.ToString(),
            allocations,
            monthlyEffect,
            streamVersion,
            driving
        };
        return await AccountEndpoints.WriteAsync(context, StatusCodes.Status200OK, response, streamVersion);
    }

    private static T Deserialize<T>(JsonElement value)
    {
        try { return value.Deserialize<T>(ApiProtocol.JsonOptions) ?? throw new JsonException("Preview values are required."); }
        catch (JsonException) { throw FinancialEndpointSupport.Error(400, "malformed_request", "Preview values are invalid.", "values"); }
    }

    private static object PreviewOccurrenceChange(string owner, IReadOnlyList<EventEnvelope> events, string? currency,
        long streamVersion, FinancialPreviewRequest request)
    {
        if (request.RuleId is not { } ruleId || ruleId == Guid.Empty || request.ScheduledDate is not { } date)
            throw FinancialEndpointSupport.Error(400, "malformed_request", "Occurrence previews require a rule ID and scheduled date.");
        var change = Deserialize<ExpenseOccurrenceChangeRequest>(request.Values);
        var replay = RecurringExpenseProjection.Read(events);
        var rule = replay.Rules.GetValueOrDefault(ruleId) ?? throw FinancialEndpointSupport.NotFound();
        var revision = rule.RevisionFor(date);
        if (revision is null || ScheduleExpansion.Expand(revision.Schedule, date, date).Count == 0)
            throw FinancialEndpointSupport.Error(422, "invalid_occurrence", "The date is not a scheduled occurrence for this rule.", "scheduledDate");

        var prior = replay.Overrides.Where(item => item.RuleId == ruleId && item.ScheduledDate == date)
            .MaxBy(item => item.StreamVersion);
        var oldDefaults = prior?.Action == ExpenseOccurrenceAction.Changed ? prior.Changed! : revision.Defaults;
        var oldContributes = prior?.Action != ExpenseOccurrenceAction.Skipped;
        ExpenseRuleDefaults newDefaults;
        bool newContributes;
        if (change.Action == "Skipped" && change.Changed is null)
        {
            newDefaults = oldDefaults;
            newContributes = false;
        }
        else if (change.Action == "Changed" && change.Changed is { } values)
        {
            newDefaults = ExpenseRuleEndpoints.BuildDefaults(owner, events, values.AmountMinor,
                values.Category, values.Description, values.Split, oldDefaults);
            newContributes = true;
        }
        else
            throw FinancialEndpointSupport.Error(422, "invalid_occurrence", "Action and changed values are inconsistent.", "action");

        var effects = new Dictionary<Guid, (long Expense, long Net)>();
        if (oldContributes) AddEffect(effects, oldDefaults.Allocations, subtract: true);
        if (newContributes) AddEffect(effects, newDefaults.Allocations, subtract: false);
        var monthlyEffect = effects.OrderBy(item => item.Key.ToString("D").ToLowerInvariant(), StringComparer.Ordinal)
            .Select(item => new MonthlyEffect(date.ToString("yyyy-MM", System.Globalization.CultureInfo.InvariantCulture),
                item.Key, 0, item.Value.Expense, item.Value.Net)).ToArray();
        return new
        {
            currency, date, amountMinor = newDefaults.AmountMinor, splitMode = newDefaults.SplitMode.ToString(),
            allocations = newDefaults.Allocations, monthlyEffect, streamVersion, driving = (DrivingDetails?)null
        };
    }

    private static void AddEffect(Dictionary<Guid, (long Expense, long Net)> effects,
        IReadOnlyList<Allocation> allocations, bool subtract)
    {
        foreach (var allocation in allocations)
        {
            effects.TryGetValue(allocation.HorseId, out var current);
            var sign = subtract ? -1L : 1L;
            effects[allocation.HorseId] = (checked(current.Expense + sign * allocation.AmountMinor),
                checked(current.Net - sign * allocation.AmountMinor));
        }
    }

    public sealed record FinancialPreviewRequest(string Kind, JsonElement Values, Guid? RuleId = null,
        DateOnly? ScheduledDate = null, Guid? RecordId = null)
    {
        public bool ExampleOccurrence { get; init; }
        public Schedule? ExampleSchedule { get; init; }
        public DateOnly? EffectiveFrom { get; init; }
    }
    public sealed record ExpenseOccurrenceChangeRequest(string Action, ExpenseOccurrenceEndpoints.ChangedOccurrenceRequest? Changed);
    public sealed record FinancialPreviewResponse(string? Currency, DateOnly Date, long AmountMinor, string SplitMode,
        IReadOnlyList<Allocation> Allocations, IReadOnlyList<MonthlyEffect> MonthlyEffect, long StreamVersion, DrivingDetails? Driving);
    public sealed record MonthlyEffect(string Month, Guid HorseId, long IncomeDeltaMinor, long ExpenseDeltaMinor, long NetDeltaMinor);
}
