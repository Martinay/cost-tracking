using System.Net;
using System.IdentityModel.Tokens.Jwt;
using Microsoft.IdentityModel.Tokens;

namespace CostTracking.Tests.Fixtures;

public class TestHarnessTests
{
    [Fact]
    public async Task Hosts_are_isolated_and_start_the_real_empty_application()
    {
        using var first = new TestApplication();
        using var second = new TestApplication();
        Assert.NotEqual(first.StorageRoot, second.StorageRoot);
        Assert.Equal(HttpStatusCode.NotFound, (await first.CreateClient().GetAsync("/")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await second.CreateClient().GetAsync("/")).StatusCode);
    }

    [Fact]
    public void Issuer_signs_two_distinct_subjects_and_exposes_only_public_jwks()
    {
        using var issuer = new TestIdentityIssuer();
        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        var clock = new DateTimeOffset(2026, 9, 21, 12, 0, 0, TimeSpan.Zero);
        foreach (var subject in new[] { TestIdentityIssuer.Alice, TestIdentityIssuer.Bob })
        {
            var principal = handler.ValidateToken(issuer.Issue(subject, clock), new TokenValidationParameters
            {
                ValidIssuer = TestIdentityIssuer.Issuer, ValidAudience = TestIdentityIssuer.Audience,
                IssuerSigningKey = issuer.Key, ValidateLifetime = false,
                ValidAlgorithms = [SecurityAlgorithms.RsaSha256]
            }, out _);
            Assert.Equal(subject, principal.FindFirst("sub")!.Value);
        }
        var jwks = System.Text.Json.JsonSerializer.Serialize(issuer.Jwks());
        Assert.DoesNotContain("\"d\":", jwks);
        Assert.Contains("\"n\":", jwks);
    }
}
