using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;

namespace CostTracking.Api.Auth;

public static class SessionEndpoints
{
    public const string SessionCookie = "__Host-cost-session";
    private const string LoginCookie = "__Host-cost-login";
    private static readonly TimeSpan LoginLifetime = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromDays(14);

    public static IEndpointRouteBuilder MapSessionBroker(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/auth/login", LoginAsync);
        endpoints.MapGet("/auth/callback", CallbackAsync);
        endpoints.MapGet("/auth/session", SessionAsync);
        endpoints.MapPost("/auth/refresh", RefreshAsync);
        endpoints.MapPost("/auth/logout", LogoutAsync);
        return endpoints;
    }

    private static IResult LoginAsync(HttpContext context, IConfiguration configuration, IDataProtectionProvider protection, TimeProvider clock)
    {
        NoStore(context);
        var returnTo = context.Request.Query["returnTo"].FirstOrDefault() ?? "/";
        if (!IsAllowedReturnPath(returnTo)) return Results.BadRequest(new { error = "invalid_return_path" });
        var state = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var verifier = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(48));
        var challenge = WebEncoders.Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var correlation = new LoginCorrelation(state, verifier, returnTo, clock.GetUtcNow().Add(LoginLifetime));
        var cookie = protection.CreateProtector("CostTracking.AuthLogin.v1").Protect(JsonSerializer.Serialize(correlation));
        context.Response.Cookies.Append(LoginCookie, cookie, CookieOptions(LoginLifetime));
        var clientId = Required(configuration["WorkOS:ClientId"], "WorkOS:ClientId");
        var callbackUrl = RequiredHttps(configuration["Auth:CallbackUrl"], "Auth:CallbackUrl");
        var authorizeUrl = QueryHelpers.AddQueryString("https://api.workos.com/user_management/authorize", new Dictionary<string, string?>
        {
            ["response_type"] = "code", ["client_id"] = clientId, ["redirect_uri"] = callbackUrl,
            ["provider"] = "authkit", ["state"] = state, ["code_challenge_method"] = "S256", ["code_challenge"] = challenge
        });
        return Results.Redirect(authorizeUrl);
    }

    private static async Task<IResult> CallbackAsync(HttpContext context, IConfiguration configuration,
        IDataProtectionProvider protection, TimeProvider clock, IWorkOsClient workOs, SessionTokenValidator validator,
        SessionStore store, CancellationToken cancellationToken)
    {
        NoStore(context);
        context.Response.Cookies.Delete(LoginCookie, CookieOptions(TimeSpan.Zero));
        if (!context.Request.Cookies.TryGetValue(LoginCookie, out var protectedCookie) ||
            !TryReadCorrelation(protectedCookie, protection, out var correlation) ||
            correlation.ExpiresAt <= clock.GetUtcNow() ||
            !FixedEquals(correlation.State, context.Request.Query["state"].FirstOrDefault()))
            return Results.BadRequest(new { error = "invalid_login_state" });
        var code = context.Request.Query["code"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(code) || code.Length > 4096) return Results.BadRequest(new { error = "invalid_callback" });
        try
        {
            var tokens = await workOs.ExchangeCodeAsync(code, correlation.Verifier, cancellationToken);
            var identity = await validator.ValidateAsync(tokens.AccessToken, cancellationToken);
            var now = clock.GetUtcNow();
            var handle = store.Handle();
            var session = new StoredSession(identity.Subject, identity.SessionId, tokens.AccessToken, tokens.RefreshToken,
                identity.ExpiresAt, now.Add(SessionLifetime), WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32)));
            await store.WriteAsync(handle, session, cancellationToken);
            context.Response.Cookies.Append(SessionCookie, handle, CookieOptions(SessionLifetime));
            var frontend = RequiredHttps(configuration["Auth:FrontendOrigin"], "Auth:FrontendOrigin");
            return Results.Redirect(new Uri(new Uri(frontend), correlation.ReturnTo).ToString());
        }
        catch (WorkOsAuthenticationException exception) when (exception.Terminal) { return Results.Unauthorized(); }
        catch (Microsoft.IdentityModel.Tokens.SecurityTokenException) { return Results.Unauthorized(); }
        catch (OwnerAuthenticationException) { return Results.Unauthorized(); }
        catch (WorkOsAuthenticationException) { return Unavailable(context); }
        catch (Exception exception) when (exception is HttpRequestException or TimeoutException) { return Unavailable(context); }
    }

    private static async Task<IResult> SessionAsync(HttpContext context, SessionStore store, TimeProvider clock,
        CancellationToken cancellationToken)
    {
        NoStore(context);
        var session = await FindSessionAsync(context, store, cancellationToken);
        if (session is null || session.AbsoluteExpiry <= clock.GetUtcNow() || session.ExpiresAt <= clock.GetUtcNow())
            return Results.Unauthorized();
        return Results.Json(new
        {
            user = new { id = session.Subject }, accessToken = session.AccessToken,
            expiresAt = session.ExpiresAt, csrfToken = session.CsrfToken
        });
    }

    private static async Task<IResult> RefreshAsync(HttpContext context, IConfiguration configuration, SessionStore store,
        IWorkOsClient workOs, SessionTokenValidator validator, TimeProvider clock, CancellationToken cancellationToken)
    {
        NoStore(context);
        if (!await ValidateMutationAsync(context, configuration)) return Results.BadRequest(new { error = "invalid_origin_or_csrf" });
        if (!context.Request.Cookies.TryGetValue(SessionCookie, out var handle)) return Results.Unauthorized();
        try
        {
            var current = await store.UpdateAsync(handle, async (session, token) =>
            {
                if (session is null || session.AbsoluteExpiry <= clock.GetUtcNow()) return null;
                if (session.ExpiresAt > clock.GetUtcNow().AddSeconds(30)) return session;
                var tokens = await workOs.RefreshAsync(session.RefreshToken, token);
                var identity = await validator.ValidateAsync(tokens.AccessToken, token);
        if (identity.Subject != session.Subject || identity.SessionId != session.SessionId)
            throw new Microsoft.IdentityModel.Tokens.SecurityTokenException("Refreshed identity changed.");
                return session with { AccessToken = tokens.AccessToken, RefreshToken = tokens.RefreshToken, ExpiresAt = identity.ExpiresAt };
            }, cancellationToken);
            if (current is null) { context.Response.Cookies.Delete(SessionCookie, CookieOptions(TimeSpan.Zero)); return Results.Unauthorized(); }
            return Results.Json(new { user = new { id = current.Subject }, accessToken = current.AccessToken, expiresAt = current.ExpiresAt });
        }
        catch (Exception exception) when (exception is WorkOsAuthenticationException { Terminal: true } or
            Microsoft.IdentityModel.Tokens.SecurityTokenException or OwnerAuthenticationException)
        {
            await store.UpdateAsync(handle, _ => null, cancellationToken);
            context.Response.Cookies.Delete(SessionCookie, CookieOptions(TimeSpan.Zero));
            return Results.Unauthorized();
        }
        catch (Exception exception) when (exception is WorkOsAuthenticationException or HttpRequestException or IOException or TimeoutException or UnauthorizedAccessException)
        {
            context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
            context.Response.Headers.RetryAfter = "1";
            return Results.Json(new { error = "session_refresh_unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    private static async Task<IResult> LogoutAsync(HttpContext context, IConfiguration configuration, SessionStore store,
        CancellationToken cancellationToken)
    {
        NoStore(context);
        if (!await ValidateMutationAsync(context, configuration)) return Results.BadRequest(new { error = "invalid_origin_or_csrf" });
        var session = context.Request.Cookies.TryGetValue(SessionCookie, out var handle)
            ? await store.ReadAsync(handle, cancellationToken) : null;
        if (handle is not null) await store.UpdateAsync(handle, _ => null, cancellationToken);
        context.Response.Cookies.Delete(SessionCookie, CookieOptions(TimeSpan.Zero));
        var frontend = RequiredHttps(configuration["Auth:FrontendOrigin"], "Auth:FrontendOrigin");
        var logoutUrl = session is null ? frontend : QueryHelpers.AddQueryString(
            "https://api.workos.com/user_management/sessions/logout",
            new Dictionary<string, string?> { ["session_id"] = session.SessionId, ["return_to"] = frontend });
        return Results.Json(new { logoutUrl });
    }

    private static async Task<StoredSession?> FindSessionAsync(HttpContext context, SessionStore store, CancellationToken cancellationToken)
    {
        if (!context.Request.Cookies.TryGetValue(SessionCookie, out var handle)) return null;
        return await store.ReadAsync(handle, cancellationToken);
    }

    private static async Task<bool> ValidateMutationAsync(HttpContext context, IConfiguration configuration)
    {
        var expected = configuration["Auth:FrontendOrigin"];
        var origin = context.Request.Headers.Origin.ToString();
        if (string.IsNullOrEmpty(expected) || !string.Equals(origin, expected, StringComparison.Ordinal)) return false;
        if (!context.Request.Cookies.TryGetValue(SessionCookie, out var handle) || string.IsNullOrEmpty(handle)) return false;
        var session = await context.RequestServices.GetRequiredService<SessionStore>().ReadAsync(handle, context.RequestAborted);
        return session is not null && FixedEquals(session.CsrfToken, context.Request.Headers["X-CSRF-Token"].FirstOrDefault());
    }

    private static bool TryReadCorrelation(string value, IDataProtectionProvider protection, out LoginCorrelation correlation)
    {
        try
        {
            correlation = JsonSerializer.Deserialize<LoginCorrelation>(protection.CreateProtector("CostTracking.AuthLogin.v1").Unprotect(value))!;
            return correlation is not null;
        }
        catch (Exception exception) when (exception is System.Security.Cryptography.CryptographicException or JsonException)
        {
            correlation = default!;
            return false;
        }
    }

    private static bool IsAllowedReturnPath(string value)
    {
        if (!value.StartsWith('/') || value.StartsWith("//", StringComparison.Ordinal) || value.Contains('\\') ||
            value.Contains('\r') || value.Contains('\n') || !Uri.TryCreate(value, UriKind.Relative, out _)) return false;
        var route = value.Split(['?', '#'], 2)[0];
        return route is "/" or "/horses" or "/expenses" or "/income" or "/approvals" or "/tasks" or "/reports" or "/settings" ||
            route.StartsWith("/horses/", StringComparison.Ordinal) && Guid.TryParseExact(route[8..], "D", out _);
    }

    private static bool FixedEquals(string expected, string? actual)
    {
        if (actual is null) return false;
        var left = Encoding.UTF8.GetBytes(expected); var right = Encoding.UTF8.GetBytes(actual);
        return left.Length == right.Length && CryptographicOperations.FixedTimeEquals(left, right);
    }

    private static CookieOptions CookieOptions(TimeSpan maxAge) => new()
    {
        Secure = true, HttpOnly = true, SameSite = SameSiteMode.Lax, Path = "/", MaxAge = maxAge
    };

    private static void NoStore(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.Pragma = "no-cache";
    }

    private static IResult Unavailable(HttpContext context)
    {
        context.Response.Headers.RetryAfter = "1";
        context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        return Results.Json(new { error = "authentication_temporarily_unavailable" }, statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    private static string Required(string? value, string name) => string.IsNullOrWhiteSpace(value)
        ? throw new InvalidOperationException($"{name} is required.") : value;

    private static string RequiredHttps(string? value, string name) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && uri.UserInfo.Length == 0
            ? value! : throw new InvalidOperationException($"{name} must be an absolute HTTPS URL.");

    private sealed record LoginCorrelation(string State, string Verifier, string ReturnTo, DateTimeOffset ExpiresAt);
}
