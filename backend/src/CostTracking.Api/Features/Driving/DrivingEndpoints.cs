using CostTracking.Api.Auth;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Features.Expenses;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.Driving;

public static class DrivingEndpoints
{
    public static IEndpointRouteBuilder MapDrivingEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPut("/api/v1/driving-rate", SetRateAsync)
            .Accepts<SetDrivingRateRequest>("application/json")
            .Produces<DrivingRateResponse>(StatusCodes.Status200OK, "application/json");
        endpoints.MapPost("/api/v1/driving", CreateAsync)
            .Accepts<CreateDrivingRequest>("application/json")
            .Produces<CreatedDrivingResponse>(StatusCodes.Status201Created, "application/json");
        return endpoints;
    }

    private static async Task<IResult> SetRateAsync(HttpContext context, JsonlEventStore store, TimeProvider clock,
        Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var request = await ApiProtocol.ReadBodyAsync<SetDrivingRateRequest>(context.Request, cancellationToken);
        var command = AccountEndpoints.Command(context, "PUT", "/api/v1/driving-rate", request);
        var result = await new CommandPipeline(store, clock, newId).ExecuteAsync(owner, command, events =>
        {
            if (request.RateMinorPerKm <= 0 || request.RateMinorPerKm > 1_000_000 || decimal.Round(request.RateMinorPerKm, 4) != request.RateMinorPerKm)
                throw new ApiException(StatusCodes.Status422UnprocessableEntity, "invalid_driving_rate", "Rate must be positive and use at most four decimal places.", "rateMinorPerKm");
            var account = AccountProjection.Replay(owner, events);
            if (account.Currency is null)
                throw new ApiException(StatusCodes.Status409Conflict, "account_setup_required", "Configure account settings before setting a rate.");
            return AccountEndpoints.Event("DrivingRateChanged", new { rateMinorPerKm = request.RateMinorPerKm });
        }, (accepted, prefix) =>
        {
            var account = AccountProjection.Replay(owner, prefix);
            return AccountEndpoints.Response(accepted.StreamVersion,
                new { rateMinorPerKm = account.DrivingRateMinorPerKm, streamVersion = accepted.StreamVersion });
        }, cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    private static async Task<IResult> CreateAsync(HttpContext context, JsonlEventStore store, TimeProvider clock,
        Func<Guid> newId, CancellationToken cancellationToken)
    {
        var owner = CurrentOwner.Subject(context.User);
        var request = await ApiProtocol.ReadBodyAsync<CreateDrivingRequest>(context.Request, cancellationToken);
        var command = AccountEndpoints.Command(context, "POST", "/api/v1/driving", request);
        var result = await new CommandPipeline(store, clock, newId).ExecuteAsync(owner, command, events =>
        {
            var account = FinancialEndpointSupport.RequireAccount(owner, events);
            if (request.ExpenseDate > FinancialEndpointSupport.OwnerToday(clock, account.TimeZone))
                throw FinancialEndpointSupport.Error(422, "future_financial_date", "Expense date cannot be after today.", "expenseDate");
            var rate = request.RateMinorPerKm ?? account.DrivingRateMinorPerKm;
            if (rate is null)
                throw FinancialEndpointSupport.Error(422, "driving_rate_required", "Set a driving rate or provide one for this trip.", "rateMinorPerKm");
            DrivingCalculation calculation;
            try { calculation = CostTracking.Api.Domain.Driving.Calculate(request.Kilometers, rate.Value); }
            catch (ArgumentException)
            {
                throw FinancialEndpointSupport.Error(422, "invalid_driving_values", "Distance and rate must be positive and within supported precision; the rounded amount must be positive.");
            }
            catch (OverflowException)
            {
                throw FinancialEndpointSupport.Error(422, "invalid_driving_values", "Calculated driving amount exceeds the supported range.");
            }
            var description = FinancialEndpointSupport.ValidateDescription(request.Description);
            var allocations = FinancialEndpointSupport.Allocate(events, calculation.AmountMinor, request.Split);
            var mode = Enum.Parse<SplitMode>(request.Split.Mode, false);
            return AccountEndpoints.Event("ExpenseRecorded", new
            {
                expenseId = newId(), expenseDate = request.ExpenseDate, amountMinor = calculation.AmountMinor,
                category = ExpenseCategory.Driving.ToString(), description, allocations, driving = new
                {
                    kilometers = calculation.Kilometers,
                    rateMinorPerKm = calculation.RateMinorPerKm
                }, splitMode = mode.ToString()
            });
        }, (accepted, prefix) =>
        {
            var expense = ExpenseProjection.Replay(prefix).Single(item => item.StreamVersion == accepted.StreamVersion);
            return AccountEndpoints.CreatedResponse(accepted.StreamVersion, new CreatedDrivingResponse(
                expense.ExpenseId, expense.AmountMinor, expense.Allocations, accepted.StreamVersion));
        }, cancellationToken);
        return await AccountEndpoints.WriteAsync(context, result.StatusCode, result.Body, result.StreamVersion);
    }

    public sealed record SetDrivingRateRequest(decimal RateMinorPerKm);
    public sealed record DrivingRateResponse(decimal? RateMinorPerKm, long StreamVersion);
    public sealed record CreateDrivingRequest(DateOnly ExpenseDate, decimal Kilometers, string Description, SplitRequest Split)
    {
        public decimal? RateMinorPerKm { get; init; }
    }
    public sealed record CreatedDrivingResponse(Guid ExpenseId, long AmountMinor, IReadOnlyList<Allocation> Allocations,
        long StreamVersion);
}
