using System.Text.Json;
using System.Text.Json.Serialization;
using CostTracking.Api.Domain;
using Json.Schema;

namespace CostTracking.Api.Storage;

/// <summary>Validates the canonical persisted schema before any event enters replay or storage.</summary>
public sealed class EventSerializer
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };
    private static readonly JsonSchema Schema = LoadSchema();

    private static JsonSchema LoadSchema()
    {
        using var stream = typeof(EventSerializer).Assembly.GetManifestResourceStream("CostTracking.Api.Contracts.events-v1.schema.json")
            ?? throw new InvalidOperationException("Canonical event schema is missing.");
        using var document = JsonDocument.Parse(stream);
        return JsonSchema.Build(document.RootElement.Clone(), new BuildOptions { SchemaRegistry = new SchemaRegistry() });
    }

    public byte[] Serialize(EventEnvelope value)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, Options);
        _ = Deserialize(bytes);
        return bytes;
    }

    public EventEnvelope Deserialize(ReadOnlySpan<byte> value)
    {
        try
        {
            using var document = JsonDocument.Parse(value.ToArray());
            RejectDuplicates(document.RootElement);
            if (!Schema.Evaluate(document.RootElement, new EvaluationOptions { RequireFormatValidation = true }).IsValid)
                throw new InvalidDataException("Unsupported or invalid event schema.");
            var result = document.RootElement.Deserialize<EventEnvelope>(Options)!;
            if (result.OccurredAt.Offset != TimeSpan.Zero)
                throw new InvalidDataException("Event timestamp must be UTC.");
            switch (result.Type)
            {
                case "AccountConfigured":
                    AccountSettings.ValidateConfiguration(result.Payload.GetProperty("currency").GetString()!, result.Payload.GetProperty("timeZone").GetString()!);
                    break;
                case "HorseRegistered":
                case "HorseDetailsUpdated":
                    ValidateHorsePayload(result.Payload);
                    break;
                case "HorseStatusChanged":
                    _ = Enum.Parse<HorseStatus>(result.Payload.GetProperty("status").GetString()!, false);
                    break;
                case "DrivingRateChanged":
                    _ = result.Payload.GetProperty("rateMinorPerKm").GetDecimal();
                    break;
                case "ExpenseRecorded":
                    ValidateExpense(result.Payload);
                    break;
                case "IncomeRecorded":
                    ValidateIncome(result.Payload);
                    break;
                case "TaskLogged":
                    ValidateTask(result.Payload);
                    break;
                case "RecurringExpenseRuleCreated":
                case "RecurringExpenseRuleUpdated":
                    ValidateExpenseRule(result.Payload, initial: result.Type == "RecurringExpenseRuleCreated");
                    break;
                case "RecurringExpenseRuleStopped":
                    if (result.Payload.GetProperty("ruleId").GetGuid() == Guid.Empty)
                        throw new InvalidDataException("Rule identifier is invalid.");
                    _ = ReadDate(result.Payload.GetProperty("lastDate"));
                    break;
                case "RecurringExpenseOccurrenceOverridden":
                    ValidateExpenseOverride(result.Payload);
                    break;
                case "RecurringIncomeRuleCreated":
                case "RecurringIncomeRuleUpdated":
                    ValidateIncomeRule(result.Payload, initial: result.Type == "RecurringIncomeRuleCreated");
                    break;
                case "RecurringIncomeRuleStopped":
                    if (result.Payload.GetProperty("ruleId").GetGuid() == Guid.Empty)
                        throw new InvalidDataException("Rule identifier is invalid.");
                    _ = ReadDate(result.Payload.GetProperty("lastDate"));
                    break;
                case "RecurringIncomeApproved":
                    ValidateIncomeDecision(result.Payload, approved: true);
                    break;
                case "RecurringIncomeRejected":
                    ValidateIncomeDecision(result.Payload, approved: false);
                    break;
                default:
                    throw new InvalidDataException("Event type is not implemented by this runtime.");
            }
            return result;
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("Invalid event JSON.", exception);
        }
    }

    private static void ValidateHorsePayload(JsonElement payload)
    {
        if (payload.GetProperty("horseId").GetGuid() == Guid.Empty)
            throw new InvalidDataException("Horse identifier is invalid.");
        var name = payload.GetProperty("name").GetString();
        var breed = payload.GetProperty("breed").GetString();
        if (name is null || name.Length is < 1 or > 100 || name != name.Trim() ||
            breed is null || breed.Length > 100 || breed != breed.Trim())
            throw new InvalidDataException("Horse details are invalid.");
        if (payload.GetProperty("dateOfBirth").ValueKind == JsonValueKind.String)
            _ = DateOnly.ParseExact(payload.GetProperty("dateOfBirth").GetString()!, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        _ = Enum.Parse<HorseStatus>(payload.GetProperty("status").GetString()!, false);
    }

    private static void ValidateExpense(JsonElement payload)
    {
        if (payload.GetProperty("expenseId").GetGuid() == Guid.Empty)
            throw new InvalidDataException("Expense identifier is invalid.");
        _ = DateOnly.ParseExact(payload.GetProperty("expenseDate").GetString()!, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        var amount = FinancialValues.RequirePositiveMinor(payload.GetProperty("amountMinor").GetInt64());
        var categoryText = payload.GetProperty("category").GetString()!;
        if (!Enum.TryParse<ExpenseCategory>(categoryText, false, out var category) || !Enum.IsDefined(category) || category.ToString() != categoryText)
            throw new InvalidDataException("Expense category is invalid.");
        if (payload.GetProperty("description").GetString() is not { Length: <= 500 }) throw new InvalidDataException("Expense description is invalid.");
        var modeText = payload.GetProperty("splitMode").GetString()!;
        if (!Enum.TryParse<SplitMode>(modeText, false, out var mode) || !Enum.IsDefined(mode) || mode.ToString() != modeText)
            throw new InvalidDataException("Expense split mode is invalid.");
        ValidateAllocations(payload.GetProperty("allocations"), amount);
        var driving = payload.GetProperty("driving");
        if ((category == ExpenseCategory.Driving) != (driving.ValueKind == JsonValueKind.Object))
            throw new InvalidDataException("Driving details must be present exactly for driving expenses.");
        if (driving.ValueKind == JsonValueKind.Object && FinancialValues.CalculateDrivingMinor(
                driving.GetProperty("kilometers").GetDecimal(), driving.GetProperty("rateMinorPerKm").GetDecimal()) != amount)
            throw new InvalidDataException("Driving amount does not match the saved calculation.");
    }

    private static void ValidateIncome(JsonElement payload)
    {
        if (payload.GetProperty("incomeId").GetGuid() == Guid.Empty)
            throw new InvalidDataException("Income identifier is invalid.");
        _ = DateOnly.ParseExact(payload.GetProperty("receivedDate").GetString()!, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        var amount = FinancialValues.RequirePositiveMinor(payload.GetProperty("amountMinor").GetInt64());
        var source = payload.GetProperty("source").GetString();
        if (source is null || source.Length is < 1 or > 100 || source != source.Trim()) throw new InvalidDataException("Income source is invalid.");
        var modeText = payload.GetProperty("splitMode").GetString()!;
        if (!Enum.TryParse<SplitMode>(modeText, false, out var mode) || !Enum.IsDefined(mode) || mode.ToString() != modeText)
            throw new InvalidDataException("Income split mode is invalid.");
        ValidateAllocations(payload.GetProperty("allocations"), amount);
    }

    private static void ValidateTask(JsonElement payload)
    {
        if (payload.GetProperty("taskId").GetGuid() == Guid.Empty || payload.GetProperty("horseId").GetGuid() == Guid.Empty)
            throw new InvalidDataException("Task identifiers are invalid.");
        _ = DateOnly.ParseExact(payload.GetProperty("taskDate").GetString()!, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);
        var taskTypeText = payload.GetProperty("taskType").GetString();
        if (!Enum.TryParse<TaskType>(taskTypeText, false, out var taskType) || !Enum.IsDefined(taskType) || taskType.ToString() != taskTypeText)
            throw new InvalidDataException("Task type is invalid.");
        var minutes = payload.GetProperty("minutes").GetInt64();
        if (minutes is < 0 or > FinancialValues.MaximumSafeInteger)
            throw new InvalidDataException("Task minutes are invalid.");
        var quantityElement = payload.GetProperty("quantity");
        var unitElement = payload.GetProperty("quantityUnit");
        var hasQuantity = quantityElement.ValueKind != JsonValueKind.Null;
        var hasUnit = unitElement.ValueKind != JsonValueKind.Null;
        if (hasQuantity != hasUnit)
            throw new InvalidDataException("Task quantity and unit must be provided together.");
        decimal? quantity = hasQuantity ? quantityElement.GetDecimal() : null;
        if (quantity is <= 0 || minutes == 0 && quantity is null)
            throw new InvalidDataException("A task requires positive minutes or quantity.");
        if (hasUnit)
        {
            var unit = unitElement.GetString();
            if (string.IsNullOrWhiteSpace(unit) || unit.Length > 30 || unit != unit.Trim())
                throw new InvalidDataException("Task quantity unit is invalid.");
        }
        if (payload.GetProperty("notes").GetString() is not { Length: <= 1000 })
            throw new InvalidDataException("Task notes are invalid.");
    }

    private static void ValidateExpenseRule(JsonElement payload, bool initial)
    {
        if (payload.GetProperty("ruleId").GetGuid() == Guid.Empty)
            throw new InvalidDataException("Rule identifier is invalid.");
        var effectiveFrom = ReadDate(payload.GetProperty("effectiveFrom"));
        var schedule = payload.GetProperty("schedule");
        var cadenceText = schedule.GetProperty("cadence").GetString();
        if (!Enum.TryParse<Cadence>(cadenceText, false, out var cadence) || !Enum.IsDefined(cadence) || cadence.ToString() != cadenceText)
            throw new InvalidDataException("Schedule cadence is invalid.");
        var weekdays = schedule.GetProperty("weekdays").EnumerateArray().Select(item => item.GetInt32()).ToArray();
        int? day = schedule.GetProperty("dayOfMonth").ValueKind == JsonValueKind.Null ? null : schedule.GetProperty("dayOfMonth").GetInt32();
        var start = ReadDate(schedule.GetProperty("startDate"));
        DateOnly? end = schedule.GetProperty("endDate").ValueKind == JsonValueKind.Null ? null : ReadDate(schedule.GetProperty("endDate"));
        if (initial && effectiveFrom != start)
            throw new InvalidDataException("The initial expense rule revision must be effective on its original start date.");
        try
        {
            var validatedSchedule = new Schedule(cadence, schedule.GetProperty("interval").GetInt32(), weekdays, day, start, end);
            _ = new RuleRevision(effectiveFrom, validatedSchedule, ReadExpenseDefaults(payload.GetProperty("defaults")));
        }
        catch (ArgumentException exception)
        {
            throw new InvalidDataException("Recurring expense rule is invalid.", exception);
        }
    }

    private static void ValidateExpenseOverride(JsonElement payload)
    {
        if (payload.GetProperty("ruleId").GetGuid() == Guid.Empty)
            throw new InvalidDataException("Rule identifier is invalid.");
        _ = ReadDate(payload.GetProperty("scheduledDate"));
        var action = payload.GetProperty("action").GetString();
        var changed = payload.GetProperty("changed");
        if (action == "Changed" && changed.ValueKind == JsonValueKind.Object)
        {
            _ = ReadExpenseDefaults(changed);
            return;
        }
        if (action == "Skipped" && changed.ValueKind == JsonValueKind.Null) return;
        throw new InvalidDataException("Occurrence override action and changed values are inconsistent.");
    }

    private static void ValidateIncomeRule(JsonElement payload, bool initial)
    {
        if (payload.GetProperty("ruleId").GetGuid() == Guid.Empty)
            throw new InvalidDataException("Rule identifier is invalid.");
        var effectiveFrom = ReadDate(payload.GetProperty("effectiveFrom"));
        var schedule = ReadSchedule(payload.GetProperty("schedule"));
        if (initial && effectiveFrom != schedule.StartDate)
            throw new InvalidDataException("The initial income rule revision must be effective on its original start date.");
        try { _ = new IncomeRuleRevision(effectiveFrom, schedule, ReadIncomeDefaults(payload.GetProperty("defaults"))); }
        catch (ArgumentException exception) { throw new InvalidDataException("Recurring income rule is invalid.", exception); }
    }

    private static void ValidateIncomeDecision(JsonElement payload, bool approved)
    {
        if (payload.GetProperty("ruleId").GetGuid() == Guid.Empty)
            throw new InvalidDataException("Rule identifier is invalid.");
        _ = ReadDate(payload.GetProperty("scheduledDate"));
        var nextDue = payload.GetProperty("nextDueDate");
        if (nextDue.ValueKind != JsonValueKind.Null) _ = ReadDate(nextDue);
        if (!approved) return;
        _ = ReadDate(payload.GetProperty("receivedDate"));
        var amount = FinancialValues.RequirePositiveMinor(payload.GetProperty("amountMinor").GetInt64());
        var mode = ReadSplitMode(payload.GetProperty("splitMode"));
        var allocations = ReadAllocations(payload.GetProperty("allocations"));
        try { _ = new IncomeRuleDefaults(amount, "valid", mode, allocations); }
        catch (ArgumentException exception) { throw new InvalidDataException("Approved income allocations are invalid.", exception); }
    }

    private static Schedule ReadSchedule(JsonElement schedule)
    {
        var cadenceText = schedule.GetProperty("cadence").GetString();
        if (!Enum.TryParse<Cadence>(cadenceText, false, out var cadence) || !Enum.IsDefined(cadence) || cadence.ToString() != cadenceText)
            throw new InvalidDataException("Schedule cadence is invalid.");
        var weekdays = schedule.GetProperty("weekdays").EnumerateArray().Select(item => item.GetInt32()).ToArray();
        int? day = schedule.GetProperty("dayOfMonth").ValueKind == JsonValueKind.Null ? null : schedule.GetProperty("dayOfMonth").GetInt32();
        DateOnly? end = schedule.GetProperty("endDate").ValueKind == JsonValueKind.Null ? null : ReadDate(schedule.GetProperty("endDate"));
        try { return new Schedule(cadence, schedule.GetProperty("interval").GetInt32(), weekdays, day, ReadDate(schedule.GetProperty("startDate")), end); }
        catch (ArgumentException exception) { throw new InvalidDataException("Schedule is invalid.", exception); }
    }

    private static IncomeRuleDefaults ReadIncomeDefaults(JsonElement payload)
    {
        var source = payload.GetProperty("source").GetString();
        var mode = ReadSplitMode(payload.GetProperty("splitMode"));
        var allocations = ReadAllocations(payload.GetProperty("allocations"));
        try { return new IncomeRuleDefaults(payload.GetProperty("amountMinor").GetInt64(), source!, mode, allocations); }
        catch (ArgumentException exception) { throw new InvalidDataException("Recurring income defaults are invalid.", exception); }
    }

    private static SplitMode ReadSplitMode(JsonElement value)
    {
        var text = value.GetString();
        if (!Enum.TryParse<SplitMode>(text, false, out var mode) || !Enum.IsDefined(mode) || mode.ToString() != text)
            throw new InvalidDataException("Income split mode is invalid.");
        return mode;
    }

    private static Allocation[] ReadAllocations(JsonElement value) => value.EnumerateArray().Select(item => new Allocation(
        item.GetProperty("horseId").GetGuid(), item.GetProperty("weight").GetInt32(), item.GetProperty("amountMinor").GetInt64())).ToArray();

    private static ExpenseRuleDefaults ReadExpenseDefaults(JsonElement payload)
    {
        var category = payload.GetProperty("category").GetString();
        var modeText = payload.GetProperty("splitMode").GetString();
        if (!Enum.TryParse<SplitMode>(modeText, false, out var mode) || !Enum.IsDefined(mode) || mode.ToString() != modeText)
            throw new InvalidDataException("Expense split mode is invalid.");
        var allocations = payload.GetProperty("allocations").EnumerateArray().Select(item => new Allocation(
            item.GetProperty("horseId").GetGuid(), item.GetProperty("weight").GetInt32(), item.GetProperty("amountMinor").GetInt64())).ToArray();
        try
        {
            return new ExpenseRuleDefaults(payload.GetProperty("amountMinor").GetInt64(), category!,
                payload.GetProperty("description").GetString()!, mode, allocations);
        }
        catch (ArgumentException exception)
        {
            throw new InvalidDataException("Recurring expense defaults are invalid.", exception);
        }
    }

    private static DateOnly ReadDate(JsonElement value) => DateOnly.ParseExact(value.GetString()!, "yyyy-MM-dd",
        System.Globalization.CultureInfo.InvariantCulture);

    private static void ValidateAllocations(JsonElement value, long amount)
    {
        var allocations = value.EnumerateArray().Select(item => new Allocation(item.GetProperty("horseId").GetGuid(),
            item.GetProperty("weight").GetInt32(), item.GetProperty("amountMinor").GetInt64())).ToArray();
        if (allocations.Length is < 1 or > 100 || allocations.Any(item => item.HorseId == Guid.Empty || item.Weight <= 0 || item.AmountMinor < 0) ||
            allocations.Select(item => item.HorseId).Distinct().Count() != allocations.Length ||
            allocations.Sum(item => (long)item.Weight) != AllocationCalculator.TotalWeight ||
            allocations.Aggregate(0L, (sum, item) => checked(sum + item.AmountMinor)) != amount)
            throw new InvalidDataException("Financial allocations do not reconcile to the item.");
    }

    internal static void RejectDuplicates(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray()) RejectDuplicates(item);
            return;
        }
        if (value.ValueKind != JsonValueKind.Object) return;
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
        {
            if (!names.Add(property.Name)) throw new JsonException("Duplicate JSON property.");
            RejectDuplicates(property.Value);
        }
    }
}
