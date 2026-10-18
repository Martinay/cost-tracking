using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;

namespace CostTracking.Api.Contracts;

/// <summary>Protects query progress and rejects cross-owner, changed-filter, stale-version or stale-date reuse.</summary>
public sealed class CursorCodec(IDataProtectionProvider provider)
{
    private readonly IDataProtector protector = provider.CreateProtector("cost-tracking.cursor.v1");
    private sealed record Cursor(string SubjectHash, string Filters, long Version, DateOnly AsOfDate, string Position);
    public string Encode(string subject, string filters, long version, DateOnly asOfDate, string position) =>
        protector.Protect(JsonSerializer.Serialize(new Cursor(Hash(subject), filters, version, asOfDate, position)));

    public string Decode(string token, string subject, string filters, long version, DateOnly asOfDate)
    {
        Cursor cursor;
        try
        {
            if (token.Length > 8192) throw Invalid();
            cursor = JsonSerializer.Deserialize<Cursor>(protector.Unprotect(token)) ?? throw Invalid();
        }
        catch (CryptographicException) { throw Invalid(); }
        catch (JsonException) { throw Invalid(); }
        if (cursor.SubjectHash != Hash(subject) || cursor.Filters != filters) throw Invalid();
        if (cursor.Version != version || cursor.AsOfDate != asOfDate)
            throw new ApiException(409, "cursor_expired", "This list changed. Start again from the first page.");
        return cursor.Position;
    }

    private static string Hash(string subject) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(subject)));
    private static ApiException Invalid() => new(400, "invalid_cursor", "Cursor is invalid for this query.");
}
