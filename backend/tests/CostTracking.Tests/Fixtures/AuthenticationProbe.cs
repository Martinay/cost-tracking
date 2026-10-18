using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace CostTracking.Tests.Fixtures;

/// <summary>A test-only protected route, kept out of the production route table and OpenAPI document.</summary>
public sealed class AuthenticationProbe : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        app.Use(async (context, continuation) =>
        {
            if (context.Request.Path != "/__tests/owner")
            {
                await continuation(context);
                return;
            }

            var result = await context.AuthenticateAsync();
            if (!result.Succeeded || result.Principal is null)
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }

            var subject = result.Principal.FindFirst("sub")?.Value;
            context.Response.ContentType = "application/json";
            await JsonSerializer.SerializeAsync(context.Response.Body, new
            {
                ownerId = subject,
                organizationId = result.Principal.FindFirst("org_id")?.Value
            });
        });

        next(app);
    };
}

/// <summary>In-memory JWKS metadata source; it never performs network requests.</summary>
public sealed class StaticJwksConfigurationManager(SecurityKey key) : IConfigurationManager<OpenIdConnectConfiguration>
{
    private OpenIdConnectConfiguration current = Create(key);

    public Task<OpenIdConnectConfiguration> GetConfigurationAsync(CancellationToken cancel) => Task.FromResult(current);
    public void RequestRefresh() { }
    public void Replace(SecurityKey replacement) => current = Create(replacement);

    private static OpenIdConnectConfiguration Create(SecurityKey key)
    {
        var configuration = new OpenIdConnectConfiguration { Issuer = TestIdentityIssuer.Issuer };
        configuration.SigningKeys.Add(key);
        return configuration;
    }
}
