using CostTracking.Tests.Fixtures;
using CostTracking.Api.Auth;
using CostTracking.Api.Storage;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;

namespace CostTracking.TestHost;

public static class HarnessProgram
{
    public static async Task Main(string[] args)
    {
        var configuredStorageRoot = Environment.GetEnvironmentVariable("E2E_STORAGE_ROOT");
        var storageRoot = configuredStorageRoot is null
            ? Path.Combine(Path.GetTempPath(), "cost-tracking-e2e", Guid.NewGuid().ToString("N"))
            : ValidateStorageRoot(configuredStorageRoot);
        var deleteStorageRootOnDispose = configuredStorageRoot is null;
        const string apiFrontendOrigin = "https://app.test";
        // The multi-journey browser suite shares one synthetic identity. Keep a finite but higher
        // test-host-only budget so the suite can exercise all flows without changing production limits.
        const int fixtureRequestLimitPerMinute = 600;
        var fixtureBrowserOrigin = Environment.GetEnvironmentVariable("E2E_WEB_URL") ?? apiFrontendOrigin;
        // A host restart can keep the same event stream, so fixture IDs must remain unique across fixture instances.
        Func<Guid> fixtureIdFactory = Guid.NewGuid;
        var fixture = new TestApplication(storageRoot, deleteStorageRootOnDispose: false,
            frontendOrigin: apiFrontendOrigin, idFactory: fixtureIdFactory,
            rateLimitPermitLimit: fixtureRequestLimitPerMinute);
        var api = fixture.CreateClient();
        if (args.Length == 2 && args[0] == "--export-openapi")
        {
            var response = await api.GetAsync("/openapi/v1.json");
            response.EnsureSuccessStatusCode();
            await File.WriteAllTextAsync(args[1], await response.Content.ReadAsStringAsync());
            api.Dispose();
            fixture.Dispose();
            if (deleteStorageRootOnDispose && Directory.Exists(storageRoot)) Directory.Delete(storageRoot, true);
            return;
        }
        var builder = WebApplication.CreateBuilder(args);
        builder.Logging.ClearProviders();
        var app = builder.Build();
        app.MapGet("/__fixture/health", () => Results.Ok(new { ready = true }));
        app.MapGet("/__fixture/jwks", () => Results.Json(fixture.Identity.Jwks()));
        app.Use(async (context, next) =>
        {
            var fixtureMutation = context.Request.Path.StartsWithSegments("/__fixture/session") ||
                                  context.Request.Path.StartsWithSegments("/__fixture/restart") ||
                                  context.Request.Path.StartsWithSegments("/__fixture/scale");
            if (context.Request.Path.StartsWithSegments("/__fixture"))
            {
                if (fixtureMutation)
                {
                    context.Response.Headers.AccessControlAllowOrigin = fixtureBrowserOrigin;
                    context.Response.Headers.AccessControlAllowCredentials = "true";
                    context.Response.Headers.Vary = "Origin";
                    if (context.Request.Method == "OPTIONS")
                    {
                        context.Response.Headers.AccessControlAllowMethods = "POST,OPTIONS";
                        context.Response.Headers.AccessControlAllowHeaders = "Content-Type";
                        context.Response.StatusCode = StatusCodes.Status204NoContent;
                        return;
                    }
                    if (!IsLoopbackRequest(context, fixtureBrowserOrigin))
                    {
                        context.Response.StatusCode = StatusCodes.Status403Forbidden;
                        return;
                    }
                }
            }
            await next();
        });
        app.MapPost("/__fixture/session", async (HttpContext context) =>
        {
            var subject = await ReadFixtureSubjectAsync(context);
            if (subject is null) return Results.BadRequest(new { error = "fixture_subject_invalid" });
            var accessToken = fixture.Identity.Issue(subject, fixture.Clock.GetUtcNow(), sessionId: $"session_{subject}");
            var store = fixture.Services.GetRequiredService<SessionStore>();
            var cookieHandle = store.Handle();
            var now = fixture.Clock.GetUtcNow();
            var session = new StoredSession(subject, $"session_{subject}", accessToken, "fixture-refresh-token",
                now.AddMinutes(10), now.AddDays(14), WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32)));
            await store.WriteAsync(cookieHandle, session, context.RequestAborted);
            context.Response.Cookies.Append(SessionEndpoints.SessionCookie, cookieHandle, new CookieOptions
            {
                Secure = true, HttpOnly = true, SameSite = SameSiteMode.Lax, Path = "/", MaxAge = TimeSpan.FromDays(14)
            });
            return Results.Json(new { subject = session.Subject });
        });
        app.MapPost("/__fixture/scale", async (HttpContext context) =>
        {
            if (!await HasEmptyFixtureObjectAsync(context))
                return Results.BadRequest(new { error = "fixture_request_invalid" });

            var events = ScaleAccount.Create();
            var setupEvents = events.Count(value => value.Type is "AccountConfigured" or "HorseRegistered" or
                "RecurringExpenseRuleCreated" or "RecurringIncomeRuleCreated");
            var acceptedChanges = events.Count - setupEvents;
            var eventMix = events.Skip(setupEvents).GroupBy(value => value.Type, StringComparer.Ordinal)
                .OrderBy(group => group.Key, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);
            var store = fixture.Services.GetRequiredService<JsonlEventStore>();
            var path = store.PathFor(ScaleAccount.Subject);
            var directory = Path.GetDirectoryName(path)!;
            Directory.CreateDirectory(directory);
            var serializer = new CostTracking.Api.Storage.EventSerializer();
            using var bytes = new MemoryStream();
            foreach (var value in events)
            {
                await bytes.WriteAsync(serializer.Serialize(value), context.RequestAborted);
                bytes.WriteByte((byte)'\n');
            }
            var content = bytes.ToArray();
            try
            {
                await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                await file.WriteAsync(content, context.RequestAborted);
                file.Flush(flushToDisk: true);
            }
            catch (IOException) when (File.Exists(path))
            {
                // A retry is safe only when it finds the exact same deterministic stream.
                // Never replace an existing account stream, which may already be in use.
                var existing = await File.ReadAllBytesAsync(path, context.RequestAborted);
                if (!existing.AsSpan().SequenceEqual(content))
                    return Results.Conflict(new { error = "fixture_stream_already_exists" });
            }

            return Results.Json(new
            {
                subject = ScaleAccount.Subject,
                horses = ScaleAccount.HorseCount,
                setupEvents,
                acceptedChanges,
                streamEvents = events.Count,
                eventMix,
                dateWindow = new { from = ScaleAccount.WindowFrom, through = ScaleAccount.WindowThrough, asOfDate = ScaleAccount.AsOfDate }
            });
        });
        app.MapPost("/__fixture/restart", () =>
        {
            api.Dispose();
            fixture.Dispose();
            fixture = new TestApplication(storageRoot, deleteStorageRootOnDispose: false,
                frontendOrigin: apiFrontendOrigin, idFactory: fixtureIdFactory,
                rateLimitPermitLimit: fixtureRequestLimitPerMinute);
            api = fixture.CreateClient();
            return Results.Ok(new { restarted = true });
        });
        app.MapFallback(async (HttpContext context) =>
        {
            using var request = new HttpRequestMessage(new HttpMethod(context.Request.Method),
                context.Request.Path + context.Request.QueryString);
            if (context.Request.ContentLength > 0 || context.Request.Headers.ContainsKey("Transfer-Encoding"))
                request.Content = new StreamContent(context.Request.Body);
            foreach (var header in context.Request.Headers)
            {
                if (header.Key.Equals("Host", StringComparison.OrdinalIgnoreCase)) continue;
                if (!request.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray()))
                    request.Content?.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
            }
            using var response = await api.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
            context.Response.StatusCode = (int)response.StatusCode;
            foreach (var header in response.Headers.Concat(response.Content.Headers))
                context.Response.Headers[header.Key] = header.Value.ToArray();
            context.Response.Headers.Remove("transfer-encoding");
            await response.Content.CopyToAsync(context.Response.Body, context.RequestAborted);
        });
        try { await app.RunAsync(); }
        finally
        {
            api.Dispose();
            fixture.Dispose();
            if (deleteStorageRootOnDispose && Directory.Exists(storageRoot)) Directory.Delete(storageRoot, true);
        }
    }

    private static string ValidateStorageRoot(string value)
    {
        var tempRoot = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "cost-tracking-e2e")) + Path.DirectorySeparatorChar;
        var fullPath = Path.GetFullPath(value);
        if (!fullPath.StartsWith(tempRoot, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal) ||
            string.Equals(fullPath.TrimEnd(Path.DirectorySeparatorChar), tempRoot.TrimEnd(Path.DirectorySeparatorChar),
                OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
            throw new ArgumentException("E2E_STORAGE_ROOT must be a child of the dedicated cost-tracking-e2e temp directory.");
        return fullPath;
    }

    private static async Task<string?> ReadFixtureSubjectAsync(HttpContext context)
    {
        try
        {
            using var document = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted);
            if (document.RootElement.ValueKind != JsonValueKind.Object) return null;
            var properties = document.RootElement.EnumerateObject().ToArray();
            if (properties.Any(property => property.Name != "subject") || properties.Length > 1) return null;
            if (properties.Length == 0) return "user_Fixture";
            var value = properties[0].Value;
            if (value.ValueKind != JsonValueKind.String) return null;
            return value.GetString() is "user_Fixture" or "user_FixtureB" ? value.GetString() : null;
        }
        catch (JsonException) { return null; }
    }

    private static async Task<bool> HasEmptyFixtureObjectAsync(HttpContext context)
    {
        try
        {
            using var document = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: context.RequestAborted);
            return document.RootElement.ValueKind == JsonValueKind.Object && !document.RootElement.EnumerateObject().Any();
        }
        catch (JsonException) { return false; }
    }

    private static bool IsLoopbackRequest(HttpContext context, string browserOrigin)
    {
        if (context.Connection.RemoteIpAddress is not { } remote || !IPAddress.IsLoopback(remote)) return false;
        if (!IsLoopbackHost(context.Request.Host.Host) ||
            !Uri.TryCreate(browserOrigin, UriKind.Absolute, out var origin) || !IsLoopbackHost(origin.Host))
            return false;
        return StringComparer.Ordinal.Equals(context.Request.Headers.Origin, browserOrigin);
    }

    private static bool IsLoopbackHost(string host) =>
        IPAddress.TryParse(host, out var address) ? IPAddress.IsLoopback(address) : host == "localhost";
}
