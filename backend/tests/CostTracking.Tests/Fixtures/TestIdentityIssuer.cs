using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.IdentityModel.Tokens;

namespace CostTracking.Tests.Fixtures;

public sealed class TestIdentityIssuer : IDisposable
{
    public const string Issuer = "https://issuer.test";
    public const string Audience = "cost-tracking-tests";
    public const string Alice = "user_Alice";
    public const string Bob = "user_Bob";
    private readonly RSA rsa = RSA.Create(2048);
    public RsaSecurityKey Key { get; }

    public TestIdentityIssuer() => Key = new RsaSecurityKey(rsa) { KeyId = "test-key-1" };

    public string Issue(string subject, DateTimeOffset now, string? issuer = null,
        string? audience = Audience, string? organization = null, string? sessionId = "session_test", TimeSpan? lifetime = null)
    {
        var claims = new List<Claim> { new("sub", subject) };
        if (sessionId is not null) claims.Add(new Claim("sid", sessionId));
        if (organization is not null) claims.Add(new Claim("org_id", organization));
        var token = new JwtSecurityToken(issuer ?? Issuer, audience, claims,
            now.AddMinutes(-1).UtcDateTime, now.Add(lifetime ?? TimeSpan.FromMinutes(10)).UtcDateTime,
            new SigningCredentials(Key, SecurityAlgorithms.RsaSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public object Jwks()
    {
        var parameters = rsa.ExportParameters(false);
        return new { keys = new[] { new { kty = "RSA", use = "sig", alg = "RS256", kid = Key.KeyId,
            n = Base64UrlEncoder.Encode(parameters.Modulus!), e = Base64UrlEncoder.Encode(parameters.Exponent!) } } };
    }

    public void Dispose() => rsa.Dispose();
}
