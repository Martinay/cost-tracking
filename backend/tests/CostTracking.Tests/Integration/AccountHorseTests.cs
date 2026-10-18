using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using CostTracking.Tests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CostTracking.Tests.Integration;

public sealed class AccountHorseTests
{
    [Fact]
    public async Task New_account_reports_null_settings_and_version_zero()
    {
        using var app = new TestApplication();
        using var client = AuthenticatedClient(app, TestIdentityIssuer.Alice);

        using var response = await client.GetAsync("/api/v1/account");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("\"0\"", response.Headers.ETag?.Tag);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Null(body.RootElement.GetProperty("currency").GetStringOrNull());
        Assert.Null(body.RootElement.GetProperty("timeZone").GetStringOrNull());
        Assert.Null(body.RootElement.GetProperty("drivingRateMinorPerKm").GetStringOrNull());
        Assert.Equal(0, body.RootElement.GetProperty("streamVersion").GetInt64());
        Assert.False(body.RootElement.GetProperty("settingsLocked").GetBoolean());
    }

    [Fact]
    public async Task Horse_activity_does_not_freeze_account_settings()
    {
        using var app = new TestApplication();
        using var client = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        var configureKey = Guid.NewGuid();
        using var first = await SendCommandAsync(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}", configureKey);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        using var rate = await SendCommandAsync(client, HttpMethod.Put, "/api/v1/driving-rate", 1,
            "{\"rateMinorPerKm\":0.31}");
        Assert.Equal(HttpStatusCode.OK, rate.StatusCode);
        using var horse = await SendCommandAsync(client, HttpMethod.Post, "/api/v1/horses", 2,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        Assert.Equal(HttpStatusCode.Created, horse.StatusCode);

        using var changed = await SendCommandAsync(client, HttpMethod.Put, "/api/v1/account", 3,
            "{\"currency\":\"USD\",\"timeZone\":\"America/New_York\"}");

        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        using var body = JsonDocument.Parse(await changed.Content.ReadAsStringAsync());
        Assert.Equal("USD", body.RootElement.GetProperty("currency").GetString());
        Assert.Equal("America/New_York", body.RootElement.GetProperty("timeZone").GetString());
        Assert.Equal(4, body.RootElement.GetProperty("streamVersion").GetInt64());
        Assert.Null(body.RootElement.GetProperty("drivingRateMinorPerKm").GetStringOrNull());
        Assert.False(body.RootElement.GetProperty("settingsLocked").GetBoolean());

        using var exactRetry = await SendCommandAsync(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}", configureKey);
        Assert.Equal(HttpStatusCode.OK, exactRetry.StatusCode);
        using var replayed = JsonDocument.Parse(await exactRetry.Content.ReadAsStringAsync());
        Assert.Equal(1, replayed.RootElement.GetProperty("streamVersion").GetInt64());
    }

    [Fact]
    public async Task Reused_account_key_with_changed_semantically_invalid_body_conflicts_before_validation()
    {
        using var app = new TestApplication();
        using var client = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        var key = Guid.NewGuid();
        using var accepted = await SendCommandAsync(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}", key);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);

        using var changed = await SendCommandAsync(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"ZZZ\",\"timeZone\":\"No/Such_Zone\"}", key);

        Assert.Equal(HttpStatusCode.Conflict, changed.StatusCode);
        Assert.Equal("idempotency_conflict", await ErrorCode(changed));
    }

    [Fact]
    public async Task Horse_registration_requires_status_and_rejects_future_birth_date()
    {
        using var app = new TestApplication();
        using var client = AuthenticatedClient(app, TestIdentityIssuer.Alice);

        using var missingStatus = await SendCommandAsync(client, HttpMethod.Post, "/api/v1/horses", 0,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null}");
        using var nullName = await SendCommandAsync(client, HttpMethod.Post, "/api/v1/horses", 0,
            "{\"name\":null,\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        using var futureBirthDate = await SendCommandAsync(client, HttpMethod.Post, "/api/v1/horses", 0,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":\"2026-09-22\",\"status\":\"Active\"}");

        Assert.Equal(HttpStatusCode.BadRequest, missingStatus.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, nullName.StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, futureBirthDate.StatusCode);
    }

    [Fact]
    public async Task Horse_detail_patch_is_nonempty_and_status_changes_are_explicit_events()
    {
        using var app = new TestApplication();
        using var client = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        using var created = await SendCommandAsync(client, HttpMethod.Post, "/api/v1/horses", 0,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var createdBody = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var id = createdBody.RootElement.GetProperty("horseId").GetGuid();
        Assert.Equal(1, createdBody.RootElement.GetProperty("streamVersion").GetInt64());

        using var emptyPatch = await SendCommandAsync(client, HttpMethod.Patch, $"/api/v1/horses/{id:D}", 1, "{}");
        Assert.Equal(HttpStatusCode.BadRequest, emptyPatch.StatusCode);
        using var patch = await SendCommandAsync(client, HttpMethod.Patch, $"/api/v1/horses/{id:D}", 1,
            "{\"name\":\"Misty Blue\"}");
        Assert.Equal(HttpStatusCode.OK, patch.StatusCode);
        using var firstStatus = await SendCommandAsync(client, HttpMethod.Put, $"/api/v1/horses/{id:D}/status", 2,
            "{\"status\":\"Leased\"}");
        Assert.Equal(HttpStatusCode.OK, firstStatus.StatusCode);

        using var secondStatus = await SendCommandAsync(client, HttpMethod.Put, $"/api/v1/horses/{id:D}/status", 3,
            "{\"status\":\"Retired\"}");

        Assert.Equal(HttpStatusCode.OK, secondStatus.StatusCode);
        using var finalStatus = await SendCommandAsync(client, HttpMethod.Put, $"/api/v1/horses/{id:D}/status", 4,
            "{\"status\":\"Sold\"}");
        Assert.Equal(HttpStatusCode.OK, finalStatus.StatusCode);
        using var get = await client.GetAsync($"/api/v1/horses/{id:D}");
        using var result = JsonDocument.Parse(await get.Content.ReadAsStringAsync());
        Assert.Equal("Sold", result.RootElement.GetProperty("status").GetString());
        Assert.Equal("Misty Blue", result.RootElement.GetProperty("name").GetString());
        Assert.Equal(5, result.RootElement.GetProperty("streamVersion").GetInt64());
    }

    [Fact]
    public async Task Missing_and_foreign_horses_have_identical_not_found_responses()
    {
        using var app = new TestApplication();
        using var alice = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        using var bob = AuthenticatedClient(app, TestIdentityIssuer.Bob);
        using var created = await SendCommandAsync(alice, HttpMethod.Post, "/api/v1/horses", 0,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        using var body = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var foreignId = body.RootElement.GetProperty("horseId").GetGuid();

        using var foreign = await bob.GetAsync($"/api/v1/horses/{foreignId:D}");
        using var absent = await bob.GetAsync("/api/v1/horses/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");

        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, absent.StatusCode);
        using var foreignBody = JsonDocument.Parse(await foreign.Content.ReadAsStringAsync());
        using var absentBody = JsonDocument.Parse(await absent.Content.ReadAsStringAsync());
        Assert.Equal(foreignBody.RootElement.GetProperty("code").GetString(), absentBody.RootElement.GetProperty("code").GetString());
        Assert.Equal(foreignBody.RootElement.GetProperty("message").GetString(), absentBody.RootElement.GetProperty("message").GetString());
        Assert.False(foreignBody.RootElement.TryGetProperty("details", out _));
        Assert.False(absentBody.RootElement.TryGetProperty("details", out _));
    }

    [Fact]
    public async Task Horse_cursor_pages_are_stable_and_expire_when_the_stream_changes()
    {
        using var app = new TestApplication();
        using var client = AuthenticatedClient(app, TestIdentityIssuer.Alice);
        using var firstHorse = await SendCommandAsync(client, HttpMethod.Post, "/api/v1/horses", 0,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        using var secondHorse = await SendCommandAsync(client, HttpMethod.Post, "/api/v1/horses", 1,
            "{\"name\":\"Storm\",\"breed\":\"Warmblood\",\"dateOfBirth\":null,\"status\":\"Leased\"}");

        using var pageOne = await client.GetAsync("/api/v1/horses?limit=1");
        Assert.Equal(HttpStatusCode.OK, pageOne.StatusCode);
        using var firstPage = JsonDocument.Parse(await pageOne.Content.ReadAsStringAsync());
        var cursor = firstPage.RootElement.GetProperty("nextCursor").GetString();
        Assert.NotNull(cursor);
        Assert.Equal("Misty", Assert.Single(firstPage.RootElement.GetProperty("items").EnumerateArray()).GetProperty("name").GetString());

        using var pageTwo = await client.GetAsync("/api/v1/horses?limit=1&cursor=" + Uri.EscapeDataString(cursor!));
        Assert.Equal(HttpStatusCode.OK, pageTwo.StatusCode);
        using var secondPage = JsonDocument.Parse(await pageTwo.Content.ReadAsStringAsync());
        Assert.Equal("Storm", Assert.Single(secondPage.RootElement.GetProperty("items").EnumerateArray()).GetProperty("name").GetString());
        Assert.Equal(JsonValueKind.Null, secondPage.RootElement.GetProperty("nextCursor").ValueKind);

        using var numericStatus = await client.GetAsync("/api/v1/horses?status=0");
        Assert.Equal(HttpStatusCode.BadRequest, numericStatus.StatusCode);

        using var changed = await SendCommandAsync(client, HttpMethod.Post, "/api/v1/horses", 2,
            "{\"name\":\"Dawn\",\"breed\":\"Pony\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        using var stalePage = await client.GetAsync("/api/v1/horses?limit=1&cursor=" + Uri.EscapeDataString(cursor!));
        Assert.Equal(HttpStatusCode.Conflict, stalePage.StatusCode);
    }

    private static HttpClient AuthenticatedClient(TestApplication app, string subject)
    {
        var client = app.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var token = app.Identity.Issue(subject, app.Clock.GetUtcNow());
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static Task<HttpResponseMessage> SendCommandAsync(HttpClient client, HttpMethod method, string path,
        long version, string body, Guid? idempotencyKey = null)
    {
        var request = new HttpRequestMessage(method, path) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", (idempotencyKey ?? Guid.NewGuid()).ToString("D"));
        request.Headers.TryAddWithoutValidation("If-Match", $"\"{version}\"");
        return client.SendAsync(request);
    }

    private static async Task<string?> ErrorCode(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("code").GetString();
    }
}

internal static class JsonElementAccountTestExtensions
{
    public static string? GetStringOrNull(this JsonElement element) => element.ValueKind == JsonValueKind.Null ? null : element.GetString();
}
