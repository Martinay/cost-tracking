using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Text.Json;
using Microsoft.IdentityModel.JsonWebTokens;

namespace CostTracking.Api.Auth;

public static class JwtAuthentication
{
    /// <summary>Registers bearer-only owner authentication using an HTTPS JWKS document, never discovery.</summary>
    public static IServiceCollection AddOwnerAuthentication(this IServiceCollection services)
    {
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
        services.AddAuthorization();
        services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme).Configure<TimeProvider, IConfiguration>((options, clock, configuration) =>
        {
            ValidateConfiguration(configuration);
            var issuer = configuration["Auth:Issuer"]!;
            var jwks = configuration["Auth:JwksUrl"]!;
            var clientId = configuration["WorkOS:ClientId"]!;

            options.MapInboundClaims = false;
            options.IncludeErrorDetails = false;
            options.RefreshOnIssuerKeyNotFound = true;
            options.ConfigurationManager = new ConfigurationManager<OpenIdConnectConfiguration>(jwks,
                new JwksRetriever(issuer), new HttpDocumentRetriever { RequireHttps = true });
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidIssuer = issuer,
                // AuthKit session tokens identify the application with client_id, not aud.
                ValidateIssuer = true, ValidateAudience = false, RequireAudience = false,
                ValidateIssuerSigningKey = true, RequireSignedTokens = true,
                ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
                RequireExpirationTime = true, ValidateLifetime = true, ClockSkew = TimeSpan.Zero,
                LifetimeValidator = (notBefore, expires, _, _) => expires.HasValue &&
                    expires.Value > clock.GetUtcNow().UtcDateTime &&
                    (!notBefore.HasValue || notBefore.Value <= clock.GetUtcNow().UtcDateTime)
            };
            options.Events = new JwtBearerEvents
            {
                OnTokenValidated = context =>
                {
                    try
                    {
                        ValidateClientId(context.SecurityToken, clientId);
                        _ = CurrentOwner.Subject(context.Principal!);
                    }
                    catch (SecurityTokenValidationException) { context.Fail("Invalid client identifier."); }
                    catch (OwnerAuthenticationException) { context.Fail("Invalid user subject."); }
                    return Task.CompletedTask;
                }
            };
        }).ValidateOnStart();
        return services;
    }

    public static void ValidateConfiguration(IConfiguration configuration)
    {
        if (configuration.GetValue<bool>("Auth:TestMode"))
            throw new InvalidOperationException("Test authentication configuration is prohibited.");
        _ = RequireHttps(configuration["Auth:Issuer"], "Auth:Issuer");
        _ = RequireHttps(configuration["Auth:JwksUrl"], "Auth:JwksUrl");
        if (string.IsNullOrWhiteSpace(configuration["WorkOS:ClientId"]))
            throw new InvalidOperationException("WorkOS:ClientId is required.");
    }

    internal static void ValidateClientId(SecurityToken token, string expectedClientId)
    {
        // Inspect the signed payload so arrays and non-string values cannot be
        // normalized into an apparently valid string claim by a token handler.
        var payload = token switch
        {
            JsonWebToken json => json.EncodedPayload,
            JwtSecurityToken jwt => jwt.RawPayload,
            _ => throw new SecurityTokenValidationException("Unsupported access token.")
        };
        using var document = JsonDocument.Parse(Base64UrlEncoder.DecodeBytes(payload));
        var claims = document.RootElement.EnumerateObject().Where(property => property.NameEquals("client_id")).ToArray();
        if (string.IsNullOrWhiteSpace(expectedClientId) || claims.Length != 1 ||
            claims[0].Value.ValueKind != JsonValueKind.String ||
            !string.Equals(claims[0].Value.GetString(), expectedClientId, StringComparison.Ordinal))
            throw new SecurityTokenValidationException("Invalid client identifier.");
    }

    private static string RequireHttps(string? value, string name)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps ||
            uri.UserInfo.Length != 0 || uri.Fragment.Length != 0)
            throw new InvalidOperationException($"{name} must be an absolute HTTPS URL.");
        return value!;
    }

    private sealed class JwksRetriever(string issuer) : IConfigurationRetriever<OpenIdConnectConfiguration>
    {
        public async Task<OpenIdConnectConfiguration> GetConfigurationAsync(string address, IDocumentRetriever retriever, CancellationToken cancel)
        {
            var json = await retriever.GetDocumentAsync(address, cancel);
            var keys = new JsonWebKeySet(json).GetSigningKeys();
            if (keys.Count == 0) throw new InvalidDataException("JWKS contains no signing keys.");
            var configuration = new OpenIdConnectConfiguration { Issuer = issuer };
            foreach (var key in keys) configuration.SigningKeys.Add(key);
            return configuration;
        }
    }
}
