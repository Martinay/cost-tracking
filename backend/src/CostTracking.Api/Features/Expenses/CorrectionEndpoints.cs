using System.Text.Json;
using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Features.Income;
using CostTracking.Api.Features.Tasks;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.Expenses;

public static class CorrectionEndpoints
{
    public static IEndpointRouteBuilder MapCorrectionEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/v1/expenses/{recordId}/corrections", CorrectExpenseAsync).Accepts<CorrectionRequest>("application/json").Produces<CorrectionResponse>();
        endpoints.MapPost("/api/v1/income/{recordId}/corrections", CorrectIncomeAsync).Accepts<CorrectionRequest>("application/json").Produces<CorrectionResponse>();
        endpoints.MapPost("/api/v1/tasks/{recordId}/corrections", CorrectTaskAsync).Accepts<CorrectionRequest>("application/json").Produces<CorrectionResponse>();
        return endpoints;
    }

    private static Task<IResult> CorrectExpenseAsync(HttpContext context, string recordId, JsonlEventStore store, TimeProvider clock, Func<Guid> newId, CancellationToken token) => CorrectAsync(context, recordId, "Expense", store, clock, newId, token);
    private static Task<IResult> CorrectIncomeAsync(HttpContext context, string recordId, JsonlEventStore store, TimeProvider clock, Func<Guid> newId, CancellationToken token) => CorrectAsync(context, recordId, "Income", store, clock, newId, token);
    private static Task<IResult> CorrectTaskAsync(HttpContext context, string recordId, JsonlEventStore store, TimeProvider clock, Func<Guid> newId, CancellationToken token) => CorrectAsync(context, recordId, "Task", store, clock, newId, token);

    private static async Task<IResult> CorrectAsync(HttpContext context, string recordId, string kind, JsonlEventStore store, TimeProvider clock, Func<Guid> newId, CancellationToken token)
    {
        var owner = CurrentOwner.Subject(context.User);
        var id = FinancialEndpointSupport.ReadId(recordId, "recordId")!.Value;
        var request = await ApiProtocol.ReadBodyAsync<CorrectionRequest>(context.Request, token);
        if (string.IsNullOrWhiteSpace(request.Reason) || request.Reason.Trim().Length > 500)
            throw FinancialEndpointSupport.Error(422, "invalid_reason", "Enter a correction reason (up to 500 characters).", "reason");
        var command = AccountEndpoints.Command(context, "POST", context.Request.Path, request);
        var result = await new CommandPipeline(store, clock, newId).ExecuteAsync(owner, command, events =>
            AccountEndpoints.Event(kind + "Corrected", Prepare(owner, events, id, kind, request.Values, request.Reason.Trim(), clock)),
            (accepted, _) => AccountEndpoints.Response(accepted.StreamVersion, new CorrectionResponse(id, accepted.StreamVersion)), token);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    internal static object Prepare(string owner, IReadOnlyList<EventEnvelope> events, Guid id, string kind, JsonElement values, string reason, TimeProvider clock)
    {
        if (kind == "Expense")
        {
            var originalExpense = ExpenseProjection.Replay(events).SingleOrDefault(item => item.ExpenseId == id) ?? throw FinancialEndpointSupport.NotFound();
            var request = Read<ExpenseCorrectionValues>(values);
            if (request.Category == "Driving")
            {
                if (request.Driving is null) throw FinancialEndpointSupport.Error(422, "invalid_driving_values", "Enter distance and rate for driving corrections.");
                DrivingCalculation calculation;
                try { calculation = CostTracking.Api.Domain.Driving.Calculate(request.Driving.Kilometers, request.Driving.RateMinorPerKm); }
                catch(Exception e) when(e is ArgumentException or OverflowException) { throw FinancialEndpointSupport.Error(422,"invalid_driving_values","Review distance and rate precision."); }
                if (request.ExpenseDate > FinancialEndpointSupport.OwnerToday(clock, AccountProjection.Replay(owner, events).TimeZone)) throw FinancialEndpointSupport.Error(422, "future_financial_date", "Expense date cannot be after today.");
                return new { expenseId = id, request.ExpenseDate, amountMinor = calculation.AmountMinor, request.Category, description = FinancialEndpointSupport.ValidateDescription(request.Description), splitMode = request.Split.Mode, allocations = FinancialEndpointSupport.Allocate(events, calculation.AmountMinor, request.Split, originalExpense.Allocations, originalExpense.SplitMode), request.Driving, reason };
            }
            var prepared = FinancialEndpointSupport.PrepareExpense(owner, events, new(request.ExpenseDate, request.AmountMinor, request.Category, request.Description, request.Split), clock, previousAllocations: originalExpense.Allocations, previousMode: originalExpense.SplitMode);
            return new { expenseId = id, expenseDate = prepared.Date, amountMinor = prepared.Amount, category = prepared.Category.ToString(), prepared.Description, splitMode = prepared.SplitMode.ToString(), prepared.Allocations, driving = (DrivingDetails?)null, reason };
        }
        if (kind == "Income")
        {
            var originalIncome = IncomeProjection.Replay(events).SingleOrDefault(item => item.Id == id.ToString("D") && item.Origin == "OneTime") ?? throw FinancialEndpointSupport.NotFound();
            var prepared = FinancialEndpointSupport.PrepareIncome(owner, events, Read<IncomeEndpoints.CreateIncomeRequest>(values), clock, previousAllocations: originalIncome.Allocations, previousMode: originalIncome.SplitMode);
            return new { incomeId = id, receivedDate = prepared.Date, amountMinor = prepared.Amount, prepared.Source, splitMode = prepared.SplitMode.ToString(), prepared.Allocations, reason };
        }
        var originalTask = HorseTaskProjection.Replay(events).SingleOrDefault(item => item.TaskId == id) ?? throw FinancialEndpointSupport.NotFound();
        var task = Read<TaskEndpoints.CreateTaskRequest>(values);
        var horse = HorseProjection.Replay(events).SingleOrDefault(item => item.HorseId == task.HorseId) ?? throw FinancialEndpointSupport.NotFound();
        if (task.TaskDate > FinancialEndpointSupport.OwnerToday(clock, AccountProjection.Replay(owner, events).TimeZone)) throw FinancialEndpointSupport.Error(422, "future_task_date", "Task date cannot be after today.");
        HorseTask validated;
        try { validated = HorseTask.Create(id, horse, task.TaskDate, task.TaskType, task.Minutes, task.Quantity, task.QuantityUnit, task.Notes, events.Count + 1, originalTask.HorseId); }
        catch (ArgumentException) { throw FinancialEndpointSupport.Error(422, "invalid_task", "Review task effort, horse, quantity and unit."); }
        return new { validated.TaskId, validated.HorseId, validated.TaskDate, taskType = validated.TaskType.ToString(), validated.Minutes, validated.Quantity, validated.QuantityUnit, validated.Notes, reason };
    }

    private static T Read<T>(JsonElement values)
    {
        try { return values.Deserialize<T>(ApiProtocol.JsonOptions) ?? throw new JsonException(); }
        catch (JsonException) { throw FinancialEndpointSupport.Error(400, "malformed_request", "Correction values are invalid."); }
    }
    public sealed record CorrectionRequest(JsonElement Values, string Reason);
    public sealed record ExpenseCorrectionValues(DateOnly ExpenseDate, long AmountMinor, string Category, string Description, SplitRequest Split, DrivingDetails? Driving = null);
    public sealed record CorrectionResponse(Guid RecordId, long StreamVersion);
}
