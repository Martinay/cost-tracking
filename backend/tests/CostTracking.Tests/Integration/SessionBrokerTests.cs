using System.Net;
using System.Text.Json;
using System.Security.Cryptography;
using CostTracking.Tests.Fixtures;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.AspNetCore.Mvc.Testing;
using CostTracking.Api.Auth;
using CostTracking.Api.Storage;
using Microsoft.Extensions.DependencyInjection;

namespace CostTracking.Tests.Integration;

public sealed class SessionBrokerTests
{
    [Fact]
    public async Task Missing_session_returns_no_store_unauthorized_without_refresh_side_effect()
    {
        using var app = new TestApplication();
        using var client = app.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        using var response = await client.GetAsync("/auth/session");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Session_cookie_alone_never_authorizes_domain_api_requests()
    {
        using var app = new TestApplication();
        using var client = app.CreateClient();
        var handle = await CreateExpiringSessionAsync(app);
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/__tests__/missing");
        request.Headers.TryAddWithoutValidation("Cookie", SessionEndpoints.SessionCookie + "=" + handle);

        using var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.NotNull(await app.Services.GetRequiredService<SessionStore>().ReadAsync(handle));
    }

    [Theory]
    [InlineData("https://evil.test/")]
    [InlineData("//evil.test/path")]
    [InlineData("/\\evil.test")]
    [InlineData("/admin")]
    public async Task Login_rejects_external_or_malformed_return_paths(string returnTo)
    {
        using var app = new TestApplication();
        using var client = app.CreateClient();

        using var response = await client.GetAsync("/auth/login?returnTo=" + Uri.EscapeDataString(returnTo));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Callback_without_matching_state_is_rejected_without_leaking_callback_values()
    {
        using var app = new TestApplication();
        using var client = app.CreateClient();

        using var response = await client.GetAsync("/auth/callback?code=private-code&state=attacker-state");
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("private-code", body, StringComparison.Ordinal);
        Assert.DoesNotContain("attacker-state", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Logout_requires_origin_and_antiforgery_before_mutating_session()
    {
        using var app = new TestApplication();
        using var client = app.CreateClient();

        using var response = await client.PostAsync("/auth/logout", new StringContent("{}"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Login_uses_pkce_state_cookie_and_callback_creates_memory_session()
    {
        using var app = new TestApplication();
        using var client = app.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        using var login = await client.GetAsync("/auth/login?returnTo=%2Fhorses");
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        Assert.StartsWith("https://api.workos.com/user_management/authorize?", login.Headers.Location!.ToString());
        var authorization = QueryHelpers.ParseQuery(login.Headers.Location.Query);
        Assert.Equal("S256", authorization["code_challenge_method"]);
        Assert.Equal("authkit", authorization["provider"]);
        var correlation = Assert.Single(login.Headers.GetValues("Set-Cookie"));
        Assert.Contains("__Host-cost-login=", correlation, StringComparison.Ordinal);
        Assert.Contains("secure", correlation, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", correlation, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", correlation, StringComparison.OrdinalIgnoreCase);

        using var callbackRequest = new HttpRequestMessage(HttpMethod.Get,
            "/auth/callback?code=authorization-code&state=" + Uri.EscapeDataString(authorization["state"]!));
        callbackRequest.Headers.TryAddWithoutValidation("Cookie", correlation.Split(';', 2)[0]);
        using var callback = await client.SendAsync(callbackRequest);
        Assert.Equal(HttpStatusCode.Redirect, callback.StatusCode);
        Assert.Equal("https://app.test/horses", callback.Headers.Location!.ToString());
        var sessionCookie = callback.Headers.GetValues("Set-Cookie").Single(value => value.StartsWith("__Host-cost-session=", StringComparison.Ordinal));
        Assert.Contains("secure", sessionCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", sessionCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", sessionCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/", sessionCookie, StringComparison.OrdinalIgnoreCase);
        Assert.True(app.WorkOs.LastVerifier!.Length >= 43);

        using var sessionRequest = new HttpRequestMessage(HttpMethod.Get, "/auth/session");
        sessionRequest.Headers.TryAddWithoutValidation("Cookie", sessionCookie.Split(';', 2)[0]);
        using var session = await client.SendAsync(sessionRequest);
        Assert.Equal(HttpStatusCode.OK, session.StatusCode);
        Assert.Contains("no-store", session.Headers.CacheControl?.ToString(), StringComparison.OrdinalIgnoreCase);
        using var body = JsonDocument.Parse(await session.Content.ReadAsStringAsync());
        Assert.Equal(TestIdentityIssuer.Alice, body.RootElement.GetProperty("user").GetProperty("id").GetString());
        Assert.True(body.RootElement.GetProperty("accessToken").GetString()!.Length > 20);
        Assert.True(body.RootElement.GetProperty("csrfToken").GetString()!.Length > 20);
        Assert.Equal(0, app.WorkOs.RefreshCount);
    }

    [Fact]
    public async Task Concurrent_refresh_requests_rotate_once_and_both_return_the_current_token()
    {
        using var app = new TestApplication();
        using var client = app.CreateClient();
        app.WorkOs.RefreshDelay = TimeSpan.FromMilliseconds(25);
        var handle = await CreateExpiringSessionAsync(app);

        var first = client.SendAsync(RefreshRequest(handle));
        var second = client.SendAsync(RefreshRequest(handle));
        var responses = await PairAsync(first, second);
        Assert.All(responses, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        Assert.Equal(1, app.WorkOs.RefreshCount);
        var accessTokens = await Task.WhenAll(responses.Select(async response =>
        {
            using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            return body.RootElement.GetProperty("accessToken").GetString();
        }));
        Assert.Equal(accessTokens[0], accessTokens[1]);
        var stored = await app.Services.GetRequiredService<SessionStore>().ReadAsync(handle);
        Assert.NotNull(stored);
        Assert.NotEqual("refresh_initial", stored.RefreshToken);
        foreach (var response in responses) response.Dispose();
    }

    [Theory]
    [InlineData(false, (int)HttpStatusCode.ServiceUnavailable)]
    [InlineData(true, (int)HttpStatusCode.Unauthorized)]
    public async Task Refresh_failures_keep_retryable_session_and_remove_terminal_session(bool terminal, int expectedStatus)
    {
        using var app = new TestApplication();
        using var client = app.CreateClient();
        app.WorkOs.FailRefreshTerminally = terminal;
        app.WorkOs.FailRefreshTransiently = !terminal;
        var handle = await CreateExpiringSessionAsync(app);

        using var response = await client.SendAsync(RefreshRequest(handle));

        Assert.Equal((HttpStatusCode)expectedStatus, response.StatusCode);
        var stored = await app.Services.GetRequiredService<SessionStore>().ReadAsync(handle);
        Assert.Equal(!terminal, stored is not null);
    }

    [Fact]
    public async Task Invalid_jwt_returned_during_refresh_is_terminal_and_never_persisted()
    {
        using var app = new TestApplication();
        using var client = app.CreateClient();
        app.WorkOs.NextRefreshAccessToken = "not-a-jwt";
        var handle = await CreateExpiringSessionAsync(app);

        using var response = await client.SendAsync(RefreshRequest(handle));

        Assert.True(response.StatusCode == HttpStatusCode.Unauthorized,
            $"Expected 401, got {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        Assert.Null(await app.Services.GetRequiredService<SessionStore>().ReadAsync(handle));
    }

    [Fact]
    public async Task Refresh_token_without_session_identity_is_terminal_and_never_persisted()
    {
        using var app = new TestApplication();
        using var client = app.CreateClient();
        app.WorkOs.NextRefreshAccessToken = app.Identity.Issue(TestIdentityIssuer.Alice, app.Clock.GetUtcNow(), sessionId: null);
        var handle = await CreateExpiringSessionAsync(app);

        using var response = await client.SendAsync(RefreshRequest(handle));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Null(await app.Services.GetRequiredService<SessionStore>().ReadAsync(handle));
    }

    [Fact]
    public async Task Refresh_storage_failure_keeps_the_previous_session_and_returns_retryable_failure()
    {
        if (OperatingSystem.IsWindows()) return;
        using var app = new TestApplication();
        using var client = app.CreateClient();
        var handle = await CreateExpiringSessionAsync(app);
        var directory = Path.Combine(app.StorageRoot, "auth", "sessions");
        var originalMode = File.GetUnixFileMode(directory);
        try
        {
            File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserExecute);

            using var response = await client.SendAsync(RefreshRequest(handle));

            Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
            Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.OrdinalIgnoreCase);
            var stored = await app.Services.GetRequiredService<SessionStore>().ReadAsync(handle);
            Assert.NotNull(stored);
            Assert.Equal("refresh_initial", stored.RefreshToken);
        }
        finally
        {
            File.SetUnixFileMode(directory, originalMode);
        }
    }

    [Fact]
    public async Task Logout_racing_refresh_never_resurrects_a_deleted_session()
    {
        using var app = new TestApplication();
        using var client = app.CreateClient();
        var handle = await CreateExpiringSessionAsync(app);

        var refresh = client.SendAsync(RefreshRequest(handle));
        var logout = client.SendAsync(LogoutRequest(handle, "csrf_test"));
        using var refreshResponse = await refresh;
        using var logoutResponse = await logout;

        Assert.Contains(refreshResponse.StatusCode, new[] { HttpStatusCode.OK, HttpStatusCode.Unauthorized });
        Assert.Equal(HttpStatusCode.OK, logoutResponse.StatusCode);
        Assert.Null(await app.Services.GetRequiredService<SessionStore>().ReadAsync(handle));
    }

    [Fact]
    public async Task Session_tokens_are_encrypted_in_a_private_hashed_operational_file()
    {
        using var app = new TestApplication();
        _ = await app.CreateClient().GetAsync("/auth/session");
        var handle = await CreateExpiringSessionAsync(app);
        var path = Assert.Single(Directory.GetFiles(Path.Combine(app.StorageRoot, "auth", "sessions"), "*.session"));
        var contents = await File.ReadAllTextAsync(path);

        Assert.DoesNotContain(handle, Path.GetFileName(path), StringComparison.Ordinal);
        Assert.DoesNotContain("refresh_initial", contents, StringComparison.Ordinal);
        Assert.NotEmpty(Directory.GetFiles(Path.Combine(app.StorageRoot, "auth", "keys"), "*.xml"));
        var session = await app.Services.GetRequiredService<SessionStore>().ReadAsync(handle);
        Assert.Equal("refresh_initial", session?.RefreshToken);
        if (!OperatingSystem.IsWindows())
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(path));
    }

    [Fact]
    public async Task Session_payload_survives_host_restart_when_the_shared_key_ring_is_retained()
    {
        using var app = new TestApplication();
        _ = await app.CreateClient().GetAsync("/auth/session");
        var handle = await CreateExpiringSessionAsync(app);
        using var restarted = app.WithWebHostBuilder(_ => { });
        _ = await restarted.CreateClient().GetAsync("/auth/session");

        var recovered = await restarted.Services.GetRequiredService<SessionStore>().ReadAsync(handle);

        Assert.NotNull(recovered);
        Assert.Equal(TestIdentityIssuer.Alice, recovered.Subject);
        Assert.Equal("refresh_initial", recovered.RefreshToken);
    }

    [Fact]
    public async Task Callback_rejects_a_bad_jwt_and_an_expired_state_cookie()
    {
        using var app = new TestApplication();
        using var client = app.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        app.WorkOs.NextExchangeAccessToken = "not-a-jwt";
        using var login = await client.GetAsync("/auth/login?returnTo=%2Fhorses");
        var correlation = login.Headers.GetValues("Set-Cookie").Single().Split(';', 2)[0];
        var state = QueryHelpers.ParseQuery(login.Headers.Location!.Query)["state"].ToString();
        using var callbackRequest = new HttpRequestMessage(HttpMethod.Get, "/auth/callback?code=authorization-code&state=" + Uri.EscapeDataString(state));
        callbackRequest.Headers.TryAddWithoutValidation("Cookie", correlation);
        using var callback = await client.SendAsync(callbackRequest);
        Assert.Equal(HttpStatusCode.Unauthorized, callback.StatusCode);
        Assert.DoesNotContain(callback.Headers.GetValues("Set-Cookie"), value => value.StartsWith("__Host-cost-session=", StringComparison.Ordinal));

        using var secondLogin = await client.GetAsync("/auth/login?returnTo=%2Fhorses");
        var expiredCorrelation = secondLogin.Headers.GetValues("Set-Cookie").Single().Split(';', 2)[0];
        var expiredState = QueryHelpers.ParseQuery(secondLogin.Headers.Location!.Query)["state"].ToString();
        app.Clock.Advance(TimeSpan.FromMinutes(6));
        using var expiredRequest = new HttpRequestMessage(HttpMethod.Get, "/auth/callback?code=authorization-code&state=" + Uri.EscapeDataString(expiredState));
        expiredRequest.Headers.TryAddWithoutValidation("Cookie", expiredCorrelation);
        using var expired = await client.SendAsync(expiredRequest);
        Assert.Equal(HttpStatusCode.BadRequest, expired.StatusCode);
        Assert.Contains("no-store", expired.Headers.CacheControl?.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Logout_checks_origin_and_csrf_then_deletes_the_operational_session()
    {
        using var app = new TestApplication();
        using var client = app.CreateClient();
        var handle = await CreateExpiringSessionAsync(app);

        using var denied = await client.SendAsync(LogoutRequest(handle, "wrong"));
        Assert.Equal(HttpStatusCode.BadRequest, denied.StatusCode);
        Assert.NotNull(await app.Services.GetRequiredService<SessionStore>().ReadAsync(handle));

        using var success = await client.SendAsync(LogoutRequest(handle, "csrf_test"));
        Assert.Equal(HttpStatusCode.OK, success.StatusCode);
        Assert.Contains("no-store", success.Headers.CacheControl?.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.Null(await app.Services.GetRequiredService<SessionStore>().ReadAsync(handle));
        using var body = JsonDocument.Parse(await success.Content.ReadAsStringAsync());
        Assert.StartsWith("https://api.workos.com/user_management/sessions/logout?", body.RootElement.GetProperty("logoutUrl").GetString());
        Assert.Contains("session_id=sid_test", body.RootElement.GetProperty("logoutUrl").GetString(), StringComparison.Ordinal);
    }

    private static async Task<string> CreateExpiringSessionAsync(TestApplication app)
    {
        var now = app.Clock.GetUtcNow();
        var handle = app.Services.GetRequiredService<SessionStore>().Handle();
        var accessToken = app.Identity.Issue(TestIdentityIssuer.Alice, now, sessionId: "sid_test");
        await app.Services.GetRequiredService<SessionStore>().WriteAsync(handle, new StoredSession(TestIdentityIssuer.Alice,
            "sid_test", accessToken, "refresh_initial", now.AddSeconds(10), now.AddDays(10), "csrf_test"));
        return handle;
    }

    private static HttpRequestMessage RefreshRequest(string handle)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh") { Content = new StringContent("{}") };
        request.Headers.TryAddWithoutValidation("Origin", "https://app.test");
        request.Headers.TryAddWithoutValidation("X-CSRF-Token", "csrf_test");
        request.Headers.TryAddWithoutValidation("Cookie", SessionEndpoints.SessionCookie + "=" + handle);
        return request;
    }

    private static HttpRequestMessage LogoutRequest(string handle, string csrf)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/auth/logout") { Content = new StringContent("{}") };
        request.Headers.TryAddWithoutValidation("Origin", "https://app.test");
        request.Headers.TryAddWithoutValidation("X-CSRF-Token", csrf);
        request.Headers.TryAddWithoutValidation("Cookie", SessionEndpoints.SessionCookie + "=" + handle);
        return request;
    }

    private static async Task<HttpResponseMessage[]> PairAsync(Task<HttpResponseMessage> first, Task<HttpResponseMessage> second) =>
        await Task.WhenAll(first, second);
}
