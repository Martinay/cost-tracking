using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using CostTracking.Tests.Fixtures;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace CostTracking.Tests.Integration;

public sealed class ExpenseOccurrencePreviewTests
{
    [Fact]
    public async Task Preview_subtracts_previous_changed_contribution_and_restores_skipped_occurrence()
    {
        using var app = new TestApplication();
        using var client = Client(app);
        using var account = await Command(client, HttpMethod.Put, "/api/v1/account", 0,
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        using var horse = await Command(client, HttpMethod.Post, "/api/v1/horses", 1,
            "{\"name\":\"Misty\",\"breed\":\"Arabian\",\"dateOfBirth\":null,\"status\":\"Active\"}");
        using var horseJson = JsonDocument.Parse(await horse.Content.ReadAsStringAsync());
        var horseId = horseJson.RootElement.GetProperty("horseId").GetGuid();
        var ruleBody = $"{{\"schedule\":{{\"cadence\":\"Daily\",\"interval\":1,\"weekdays\":[],\"dayOfMonth\":null,\"startDate\":\"2026-09-01\",\"endDate\":null}},\"amountMinor\":100,\"category\":\"Feed\",\"description\":\"Hay\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";
        using var created = await Command(client, HttpMethod.Post, "/api/v1/expense-rules", 2, ruleBody);
        using var ruleJson = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var ruleId = ruleJson.RootElement.GetProperty("ruleId").GetGuid();
        var changed = $"{{\"action\":\"Changed\",\"changed\":{{\"amountMinor\":250,\"category\":\"Feed\",\"description\":\"Hay\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}}}";
        using var changedResponse = await Command(client, HttpMethod.Put,
            $"/api/v1/expense-rules/{ruleId:D}/occurrences/2026-09-20", 3, changed);
        Assert.Equal(HttpStatusCode.OK, changedResponse.StatusCode);
        var before = await app.Services.GetRequiredService<CostTracking.Api.Storage.JsonlEventStore>().ReadAsync(TestIdentityIssuer.Alice);

        using var skipped = await client.PostAsync("/api/v1/previews/financial", Json(new
        {
            kind = "ExpenseOccurrenceChange", ruleId, scheduledDate = "2026-09-20",
            values = new { action = "Skipped", changed = (object?)null }
        }));

        Assert.Equal(HttpStatusCode.OK, skipped.StatusCode);
        using var skippedJson = JsonDocument.Parse(await skipped.Content.ReadAsStringAsync());
        Assert.Equal(250, skippedJson.RootElement.GetProperty("amountMinor").GetInt64());
        var skipDelta = Assert.Single(skippedJson.RootElement.GetProperty("monthlyEffect").EnumerateArray());
        Assert.Equal(-250, skipDelta.GetProperty("expenseDeltaMinor").GetInt64());
        Assert.Equal(250, skipDelta.GetProperty("netDeltaMinor").GetInt64());
        using var committedSkip = await Command(client, HttpMethod.Put,
            $"/api/v1/expense-rules/{ruleId:D}/occurrences/2026-09-20", 4,
            "{\"action\":\"Skipped\",\"changed\":null}");
        Assert.Equal(HttpStatusCode.OK, committedSkip.StatusCode);

        var restore = $"{{\"action\":\"Changed\",\"changed\":{{\"amountMinor\":100,\"category\":\"Feed\",\"description\":\"Hay\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}}}";
        using var restored = await client.PostAsync("/api/v1/previews/financial", Json(new
        {
            kind = "ExpenseOccurrenceChange", ruleId, scheduledDate = "2026-09-20", values = JsonDocument.Parse(restore).RootElement
        }));
        Assert.Equal(HttpStatusCode.OK, restored.StatusCode);
        using var restoredJson = JsonDocument.Parse(await restored.Content.ReadAsStringAsync());
        Assert.Equal(100, restoredJson.RootElement.GetProperty("amountMinor").GetInt64());
        var restoreDelta = Assert.Single(restoredJson.RootElement.GetProperty("monthlyEffect").EnumerateArray());
        Assert.Equal(100, restoreDelta.GetProperty("expenseDeltaMinor").GetInt64());
        Assert.Equal(-100, restoreDelta.GetProperty("netDeltaMinor").GetInt64());
        Assert.Equal(5, restoredJson.RootElement.GetProperty("streamVersion").GetInt64());
        Assert.Equal(before.Count + 1, (await app.Services.GetRequiredService<CostTracking.Api.Storage.JsonlEventStore>().ReadAsync(TestIdentityIssuer.Alice)).Count);
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

    private static StringContent Json<T>(T value) => new(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json");
}
