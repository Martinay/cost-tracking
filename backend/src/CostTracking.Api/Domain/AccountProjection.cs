using CostTracking.Api.Storage;

namespace CostTracking.Api.Domain;

/// <summary>Captures a validated immutable prefix; stream versions, not timestamps, determine ordering.</summary>
public sealed record AccountProjection(IReadOnlyList<EventEnvelope> Events)
{
    public long StreamVersion => Events.Count;
    public string? Currency => Events.LastOrDefault(value => value.Type == "AccountConfigured")?.Payload.GetProperty("currency").GetString();
    public string? TimeZone => Events.LastOrDefault(value => value.Type == "AccountConfigured")?.Payload.GetProperty("timeZone").GetString();
    public decimal? DrivingRateMinorPerKm
    {
        get
        {
            decimal? rate = null;
            string? currency = null;
            foreach (var value in Events)
            {
                if (value.Type == "AccountConfigured")
                {
                    var configuredCurrency = value.Payload.GetProperty("currency").GetString();
                    if (currency is not null && !StringComparer.Ordinal.Equals(currency, configuredCurrency)) rate = null;
                    currency = configuredCurrency;
                }
                else if (value.Type == "DrivingRateChanged")
                    rate = value.Payload.GetProperty("rateMinorPerKm").GetDecimal();
            }
            return rate;
        }
    }
    public bool SettingsLocked => Events.Any(value => value.Type is "ExpenseRecorded" or "IncomeRecorded" or
        "RecurringExpenseRuleCreated" or "RecurringIncomeRuleCreated" or "RecurringExpenseRuleStopped" or
        "RecurringIncomeRuleStopped" or "RecurringExpenseOccurrenceOverridden" or "RecurringIncomeApproved" or
        "RecurringIncomeRejected");
    public static AccountProjection Replay(string subject, IEnumerable<EventEnvelope> events)
    {
        var serializer = new EventSerializer();
        var accepted = new List<EventEnvelope>();
        var keys = new HashSet<Guid>();
        var ids = new HashSet<Guid>();
        foreach (var value in events)
        {
            _ = serializer.Serialize(value);
            if (value.Subject != subject || value.StreamVersion != accepted.Count + 1 ||
                !keys.Add(value.IdempotencyKey) || !ids.Add(value.EventId))
                throw new InvalidDataException("Invalid event stream sequence or ownership.");
            accepted.Add(value);
        }
        _ = HorseProjection.Replay(accepted);
        return new AccountProjection(accepted.AsReadOnly());
    }
}
