using System.Collections.Frozen;

namespace CostTracking.Api.Domain;

public static class AccountSettings
{
    public static readonly FrozenDictionary<string, int> CurrencyPrecision = new Dictionary<string, int>(StringComparer.Ordinal)
    {
        ["EUR"] = 2, ["USD"] = 2, ["GBP"] = 2, ["CHF"] = 2,
        ["CAD"] = 2, ["AUD"] = 2, ["NZD"] = 2, ["SEK"] = 2,
        ["NOK"] = 2, ["DKK"] = 2, ["PLN"] = 2, ["CZK"] = 2,
        ["HUF"] = 2, ["JPY"] = 0, ["BHD"] = 3, ["KWD"] = 3
    }.ToFrozenDictionary(StringComparer.Ordinal);

    /// <summary>Checks supported currency precision and runtime-supported IANA identifiers at the input boundary.</summary>
    public static void ValidateConfiguration(string? currency, string? timeZone)
    {
        if (currency is null || !CurrencyPrecision.ContainsKey(currency)) throw new InvalidDataException("Unsupported currency.");
        if (string.IsNullOrWhiteSpace(timeZone)) throw new InvalidDataException("An IANA time zone is required.");
        try
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
            if (!zone.HasIanaId) throw new InvalidDataException("An IANA time zone is required.");
        }
        catch (TimeZoneNotFoundException exception) { throw new InvalidDataException("Unknown IANA time zone.", exception); }
        catch (InvalidTimeZoneException exception) { throw new InvalidDataException("Invalid IANA time zone.", exception); }
    }
}
