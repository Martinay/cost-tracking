using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using CostTracking.Tests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using CostTracking.Api.Storage;

namespace CostTracking.Tests.Integration;

public sealed class LifetimeReportTests
{
    [Fact]
    public async Task Lifetime_cursor_returns_additive_date_windows_across_more_than_five_years()
    {
        using var app = new TestApplication();
        using var client = Client(app);
        using var account = await Command(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        using var horse = await Command(client, HttpMethod.Post, "/api/v1/horses", 1,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        using var horseJson = JsonDocument.Parse(await horse.Content.ReadAsStringAsync());
        var horseId = horseJson.RootElement.GetProperty("horseId").GetGuid();
        var ruleBody = $"{{\"schedule\":{{\"cadence\":\"Daily\",\"interval\":1,\"weekdays\":[],\"dayOfMonth\":null,\"startDate\":\"1990-01-01\",\"endDate\":null}},\"amountMinor\":1,\"category\":\"Feed\",\"description\":\"Hay\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";
        using var rule = await Command(client, HttpMethod.Post, "/api/v1/expense-rules", 2, ruleBody);
        Assert.Equal(HttpStatusCode.Created, rule.StatusCode);

        var beforeReads = await app.Services.GetRequiredService<JsonlEventStore>().ReadAsync(TestIdentityIssuer.Alice);
        var cursor = (string?)null;
        var firstCursor = (string?)null;
        var seenWindows = 0;
        long expenseTotal = 0;
        do
        {
            var path = "/api/v1/reports/lifetime?limit=1" + (cursor is null ? "" : "&cursor=" + Uri.EscapeDataString(cursor));
            using var response = await client.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            Assert.Equal(3, json.RootElement.GetProperty("streamVersion").GetInt64());
            Assert.Equal("2026-09-21", json.RootElement.GetProperty("asOfDate").GetString());
            var row = Assert.Single(json.RootElement.GetProperty("items").EnumerateArray());
            expenseTotal += row.GetProperty("expenseMinor").GetInt64();
            seenWindows++;
            var complete = json.RootElement.GetProperty("complete").GetBoolean();
            cursor = json.RootElement.GetProperty("nextCursor").GetString();
            firstCursor ??= cursor;
            Assert.Equal(complete, cursor is null);
            if (seenWindows > 10) throw new Xunit.Sdk.XunitException("Lifetime report did not advance its date cursor.");
        } while (cursor is not null);

        var expectedOccurrences = DateOnly.Parse("2026-09-21").DayNumber - DateOnly.Parse("1990-01-01").DayNumber + 1;
        Assert.True(seenWindows > 1);
        Assert.True(expectedOccurrences > 10_000, "The lifetime fixture must cross the aggregate candidate-budget boundary.");
        Assert.Equal(expectedOccurrences, expenseTotal);
        Assert.Equal(beforeReads.Count, (await app.Services.GetRequiredService<JsonlEventStore>()
            .ReadAsync(TestIdentityIssuer.Alice)).Count);

        Assert.NotNull(firstCursor);
        app.Clock.Advance(TimeSpan.FromDays(1));
        using var dateExpired = await Client(app).GetAsync("/api/v1/reports/lifetime?limit=1&cursor=" + Uri.EscapeDataString(firstCursor!));
        Assert.Equal(HttpStatusCode.Conflict, dateExpired.StatusCode);
        using var dateError = JsonDocument.Parse(await dateExpired.Content.ReadAsStringAsync());
        Assert.Equal("cursor_expired", dateError.RootElement.GetProperty("code").GetString());
        Assert.Equal(beforeReads.Count, (await app.Services.GetRequiredService<JsonlEventStore>()
            .ReadAsync(TestIdentityIssuer.Alice)).Count);
    }

    private static HttpClient Client(TestApplication app)
    {
        var client = app.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", app.Identity.Issue(TestIdentityIssuer.Alice, app.Clock.GetUtcNow()));
        return client;
    }

    private static Task<HttpResponseMessage> Command(HttpClient client, HttpMethod method, string path, long version, string body)
    {
        var request = new HttpRequestMessage(method, path) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", Guid.NewGuid().ToString("D"));
        request.Headers.TryAddWithoutValidation("If-Match", $"\"{version}\"");
        return client.SendAsync(request);
    }
}
