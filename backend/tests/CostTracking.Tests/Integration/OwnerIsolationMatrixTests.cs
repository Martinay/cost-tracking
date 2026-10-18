using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using CostTracking.Tests.Fixtures;

namespace CostTracking.Tests.Integration;

public sealed class OwnerIsolationMatrixTests
{
    [Fact]
    public async Task Foreign_identifiers_filters_and_preview_targets_match_unknown_resource_errors_across_endpoints()
    {
        using var app = new TestApplication();
        using var alice = Client(app, TestIdentityIssuer.Alice);
        using var bob = Client(app, TestIdentityIssuer.Bob);
        await ConfigureOwner(alice);
        await ConfigureOwner(bob);
        var aliceHorse = await CreateHorse(alice, 1, "Alice horse");
        var bobHorse = await CreateHorse(bob, 1, "Bob horse");
        var expenseRule = await CreateExpenseRule(bob, bobHorse);
        var incomeRule = await CreateIncomeRule(bob, bobHorse);
        const string unknownHorse = "00000000-0000-4000-8000-000000000099";
        const string unknownRule = "00000000-0000-4000-8000-000000000098";
        var foreignId = bobHorse.ToString("D");

        await AssertSameNotFound(alice, $"/api/v1/horses/{foreignId}", $"/api/v1/horses/{unknownHorse}");
        await AssertSameNotFound(alice, $"/api/v1/history?horseId={foreignId}", $"/api/v1/history?horseId={unknownHorse}");
        await AssertSameNotFound(alice, $"/api/v1/history?ruleId={expenseRule:D}", $"/api/v1/history?ruleId={unknownRule}");
        await AssertSameNotFound(alice, $"/api/v1/expenses?from=2026-09-01&to=2026-09-30&horseId={foreignId}",
            $"/api/v1/expenses?from=2026-09-01&to=2026-09-30&horseId={unknownHorse}");
        await AssertSameNotFound(alice, $"/api/v1/income?from=2026-09-01&to=2026-09-30&horseId={foreignId}",
            $"/api/v1/income?from=2026-09-01&to=2026-09-30&horseId={unknownHorse}");
        await AssertSameNotFound(alice, $"/api/v1/tasks?from=2026-09-01&to=2026-09-30&horseId={foreignId}",
            $"/api/v1/tasks?from=2026-09-01&to=2026-09-30&horseId={unknownHorse}");
        await AssertSameNotFound(alice, $"/api/v1/reports/monthly-pnl?month=2026-09&horseId={foreignId}",
            $"/api/v1/reports/monthly-pnl?month=2026-09&horseId={unknownHorse}");
        await AssertSameNotFound(alice, $"/api/v1/reports/lifetime?horseId={foreignId}",
            $"/api/v1/reports/lifetime?horseId={unknownHorse}");
        await AssertSameNotFound(alice, $"/api/v1/reports/breakdown?from=2026-09-01&to=2026-09-30&kind=expense&horseId={foreignId}",
            $"/api/v1/reports/breakdown?from=2026-09-01&to=2026-09-30&kind=expense&horseId={unknownHorse}");
        await AssertSameNotFound(alice, $"/api/v1/reports/activity?from=2026-09-01&to=2026-09-30&horseId={foreignId}",
            $"/api/v1/reports/activity?from=2026-09-01&to=2026-09-30&horseId={unknownHorse}");

        await AssertSameNotFound(alice, $"/api/v1/horses/{foreignId}", $"/api/v1/horses/{unknownHorse}",
            HttpMethod.Patch, "2", "{\"name\":\"Changed\"}");
        await AssertSameNotFound(alice, $"/api/v1/horses/{foreignId}/status", $"/api/v1/horses/{unknownHorse}/status",
            HttpMethod.Put, "2", "{\"status\":\"Sold\"}");
        await AssertSameNotFound(alice, $"/api/v1/expense-rules/{expenseRule:D}/stop", $"/api/v1/expense-rules/{unknownRule}/stop",
            HttpMethod.Post, "2", "{\"lastDate\":\"2026-09-30\"}");
        await AssertSameNotFound(alice, $"/api/v1/expense-rules/{expenseRule:D}", $"/api/v1/expense-rules/{unknownRule}",
            HttpMethod.Patch, "2", "{\"effectiveFrom\":\"2026-10-01\",\"schedule\":{\"cadence\":\"Daily\",\"interval\":1,\"weekdays\":[],\"dayOfMonth\":null,\"startDate\":\"2026-09-21\",\"endDate\":null},\"amountMinor\":100,\"category\":\"Feed\",\"description\":\"Hay\",\"split\":{\"mode\":\"Equal\",\"horseIds\":[\"" + aliceHorse.ToString("D") + "\"]}}");
        await AssertSameNotFound(alice, $"/api/v1/income-rules/{incomeRule:D}/stop", $"/api/v1/income-rules/{unknownRule}/stop",
            HttpMethod.Post, "2", "{\"lastDate\":\"2026-09-30\"}");
        await AssertSameNotFound(alice, $"/api/v1/income-rules/{incomeRule:D}", $"/api/v1/income-rules/{unknownRule}",
            HttpMethod.Patch, "2", "{\"effectiveFrom\":\"2026-10-01\",\"schedule\":{\"cadence\":\"Daily\",\"interval\":1,\"weekdays\":[],\"dayOfMonth\":null,\"startDate\":\"2026-09-21\",\"endDate\":null},\"amountMinor\":100,\"source\":\"Lessons\",\"split\":{\"mode\":\"Equal\",\"horseIds\":[\"" + aliceHorse.ToString("D") + "\"]}}");
        await AssertSameNotFound(alice, $"/api/v1/income-rules/{incomeRule:D}/occurrences/2026-09-21/reject",
            $"/api/v1/income-rules/{unknownRule}/occurrences/2026-09-21/reject", HttpMethod.Post, "2", "{}");
        await AssertSameNotFound(alice, $"/api/v1/expense-rules/{expenseRule:D}/occurrences/2026-09-21",
            $"/api/v1/expense-rules/{unknownRule}/occurrences/2026-09-21", HttpMethod.Put, "2",
            "{\"action\":\"Skipped\",\"changed\":null}");

        var foreignExpensePreview = $"{{\"kind\":\"Expense\",\"values\":{{\"expenseDate\":\"2026-09-21\",\"amountMinor\":100,\"category\":\"Feed\",\"description\":\"Hay\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{bobHorse:D}\"]}}}}}}";
        var unknownExpensePreview = foreignExpensePreview.Replace(foreignId, unknownHorse, StringComparison.Ordinal);
        await AssertSameNotFound(alice, "/api/v1/previews/financial", "/api/v1/previews/financial",
            HttpMethod.Post, bodyA: foreignExpensePreview, bodyB: unknownExpensePreview);
        var foreignIncomePreview = $"{{\"kind\":\"Income\",\"values\":{{\"receivedDate\":\"2026-09-21\",\"amountMinor\":100,\"source\":\"Lessons\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{bobHorse:D}\"]}}}}}}";
        await AssertSameNotFound(alice, "/api/v1/previews/financial", "/api/v1/previews/financial",
            HttpMethod.Post, bodyA: foreignIncomePreview,
            bodyB: foreignIncomePreview.Replace(foreignId, unknownHorse, StringComparison.Ordinal));
        Assert.NotEqual(aliceHorse, bobHorse);
    }

    private static async Task ConfigureOwner(HttpClient client)
    {
        using var response = await Send(client, HttpMethod.Put, "/api/v1/account", "0",
            "{\"currency\":\"EUR\",\"timeZone\":\"Europe/Berlin\"}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    private static async Task<Guid> CreateHorse(HttpClient client, long version, string name)
    {
        using var response = await Send(client, HttpMethod.Post, "/api/v1/horses", version.ToString(),
            JsonSerializer.Serialize(new { name, breed = "Arabian", dateOfBirth = (string?)null, status = "Active" }));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("horseId").GetGuid();
    }

    private static async Task<Guid> CreateExpenseRule(HttpClient client, Guid horseId)
    {
        const string schedule = "{\"cadence\":\"Daily\",\"interval\":1,\"weekdays\":[],\"dayOfMonth\":null,\"startDate\":\"2026-09-21\",\"endDate\":null}";
        var request = $"{{\"schedule\":{schedule},\"amountMinor\":100,\"category\":\"Feed\",\"description\":\"Hay\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";
        using var response = await Send(client, HttpMethod.Post, "/api/v1/expense-rules", "2", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("ruleId").GetGuid();
    }

    private static async Task<Guid> CreateIncomeRule(HttpClient client, Guid horseId)
    {
        const string schedule = "{\"cadence\":\"Daily\",\"interval\":1,\"weekdays\":[],\"dayOfMonth\":null,\"startDate\":\"2026-09-21\",\"endDate\":null}";
        var request = $"{{\"schedule\":{schedule},\"amountMinor\":100,\"source\":\"Lessons\",\"split\":{{\"mode\":\"Equal\",\"horseIds\":[\"{horseId:D}\"]}}}}";
        using var response = await Send(client, HttpMethod.Post, "/api/v1/income-rules", "3", request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("ruleId").GetGuid();
    }

    private static HttpClient Client(TestApplication app, string subject)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer",
            app.Identity.Issue(subject, app.Clock.GetUtcNow()));
        return client;
    }

    private static Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path,
        string version, string body)
    {
        var request = new HttpRequestMessage(method, path)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", Guid.NewGuid().ToString("D"));
        request.Headers.TryAddWithoutValidation("If-Match", $"\"{version}\"");
        return client.SendAsync(request);
    }

    private static async Task AssertSameNotFound(HttpClient client, string foreignPath, string unknownPath,
        HttpMethod? method = null, string? version = null, string body = "{}", string? bodyA = null, string? bodyB = null)
    {
        using var foreign = method is null ? await client.GetAsync(foreignPath) :
            await Send(client, method, foreignPath, version ?? "2", bodyA ?? body);
        using var unknown = method is null ? await client.GetAsync(unknownPath) :
            await Send(client, method, unknownPath, version ?? "2", bodyB ?? body);
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        using var foreignJson = JsonDocument.Parse(await foreign.Content.ReadAsStringAsync());
        using var unknownJson = JsonDocument.Parse(await unknown.Content.ReadAsStringAsync());
        Assert.Equal(foreignJson.RootElement.GetProperty("code").GetString(), unknownJson.RootElement.GetProperty("code").GetString());
        Assert.Equal(foreignJson.RootElement.GetProperty("message").GetString(), unknownJson.RootElement.GetProperty("message").GetString());
        Assert.Equal("not_found", foreignJson.RootElement.GetProperty("code").GetString());
        var foreignBody = await foreign.Content.ReadAsStringAsync();
        Assert.DoesNotContain("user_Bob", foreignBody, StringComparison.Ordinal);
        Assert.DoesNotContain(foreignPath.Contains("/") ? "private" : "", foreignBody, StringComparison.Ordinal);
    }
}
