using System.IdentityModel.Tokens.Jwt;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace CostTracking.Api.Auth;

public sealed class SessionTokenValidator(IOptionsMonitor<JwtBearerOptions> options)
{
    public async Task<(string Subject, string SessionId, DateTimeOffset ExpiresAt)> ValidateAsync(string token, CancellationToken cancellationToken)
    {
        var bearer = options.Get(JwtBearerDefaults.AuthenticationScheme);
        var configuration = await bearer.ConfigurationManager!.GetConfigurationAsync(cancellationToken);
        var parameters = bearer.TokenValidationParameters.Clone();
        parameters.IssuerSigningKeys = configuration.SigningKeys;
        parameters.ConfigurationManager = null;
        var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
        System.Security.Claims.ClaimsPrincipal principal;
        Microsoft.IdentityModel.Tokens.SecurityToken validatedToken;
        try { principal = handler.ValidateToken(token, parameters, out validatedToken); }
        catch (ArgumentException exception) { throw new SecurityTokenException("Access token is invalid.", exception); }
        if (validatedToken is not JwtSecurityToken jwt || jwt.Header.Alg != SecurityAlgorithms.RsaSha256)
            throw new SecurityTokenException("Token algorithm is invalid.");
        var sessionId = principal.FindFirst("sid")?.Value;
        if (string.IsNullOrWhiteSpace(sessionId)) throw new SecurityTokenException("Session identifier is missing.");
        return (CurrentOwner.Subject(principal), sessionId, new DateTimeOffset(jwt.ValidTo, TimeSpan.Zero));
    }
}
