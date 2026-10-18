using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using CostTracking.Tests.Fixtures;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace CostTracking.Tests.Integration;

public sealed class AuthenticationTests
{
    [Fact]
    public async Task Rejects_tokens_with_wrong_signature()
    {
        using var app = new TestApplication();
        using var untrustedIssuer = new TestIdentityIssuer();
        using var host = CreateProbe(app);
        var response = await GetOwner(host, untrustedIssuer.Issue(TestIdentityIssuer.Alice, app.Clock.GetUtcNow()));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_tokens_with_wrong_issuer()
    {
        using var app = new TestApplication();
        using var host = CreateProbe(app);
        var response = await GetOwner(host, app.Identity.Issue(TestIdentityIssuer.Alice, app.Clock.GetUtcNow(), issuer: "https://attacker.test"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_tokens_with_wrong_audience()
    {
        using var app = new TestApplication();
        using var host = CreateProbe(app);
        var response = await GetOwner(host, app.Identity.Issue(TestIdentityIssuer.Alice, app.Clock.GetUtcNow(), audience: "another-api"));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_tokens_without_an_audience()
    {
        using var app = new TestApplication();
        using var host = CreateProbe(app);
        var response = await GetOwner(host, app.Identity.Issue(TestIdentityIssuer.Alice, app.Clock.GetUtcNow(), audience: null));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_expired_tokens_using_the_configured_clock()
    {
        using var app = new TestApplication();
        using var host = CreateProbe(app);
        var now = app.Clock.GetUtcNow();
        var token = CreateToken(app.Identity.Key, [new Claim("sub", TestIdentityIssuer.Alice)], now.AddMinutes(-20).UtcDateTime, now.AddSeconds(-1).UtcDateTime);
        var response = await GetOwner(host, token);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_tokens_with_missing_or_non_user_subjects()
    {
        using var app = new TestApplication();
        using var host = CreateProbe(app);
        var now = app.Clock.GetUtcNow();
        var missing = CreateToken(app.Identity.Key, [], now.AddMinutes(-1).UtcDateTime, now.AddMinutes(10).UtcDateTime);
        var nonUser = CreateToken(app.Identity.Key, [new Claim("sub", "client_service")], now.AddMinutes(-1).UtcDateTime, now.AddMinutes(10).UtcDateTime);

        Assert.Equal(HttpStatusCode.Unauthorized, (await GetOwner(host, missing)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await GetOwner(host, nonUser)).StatusCode);
    }

    [Fact]
    public async Task Rejects_subject_with_trailing_line_break()
    {
        using var app = new TestApplication();
        using var host = CreateProbe(app);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await GetOwner(host, app.Identity.Issue("user_Alice\n", app.Clock.GetUtcNow()))).StatusCode);
    }

    [Fact]
    public async Task Rejects_unknown_key_then_accepts_token_after_signing_key_rotation()
    {
        using var app = new TestApplication();
        using var rotatedIssuer = new TestIdentityIssuer();
        using var host = CreateProbe(app);

        var beforeRotation = await GetOwner(host, rotatedIssuer.Issue(TestIdentityIssuer.Alice, app.Clock.GetUtcNow()));
        Assert.Equal(HttpStatusCode.Unauthorized, beforeRotation.StatusCode);

        var manager = host.Services.GetRequiredService<StaticJwksConfigurationManager>();
        manager.Replace(rotatedIssuer.Key);
        var afterRotation = await GetOwner(host, rotatedIssuer.Issue(TestIdentityIssuer.Alice, app.Clock.GetUtcNow()));
        Assert.Equal(HttpStatusCode.OK, afterRotation.StatusCode);
    }

    [Fact]
    public async Task Organization_claim_does_not_change_the_authenticated_owner()
    {
        using var app = new TestApplication();
        using var host = CreateProbe(app);
        var token = app.Identity.Issue(TestIdentityIssuer.Alice, app.Clock.GetUtcNow(), organization: "org_Bob");

        var response = await GetOwner(host, token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(TestIdentityIssuer.Alice, body.RootElement.GetProperty("ownerId").GetString());
        Assert.Equal("org_Bob", body.RootElement.GetProperty("organizationId").GetString());
    }

    [Theory]
    [InlineData("test-auth")]
    [InlineData("insecure-jwks")]
    public async Task Production_rejects_test_auth_or_insecure_auth_configuration(string unsafeSetting)
    {
        using var app = new TestApplication();
        using var host = app.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Production");
            builder.UseSetting("Auth:TestMode", unsafeSetting == "test-auth" ? "true" : "false");
            builder.UseSetting("Auth:Issuer", TestIdentityIssuer.Issuer);
            builder.UseSetting("Auth:Audience", TestIdentityIssuer.Audience);
            builder.UseSetting("Auth:JwksUrl", unsafeSetting == "insecure-jwks" ? "http://issuer.test/jwks" : "https://issuer.test/jwks");
            builder.UseSetting("Auth:DataProtectionKeyIdentifier", "https://test-vault.vault.azure.net/keys/test-protection");
        });

        var error = await Assert.ThrowsAsync<InvalidOperationException>(async () => await host.CreateClient().GetAsync("/openapi/v1.json"));
        Assert.Contains(unsafeSetting == "test-auth" ? "Test authentication" : "Auth:JwksUrl", error.Message);
    }

    private static WebApplicationFactory<Program> CreateProbe(TestApplication app)
    {
        var manager = new StaticJwksConfigurationManager(app.Identity.Key);
        return app.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<IStartupFilter, AuthenticationProbe>();
            services.AddSingleton(manager);
            services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
            {
                options.ConfigurationManager = manager;
                options.RefreshOnIssuerKeyNotFound = false;
            });
        }));
    }

    private static async Task<HttpResponseMessage> GetOwner(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
        return await client.GetAsync("/__tests/owner");
    }

    private static string CreateToken(SecurityKey signingKey, IEnumerable<Claim> claims, DateTime notBefore, DateTime expires)
    {
        var token = new JwtSecurityToken(TestIdentityIssuer.Issuer, TestIdentityIssuer.Audience, claims,
            notBefore, expires, new SigningCredentials(signingKey, SecurityAlgorithms.RsaSha256));
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
