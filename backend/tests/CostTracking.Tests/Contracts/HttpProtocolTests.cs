using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using CostTracking.Api.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace CostTracking.Tests.Contracts;

public sealed class HttpProtocolTests
{
    private static readonly Guid Key = Guid.Parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("nope")]
    [InlineData("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-extra")]
    public async Task Commit_requires_a_valid_uuid_idempotency_key(string? key)
    {
        using var client = CreateClient();
        using var request = Command("/api/v1/__tests__/command");
        request.Headers.Remove("Idempotency-Key");
        if (key is not null) request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        request.Headers.TryAddWithoutValidation("If-Match", "\"7\"");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_header", await ErrorCode(response));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("7")]
    [InlineData("W/\"7\"")]
    [InlineData("\"7\", \"8\"")]
    [InlineData("\"-1\"")]
    [InlineData("\"7x\"")]
    public async Task Commit_requires_a_quoted_nonnegative_integer_if_match(string? match)
    {
        using var client = CreateClient();
        using var request = Command("/api/v1/__tests__/command");
        request.Headers.Remove("If-Match");
        request.Headers.TryAddWithoutValidation("Idempotency-Key", Key.ToString());
        if (match is not null) request.Headers.TryAddWithoutValidation("If-Match", match);

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_header", await ErrorCode(response));
    }

    [Fact]
    public async Task Valid_commit_headers_are_parsed_and_preview_is_exempt()
    {
        using var client = CreateClient();
        var command = await client.SendAsync(Command("/api/v1/__tests__/command"));
        var preview = await client.PostAsync("/api/v1/previews/financial", Json("{}"));

        Assert.Equal(HttpStatusCode.OK, command.StatusCode);
        Assert.Equal(Key, Guid.Parse(JsonDocument.Parse(await command.Content.ReadAsStringAsync()).RootElement.GetProperty("key").GetString()!));
        Assert.Equal(7, JsonDocument.Parse(await command.Content.ReadAsStringAsync()).RootElement.GetProperty("expectedVersion").GetInt64());
        Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
    }

    [Fact]
    public async Task Successful_response_has_version_etag()
    {
        using var client = CreateClient();
        var response = await client.GetAsync("/api/v1/__tests__/etag");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("\"12\"", response.Headers.ETag?.ToString());
        Assert.Equal(12, JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("streamVersion").GetInt64());
    }

    [Fact]
    public async Task Json_rejects_duplicate_unknown_enum_case_and_invalid_date()
    {
        using var client = CreateClient();
        foreach (var body in new[]
        {
            "{\"value\":1,\"value\":2,\"kind\":\"Small\",\"date\":\"2026-01-01\"}",
            "{\"value\":1,\"kind\":\"Small\",\"date\":\"2026-01-01\",\"extra\":true}",
            "{\"value\":1,\"kind\":\"small\",\"date\":\"2026-01-01\"}",
            "{\"value\":1,\"kind\":\"Small\",\"date\":\"2026-02-30\"}"
        })
        {
            using var request = Command("/api/v1/__tests__/body");
            request.Content = Json(body);
            var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("malformed_request", await ErrorCode(response));
        }
    }

    [Fact]
    public async Task Command_body_over_64_kib_is_rejected()
    {
        using var client = CreateClient();
        using var request = Command("/api/v1/__tests__/body");
        request.Content = Json("{\"value\":1,\"kind\":\"Small\",\"date\":\"2026-01-01\",\"padding\":\"" + new string('x', 65_500) + "\"}");
        var response = await client.SendAsync(request);

        Assert.Equal((HttpStatusCode)413, response.StatusCode);
        Assert.Equal("request_too_large", await ErrorCode(response));
    }

    [Fact]
    public async Task Unexpected_io_error_is_safe_and_absent_or_foreign_are_identical()
    {
        using var client = CreateClient();
        var missing = await client.GetAsync("/api/v1/__tests__/missing");
        var foreign = await client.GetAsync("/api/v1/__tests__/foreign");
        var failure = await client.GetAsync("/api/v1/__tests__/io-error");
        var deniedStorage = await client.GetAsync("/api/v1/__tests__/permission-error");

        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        using var missingJson = JsonDocument.Parse(await missing.Content.ReadAsStringAsync());
        using var foreignJson = JsonDocument.Parse(await foreign.Content.ReadAsStringAsync());
        Assert.Equal(missingJson.RootElement.GetProperty("code").GetString(), foreignJson.RootElement.GetProperty("code").GetString());
        Assert.Equal(missingJson.RootElement.GetProperty("message").GetString(), foreignJson.RootElement.GetProperty("message").GetString());
        Assert.Equal(missingJson.RootElement.TryGetProperty("details", out var missingDetails), foreignJson.RootElement.TryGetProperty("details", out var foreignDetails));
        if (missingDetails.ValueKind != JsonValueKind.Undefined) Assert.Equal(missingDetails.GetRawText(), foreignDetails.GetRawText());
        Assert.Equal(HttpStatusCode.ServiceUnavailable, failure.StatusCode);
        var json = await failure.Content.ReadAsStringAsync();
        Assert.DoesNotContain("secret", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("path", json, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("storage_unavailable", await ErrorCode(failure));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, deniedStorage.StatusCode);
        Assert.Equal("storage_unavailable", await ErrorCode(deniedStorage));
    }

    [Fact]
    public async Task Error_dto_omits_absent_optional_members_and_preserves_field_details()
    {
        using var client = CreateClient();
        using var ordinary = JsonDocument.Parse(await (await client.GetAsync("/api/v1/__tests__/missing")).Content.ReadAsStringAsync());
        using var field = JsonDocument.Parse(await (await client.GetAsync("/api/v1/__tests__/field-error")).Content.ReadAsStringAsync());

        Assert.Equal(new[] { "code", "message", "correlationId" }, ordinary.RootElement.EnumerateObject().Select(property => property.Name).ToArray());
        Assert.False(ordinary.RootElement.TryGetProperty("details", out _));
        Assert.False(ordinary.RootElement.TryGetProperty("streamVersion", out _));
        var detail = Assert.Single(field.RootElement.GetProperty("details").EnumerateArray());
        Assert.Equal("name", detail.GetProperty("field").GetString());
        Assert.Equal("Name is required.", detail.GetProperty("message").GetString());
        Assert.False(field.RootElement.TryGetProperty("streamVersion", out _));
    }

    [Fact]
    public async Task Cors_is_exact_and_exposes_protocol_headers()
    {
        using var client = CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/__tests__/etag");
        request.Headers.TryAddWithoutValidation("Origin", "https://app.test");
        var allowed = await client.SendAsync(request);
        using var badOriginRequest = new HttpRequestMessage(HttpMethod.Get, "/api/v1/__tests__/etag");
        badOriginRequest.Headers.TryAddWithoutValidation("Origin", "https://evil.test");
        var denied = await client.SendAsync(badOriginRequest);

        Assert.Equal("https://app.test", allowed.Headers.GetValues("Access-Control-Allow-Origin").Single());
        var exposed = allowed.Headers.GetValues("Access-Control-Expose-Headers").Single();
        Assert.Contains("ETag", exposed, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Retry-After", exposed, StringComparison.OrdinalIgnoreCase);
        Assert.False(denied.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task Rate_limit_returns_429_with_retry_after()
    {
        using var client = CreateClient(permitLimit: 2);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/__tests__/etag")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/v1/__tests__/etag")).StatusCode);
        var limited = await client.GetAsync("/api/v1/__tests__/etag");

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.True(limited.Headers.Contains("Retry-After"));
        Assert.Equal("rate_limited", await ErrorCode(limited));
    }

    [Fact]
    public void Cursor_is_opaque_tamper_and_owner_filter_errors_are_400_context_changes_are_409()
    {
        var codec = new CursorCodec(new EphemeralDataProtectionProvider());
        const string subject = "user_Alice";
        const string filters = "horse=abc";
        var asOf = new DateOnly(2026, 10, 8);
        var token = codec.Encode(subject, filters, 9, asOf, "position-1");
        Assert.DoesNotContain(subject, token, StringComparison.Ordinal);
        Assert.Equal("position-1", codec.Decode(token, subject, filters, 9, asOf));

        AssertApiError(400, () => codec.Decode(token + "x", subject, filters, 9, asOf));
        AssertApiError(400, () => codec.Decode(token, "user_Bob", filters, 9, asOf));
        AssertApiError(400, () => codec.Decode(token, subject, "horse=other", 9, asOf));
        AssertApiError(409, () => codec.Decode(token, subject, filters, 10, asOf), "cursor_expired");
        AssertApiError(409, () => codec.Decode(token, subject, filters, 9, asOf.AddDays(1)), "cursor_expired");
    }

    [Theory]
    [InlineData(null, 50)]
    [InlineData("1", 1)]
    [InlineData("200", 200)]
    public void List_limit_uses_default_and_accepts_the_maximum(string? value, int expected) =>
        Assert.Equal(expected, ApiProtocol.ListLimit(value));

    [Theory]
    [InlineData("500")]
    [InlineData("")]
    [InlineData("zero")]
    [InlineData("0")]
    [InlineData("-1")]
    public void List_limit_rejects_malformed_or_nonpositive_values(string value) =>
        AssertApiError(400, () => ApiProtocol.ListLimit(value), "malformed_request");

    private static HttpClient CreateClient(int permitLimit = 100)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Cors:AllowedOrigin"] = "https://app.test",
            ["RateLimit:PermitLimit"] = permitLimit.ToString()
        }).Build();
        var host = new HostBuilder()
            .ConfigureWebHost(web => web
            .UseTestServer()
            .ConfigureServices(services =>
            {
                services.AddRouting();
                services.AddApiProtocol(configuration);
            })
            .Configure(app =>
            {
                app.UseRouting();
                app.Use(async (context, next) =>
                {
                    context.User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim("sub", "user_Alice") }, "test"));
                    await next();
                });
                app.UseApiProtocol();
                app.UseEndpoints(endpoints =>
                {
                    endpoints.MapPost("/api/v1/__tests__/command", async context =>
                    {
                        var (key, expectedVersion) = ApiProtocol.ReadCommand(context.Request);
                        await context.Response.WriteAsJsonAsync(new { key, expectedVersion });
                    });
                    endpoints.MapPost("/api/v1/previews/financial", context => context.Response.WriteAsJsonAsync(new { ok = true }));
                    endpoints.MapGet("/api/v1/__tests__/etag", context => ApiProtocol.WriteAsync(context, 200, new { streamVersion = 12 }, 12));
                    endpoints.MapPost("/api/v1/__tests__/body", async context =>
                    {
                        _ = await ApiProtocol.ReadBodyAsync<ProbeRequest>(context.Request, context.RequestAborted);
                        await context.Response.WriteAsJsonAsync(new { ok = true });
                    });
                    endpoints.MapGet("/api/v1/__tests__/missing", _ => throw new ApiException(404, "not_found", "Resource unavailable."));
                    endpoints.MapGet("/api/v1/__tests__/foreign", _ => throw new ApiException(404, "not_found", "Resource unavailable."));
                    endpoints.MapGet("/api/v1/__tests__/field-error", _ => throw new ApiException(422, "invalid_request", "Name is required.", "name"));
                    endpoints.MapGet("/api/v1/__tests__/io-error", _ => throw new IOException("secret filesystem path"));
                    endpoints.MapGet("/api/v1/__tests__/permission-error", _ => throw new UnauthorizedAccessException("storage denied"));
                });
            }))
            .Start();
        var server = (TestServer)host.Services.GetRequiredService<Microsoft.AspNetCore.Hosting.Server.IServer>();
        return new OwnedHttpClient(host, server.CreateHandler()) { BaseAddress = new Uri("http://localhost") };
    }

    private static HttpRequestMessage Command(string path)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = Json("{}") };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", Key.ToString());
        request.Headers.TryAddWithoutValidation("If-Match", "\"7\"");
        return request;
    }

    private static StringContent Json(string value) => new(value, Encoding.UTF8, "application/json");

    private static async Task<string?> ErrorCode(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("code").GetString();

    private static void AssertApiError(int status, Action action, string? code = null)
    {
        var exception = Assert.Throws<ApiException>(action);
        Assert.Equal(status, exception.StatusCode);
        if (code is not null) Assert.Equal(code, exception.Code);
    }

    private sealed class OwnedHttpClient(IHost host, HttpMessageHandler handler) : HttpClient(handler, disposeHandler: true)
    {
        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing) host.Dispose();
        }
    }

    private enum ProbeKind { Small, Large }
    private sealed record ProbeRequest(int Value, ProbeKind Kind, DateOnly Date);
}
