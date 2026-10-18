using System.Globalization;
using CostTracking.Api.Contracts;
using CostTracking.Api.Domain;
using CostTracking.Api.Features.Account;
using CostTracking.Api.Features.Income;
using CostTracking.Api.Storage;

namespace CostTracking.Api.Features.Expenses;

public sealed record SplitRequest(string Mode, IReadOnlyList<Guid>? HorseIds = null, IReadOnlyList<CustomShareRequest>? Shares = null);
public sealed record CustomShareRequest(Guid HorseId, int Weight);
internal sealed record PreparedExpense(DateOnly Date, long Amount, ExpenseCategory Category, string Description,
    SplitMode SplitMode, IReadOnlyList<Allocation> Allocations);
internal sealed record PreparedIncome(DateOnly Date, long Amount, string Source, SplitMode SplitMode,
    IReadOnlyList<Allocation> Allocations);

internal static class FinancialEndpointSupport
{
    public static PreparedExpense PrepareExpense(string owner, IReadOnlyList<EventEnvelope> events,
        ExpenseEndpoints.CreateExpenseRequest request, TimeProvider clock, bool allowFutureDate = false)
    {
        var account = RequireAccount(owner, events);
        if (!allowFutureDate && request.ExpenseDate > OwnerToday(clock, account.TimeZone))
            throw Error(422, "future_financial_date", "Expense date cannot be after today.", "expenseDate");
        try { FinancialValues.RequirePositiveMinor(request.AmountMinor); }
        catch (ArgumentException) { throw Error(422, "invalid_amount", "Amount must be a positive safe integer in minor units.", "amountMinor"); }
        if (!Enum.TryParse<ExpenseCategory>(request.Category, false, out var category) || !Enum.IsDefined(category) ||
            category == ExpenseCategory.Driving || category.ToString() != request.Category)
            throw Error(422, "invalid_expense_category", "Choose a supported non-driving expense category.", "category");
        var description = ValidateDescription(request.Description);
        var allocations = Allocate(events, request.AmountMinor, request.Split);
        return new PreparedExpense(request.ExpenseDate, request.AmountMinor, category, description,
            Enum.Parse<SplitMode>(request.Split.Mode, false), allocations);
    }

    public static PreparedIncome PrepareIncome(string owner, IReadOnlyList<EventEnvelope> events,
        IncomeEndpoints.CreateIncomeRequest request, TimeProvider clock, bool allowFutureDate = false)
    {
        var account = RequireAccount(owner, events);
        if (!allowFutureDate && request.ReceivedDate > OwnerToday(clock, account.TimeZone))
            throw Error(422, "future_financial_date", "Received date cannot be after today.", "receivedDate");
        try { FinancialValues.RequirePositiveMinor(request.AmountMinor); }
        catch (ArgumentException) { throw Error(422, "invalid_amount", "Amount must be a positive safe integer in minor units.", "amountMinor"); }
        var source = ValidateSource(request.Source);
        var allocations = Allocate(events, request.AmountMinor, request.Split);
        return new PreparedIncome(request.ReceivedDate, request.AmountMinor, source,
            Enum.Parse<SplitMode>(request.Split.Mode, false), allocations);
    }

    public static AccountProjection RequireAccount(string owner, IReadOnlyList<EventEnvelope> events)
    {
        var account = AccountProjection.Replay(owner, events);
        if (account.Currency is null || account.TimeZone is null)
            throw Error(409, "account_setup_required", "Configure account settings before financial activity.");
        return account;
    }

    public static DateOnly OwnerToday(TimeProvider clock, string? zone)
        => OwnerCalendar.Today(clock, zone);

    public static IReadOnlyList<Allocation> Allocate(IReadOnlyList<EventEnvelope> events, long amount, SplitRequest split)
    {
        if (!Enum.TryParse<SplitMode>(split.Mode, false, out var mode) || !Enum.IsDefined(mode) || mode.ToString() != split.Mode)
            throw Error(422, "invalid_split", "Split mode is invalid.", "split.mode");
        IReadOnlyList<Allocation> allocations;
        try
        {
            allocations = mode switch
            {
                SplitMode.Equal when split.HorseIds is { } ids && split.Shares is null => AllocationCalculator.Equal(amount, ids),
                SplitMode.Custom when split.Shares is { } shares && split.HorseIds is null => AllocationCalculator.Custom(amount,
                    shares.Select(item => new CustomShare(item.HorseId, item.Weight)).ToArray()),
                _ => throw new ArgumentException("Split fields do not match the selected mode.")
            };
        }
        catch (Exception exception) when (exception is ArgumentException or OverflowException)
        {
            throw Error(422, "invalid_split", "Split targets or weights are invalid.", "split");
        }
        var horses = HorseProjection.Replay(events).ToDictionary(horse => horse.HorseId);
        if (allocations.Any(item => !horses.ContainsKey(item.HorseId))) throw NotFound();
        var eligible = horses.Values.Where(horse => horse.Status is HorseStatus.Active or HorseStatus.Leased)
            .Select(horse => horse.HorseId).ToHashSet();
        if (allocations.Any(item => !eligible.Contains(item.HorseId)))
            throw Error(422, "inactive_horse", "New financial allocations require active or leased horses.", "split");
        return allocations;
    }

    public static string ValidateDescription(string? value)
    {
        if (value is null || value.Length > 500) throw Error(422, "invalid_description", "Description must be at most 500 characters.", "description");
        return value;
    }

    public static string ValidateSource(string? value)
    {
        var source = value?.Trim();
        if (string.IsNullOrEmpty(source) || source.Length > 100)
            throw Error(422, "invalid_source", "Source must contain 1 to 100 characters.", "source");
        return source;
    }

    public static DateOnly ReadDate(string? value, string field)
    {
        if (value is null || !DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            throw Error(400, "malformed_request", "A valid ISO calendar date is required.", field);
        return date;
    }

    public static void ValidateWindow(DateOnly from, DateOnly through)
    {
        if (through < from) throw Error(400, "malformed_request", "The end date cannot precede the start date.", "to");
        DateOnly maximum;
        try { maximum = from.AddYears(5).AddDays(-1); }
        catch (ArgumentOutOfRangeException) { maximum = DateOnly.MaxValue; }
        if (through > maximum) throw Error(422, "interval_limit", "The selected date window may span at most five calendar years.", "to");
    }

    public static Guid? ReadId(string? value, string field)
    {
        if (value is null) return null;
        if (!Guid.TryParseExact(value, "D", out var id)) throw Error(400, "malformed_request", "Filter must be a UUID.", field);
        return id;
    }

    public static string Canonical(Guid? id) => id?.ToString("D").ToLowerInvariant() ?? "*";
    public static ApiException NotFound() => Error(404, "not_found", "Resource unavailable.");
    public static ApiException Error(int status, string code, string message, string? field = null) =>
        new(status, code, message, field);
}
